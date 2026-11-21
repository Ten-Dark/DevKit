import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import type { ProcessObservation, ServiceDefinition } from './contracts.js'
import { RuntimeEventLogger } from './event-logger.js'
import { ensureSafeDirectory, resolveWorkspacePaths } from '../workspace.js'

const PROCESS_STATE_SCHEMA_VERSION = 1
const SAFE_INHERITED_ENV = new Set([
  'PATH',
  'SYSTEMROOT',
  'WINDIR',
  'TEMP',
  'TMP',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'PROGRAMDATA',
  'PATHEXT',
  'COMSPEC',
])

type PersistedProcessState = 'running' | 'exited' | 'unknown'

interface PersistedProcessRecord {
  serviceId: string
  pid: number
  startedAt: string
  executablePath: string
  workingDirectory: string
  argsHash: string
  ownerToken: string
  state: PersistedProcessState
  exitCode?: number | null
}

interface ProcessStateDocument {
  schemaVersion: number
  records: PersistedProcessRecord[]
}

export interface ProcessLaunchSpec {
  executablePath: string
  args: string[]
  workingDirectory: string
  env?: Record<string, string>
}

export interface ProcessManagerOptions {
  stateFilePath?: string
  eventLogger?: RuntimeEventLogger
  gracefulStopTimeoutMs?: number
  forceStopTimeoutMs?: number
}

interface ManagedChild {
  child: ChildProcess
  record: PersistedProcessRecord
  exited: boolean
  exitCode?: number | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validateStateDocument(value: unknown): value is ProcessStateDocument {
  if (
    !isRecord(value) ||
    value.schemaVersion !== PROCESS_STATE_SCHEMA_VERSION ||
    !Array.isArray(value.records) ||
    value.records.length > 500
  ) {
    return false
  }
  const ids = new Set<string>()
  return value.records.every((item) => {
    if (!isRecord(item)) return false
    if (
      typeof item.serviceId !== 'string' ||
      !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(item.serviceId) ||
      !Number.isInteger(item.pid) ||
      (item.pid as number) <= 0 ||
      typeof item.startedAt !== 'string' ||
      Number.isNaN(Date.parse(item.startedAt)) ||
      typeof item.executablePath !== 'string' ||
      item.executablePath.length > 4_096 ||
      typeof item.workingDirectory !== 'string' ||
      item.workingDirectory.length > 4_096 ||
      typeof item.argsHash !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(item.argsHash) ||
      typeof item.ownerToken !== 'string' ||
      !/^[0-9a-f-]{36}$/i.test(item.ownerToken) ||
      !['running', 'exited', 'unknown'].includes(String(item.state)) ||
      (item.exitCode !== undefined && item.exitCode !== null && !Number.isInteger(item.exitCode)) ||
      ids.has(item.serviceId)
    ) return false
    ids.add(item.serviceId)
    return true
  })
}

function safeEnvironment(overrides: Record<string, string> = {}): Record<string, string> {
  const environment: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (SAFE_INHERITED_ENV.has(key.toUpperCase()) && value !== undefined) environment[key] = value
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(key)) {
      throw new Error(`Invalid environment variable name: ${key}`)
    }
    if (/(secret|token|password|credential|api[-_]?key|private[-_]?key)/i.test(key)) {
      throw new Error(`Secret environment variable '${key}' is not allowed before Vault integration.`)
    }
    if (typeof value !== 'string' || value.length > 4_096 || value.includes('\0')) {
      throw new Error(`Invalid value for environment variable '${key}'.`)
    }
    environment[key] = value
  }
  return environment
}

function hashArguments(args: string[]): string {
  return createHash('sha256').update(JSON.stringify(args)).digest('hex')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export class ProcessManager {
  private readonly stateFilePath: string
  private readonly eventLogger?: RuntimeEventLogger
  private readonly gracefulStopTimeoutMs: number
  private readonly forceStopTimeoutMs: number
  private readonly records = new Map<string, PersistedProcessRecord>()
  private readonly children = new Map<string, ManagedChild>()
  private operationQueue: Promise<void> = Promise.resolve()
  private initialization?: Promise<void>

  constructor(options: ProcessManagerOptions = {}) {
    this.stateFilePath = options.stateFilePath ?? path.join(resolveWorkspacePaths().registry, 'process-instances.json')
    this.eventLogger = options.eventLogger
    this.gracefulStopTimeoutMs = Math.max(100, options.gracefulStopTimeoutMs ?? 5_000)
    this.forceStopTimeoutMs = Math.max(100, options.forceStopTimeoutMs ?? 1_000)
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation)
    this.operationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  async initialize(): Promise<void> {
    if (!this.initialization) {
      this.initialization = this.loadState()
    }
    return this.initialization
  }

  private async loadState(): Promise<void> {
    await ensureSafeDirectory(path.dirname(this.stateFilePath))
    try {
      const stat = await fs.lstat(this.stateFilePath)
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error('Process state must be a regular file.')
      }
      if (stat.size > 1_048_576) throw new Error('Process state exceeds the 1 MiB safety limit.')
      const parsed: unknown = JSON.parse(await fs.readFile(this.stateFilePath, 'utf8'))
      if (!validateStateDocument(parsed)) throw new Error('Process state document is invalid or unsupported.')
      for (const record of parsed.records) {
        // A PID from a previous app lifetime is not sufficient proof of
        // ownership. Preserve identity evidence but never reattach or kill it.
        this.records.set(record.serviceId, {
          ...record,
          state: record.state === 'running' ? 'unknown' : record.state,
        })
      }
      if (parsed.records.some((record) => record.state === 'running')) await this.persistState()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
  }

  private async persistState(): Promise<void> {
    await ensureSafeDirectory(path.dirname(this.stateFilePath))
    const tempPath = path.join(
      path.dirname(this.stateFilePath),
      `.${path.basename(this.stateFilePath)}.${process.pid}.${randomUUID()}.tmp`,
    )
    const document: ProcessStateDocument = {
      schemaVersion: PROCESS_STATE_SCHEMA_VERSION,
      records: [...this.records.values()],
    }
    try {
      await fs.writeFile(tempPath, JSON.stringify(document, null, 2), { encoding: 'utf8', flag: 'wx' })
      await fs.rename(tempPath, this.stateFilePath)
    } catch (error) {
      await fs.unlink(tempPath).catch(() => undefined)
      throw error
    }
  }

  private async resolveLaunchSpec(spec: ProcessLaunchSpec): Promise<ProcessLaunchSpec> {
    if (!path.isAbsolute(spec.executablePath)) throw new Error('Executable path must be absolute.')
    if (!path.isAbsolute(spec.workingDirectory)) throw new Error('Working directory must be absolute.')
    if (!Array.isArray(spec.args) || spec.args.length > 128) throw new Error('Arguments must be an array of at most 128 items.')
    let argumentBytes = 0
    for (const argument of spec.args) {
      if (typeof argument !== 'string' || argument.includes('\0') || argument.length > 4_096) {
        throw new Error('Each process argument must be a valid string of at most 4096 characters.')
      }
      argumentBytes += Buffer.byteLength(argument, 'utf8')
    }
    if (argumentBytes > 64 * 1_024) throw new Error('Combined process arguments exceed the 64 KiB limit.')

    const executablePath = await fs.realpath(spec.executablePath)
    const executableStat = await fs.stat(executablePath)
    if (!executableStat.isFile()) throw new Error('Executable path must resolve to a regular file.')

    const workingDirectory = await fs.realpath(spec.workingDirectory)
    const workingDirectoryStat = await fs.stat(workingDirectory)
    if (!workingDirectoryStat.isDirectory()) throw new Error('Working directory must resolve to a directory.')

    return {
      executablePath,
      args: [...spec.args],
      workingDirectory,
      env: safeEnvironment(spec.env),
    }
  }

  async start(service: ServiceDefinition, spec: ProcessLaunchSpec, signal?: AbortSignal): Promise<ProcessObservation> {
    return this.enqueue(async () => {
      await this.initialize()
      if (service.owner.kind !== 'managed') {
        throw new Error('ProcessManager can start only DevKit-managed services.')
      }
      if (!service.capabilities.includes('start') || !service.capabilities.includes('stop')) {
        throw new Error(`Service '${service.id}' must grant both start and stop capabilities for managed process execution.`)
      }
      if (signal?.aborted) throw new Error('Process start was cancelled.')
      const previous = this.records.get(service.id)
      if (previous?.state === 'unknown') {
        throw new Error(`Service '${service.id}' has an unobservable process from a previous session; refusing to start a duplicate.`)
      }
      const current = this.children.get(service.id)
      if (current && !current.exited) throw new Error(`Service '${service.id}' is already running.`)

      const resolved = await this.resolveLaunchSpec(spec)
      const ownerToken = randomUUID()
      const child = spawn(resolved.executablePath, resolved.args, {
        cwd: resolved.workingDirectory,
        env: resolved.env,
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      })

      await new Promise<void>((resolve, reject) => {
        const onSpawn = () => {
          child.off('error', onError)
          resolve()
        }
        const onError = (error: Error) => {
          child.off('spawn', onSpawn)
          reject(error)
        }
        child.once('spawn', onSpawn)
        child.once('error', onError)
      })

      if (!child.pid) throw new Error('Process did not provide a valid PID after spawn.')

      const record: PersistedProcessRecord = {
        serviceId: service.id,
        pid: child.pid,
        startedAt: new Date().toISOString(),
        executablePath: resolved.executablePath,
        workingDirectory: resolved.workingDirectory,
        argsHash: hashArguments(resolved.args),
        ownerToken,
        state: 'running',
      }
      const entry: ManagedChild = { child, record, exited: false }
      this.records.set(service.id, record)
      this.children.set(service.id, entry)

      child.on('exit', (code) => {
        entry.exited = true
        entry.exitCode = code
        entry.record.state = 'exited'
        entry.record.exitCode = code
        void this.enqueue(async () => {
          const latest = this.records.get(service.id)
          if (!latest || latest.ownerToken !== ownerToken) return
          latest.state = 'exited'
          latest.exitCode = code
          await this.persistState()
          await this.eventLogger?.emit({
            type: 'process.exited',
            level: code === 0 ? 'info' : 'warn',
            serviceId: service.id,
            correlationId: ownerToken,
            message: `Managed process exited with code ${String(code)}.`,
          })
        }).catch(() => undefined)
      })
      child.on('error', (error) => {
        entry.exited = true
        entry.exitCode = null
        entry.record.state = 'unknown'
        void this.enqueue(async () => {
          const latest = this.records.get(service.id)
          if (!latest || latest.ownerToken !== ownerToken) return
          latest.state = 'unknown'
          await this.persistState()
          await this.eventLogger?.emit({
            type: 'process.observation-failed',
            level: 'error',
            serviceId: service.id,
            correlationId: ownerToken,
            message: `Managed process observation failed: ${error.message}`,
          })
        }).catch(() => undefined)
      })

      try {
        await this.persistState()
      } catch (error) {
        child.kill('SIGTERM')
        const stopped = await this.waitForExit(entry, this.gracefulStopTimeoutMs)
        if (!stopped) {
          child.kill('SIGKILL')
          await this.waitForExit(entry, this.forceStopTimeoutMs)
        }
        if (entry.exited && entry.record.state !== 'unknown') {
          entry.record.state = 'exited'
          entry.record.exitCode = entry.exitCode
        } else if (!entry.exited) {
          entry.record.state = 'unknown'
        }
        throw new Error('Could not persist process ownership; the newly started process was asked to stop.', { cause: error })
      }

      await this.eventLogger?.emit({
        type: 'process.started',
        level: 'info',
        serviceId: service.id,
        correlationId: ownerToken,
        message: 'Managed process started.',
        details: { pid: child.pid, executablePath: resolved.executablePath, workingDirectory: resolved.workingDirectory },
      }).catch((error: unknown) => {
        console.error('[DevKit Runtime] Could not persist process.started event:', error)
      })

      if (signal) {
        const abortHandler = () => {
          void this.stop(service).catch(() => undefined)
        }
        if (signal.aborted) {
          abortHandler()
        } else {
          signal.addEventListener('abort', abortHandler, { once: true })
          child.once('exit', () => signal.removeEventListener('abort', abortHandler))
        }
      }

      return this.toObservation(entry)
    })
  }

  private toObservation(entry: ManagedChild): ProcessObservation {
    return {
      state: entry.record.state === 'unknown' ? 'unobservable' : entry.exited ? 'exited' : 'present',
      observedAt: new Date().toISOString(),
      pid: entry.record.pid,
      startedAt: entry.record.startedAt,
      executablePath: entry.record.executablePath,
      workingDirectory: entry.record.workingDirectory,
      identityVerified: entry.record.state !== 'unknown',
      ...(entry.exited ? { exitCode: entry.exitCode } : {}),
    }
  }

  async getObservation(serviceId: string): Promise<ProcessObservation> {
    return this.enqueue(async () => {
      await this.initialize()
      const child = this.children.get(serviceId)
      if (child) return this.toObservation(child)
      const record = this.records.get(serviceId)
      if (!record) {
        return { state: 'absent', observedAt: new Date().toISOString(), identityVerified: false }
      }
      if (record.state === 'exited') {
        return {
          state: 'exited',
          observedAt: new Date().toISOString(),
          pid: record.pid,
          startedAt: record.startedAt,
          executablePath: record.executablePath,
          workingDirectory: record.workingDirectory,
          identityVerified: true,
          exitCode: record.exitCode,
        }
      }
      return {
        state: 'unobservable',
        observedAt: new Date().toISOString(),
        pid: record.pid,
        startedAt: record.startedAt,
        executablePath: record.executablePath,
        workingDirectory: record.workingDirectory,
        identityVerified: false,
      }
    })
  }

  async stop(service: ServiceDefinition): Promise<ProcessObservation> {
    const observation = await this.enqueue(async () => {
      await this.initialize()
      if (service.owner.kind !== 'managed') {
        throw new Error('ProcessManager can stop only DevKit-managed services.')
      }
      if (!service.capabilities.includes('stop')) {
        throw new Error(`Service '${service.id}' does not grant the stop capability.`)
      }

      const entry = this.children.get(service.id)
      if (!entry) {
        const observation = await this.getObservationWithoutQueue(service.id)
        if (observation.state === 'unobservable') {
          throw new Error('Process ownership cannot be verified after restart; refusing to terminate an unknown PID.')
        }
        return observation
      }
      if (entry.exited) return this.toObservation(entry)

      entry.child.kill('SIGTERM')
      let exited = await this.waitForExit(entry, this.gracefulStopTimeoutMs)
      if (!exited) {
        entry.child.kill('SIGKILL')
        exited = await this.waitForExit(entry, this.forceStopTimeoutMs)
      }
      if (!exited) {
        entry.record.state = 'unknown'
        await this.persistState()
        throw new Error('Managed process did not exit after bounded termination attempts.')
      }

      entry.record.state = 'exited'
      entry.record.exitCode = entry.exitCode
      await this.persistState()
      await this.eventLogger?.emit({
        type: 'process.stopped',
        level: 'info',
        serviceId: service.id,
        correlationId: entry.record.ownerToken,
        message: 'Managed process stopped.',
      }).catch((error: unknown) => {
        console.error('[DevKit Runtime] Could not persist process.stopped event:', error)
      })
      return this.toObservation(entry)
    })
    await this.operationQueue
    return observation
  }

  private async getObservationWithoutQueue(serviceId: string): Promise<ProcessObservation> {
    const record = this.records.get(serviceId)
    if (!record) return { state: 'absent', observedAt: new Date().toISOString(), identityVerified: false }
    if (record.state === 'exited') {
      return {
        state: 'exited',
        observedAt: new Date().toISOString(),
        pid: record.pid,
        startedAt: record.startedAt,
        executablePath: record.executablePath,
        workingDirectory: record.workingDirectory,
        identityVerified: true,
        exitCode: record.exitCode,
      }
    }
    return {
      state: 'unobservable',
      observedAt: new Date().toISOString(),
      pid: record.pid,
      startedAt: record.startedAt,
      executablePath: record.executablePath,
      workingDirectory: record.workingDirectory,
      identityVerified: false,
    }
  }

  private async waitForExit(entry: ManagedChild, timeoutMs: number): Promise<boolean> {
    if (entry.exited) return true
    const deadline = Date.now() + timeoutMs
    while (!entry.exited && Date.now() < deadline) {
      await delay(Math.min(50, Math.max(1, deadline - Date.now())))
    }
    return entry.exited
  }

  async acknowledgeUnobservableStopped(serviceId: string, confirmedStopped: boolean): Promise<void> {
    return this.enqueue(async () => {
      await this.initialize()
      if (confirmedStopped !== true) throw new Error('Explicit stopped-state confirmation is required.')
      if (this.children.has(serviceId)) throw new Error('A process started in this session must be stopped through its managed child handle.')
      const record = this.records.get(serviceId)
      if (!record || record.state !== 'unknown') throw new Error('Service has no unobservable process record.')
      this.records.delete(serviceId)
      await this.persistState()
      await this.eventLogger?.emit({
        type: 'process.ownership-cleared',
        level: 'warn',
        serviceId,
        correlationId: record.ownerToken,
        message: 'Unobservable process ownership record cleared after explicit user confirmation.',
        details: { previousPid: record.pid },
      }).catch((error: unknown) => {
        console.error('[DevKit Runtime] Could not persist process.ownership-cleared event:', error)
      })
    })
  }
}
