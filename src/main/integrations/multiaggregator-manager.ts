import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ensureSafeDirectory, resolveWorkspacePaths } from '../workspace.js'
import type { LocalIntegrationStatus } from './local-integrations.js'

const MAX_SETTINGS_BYTES = 16 * 1024
const STATUS_TIMEOUT_MS = 10_000
const STOP_HINT = 'Close Multi-AI Aggregator from its own window. DevKit does not force-terminate this external application.'

function quotePowerShell(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'"
}

function powershellPath(): string {
  const systemRoot = process.env.SystemRoot || 'C:\\Windows'
  return path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function runPowerShell(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(powershellPath(), [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(stdout)
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(new Error('Multi-AI Aggregator status probe timed out.'))
    }, STATUS_TIMEOUT_MS)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout = (stdout + chunk).slice(-16_000) })
    child.stderr.on('data', (chunk: string) => { stderr = (stderr + chunk).slice(-4_000) })
    child.once('error', (error) => finish(error))
    child.once('close', (code) => {
      if (code !== 0) finish(new Error(stderr.trim() || 'Could not inspect Multi-AI Aggregator process state.'))
      else finish()
    })
  })
}

interface StoredExecutable {
  schemaVersion: 1
  executablePath: string
}

export class MultiAggregatorManager {
  private readonly settingsPath: string
  private executablePath: string | null = null
  private initialized?: Promise<void>
  private operationQueue: Promise<void> = Promise.resolve()

  constructor(settingsPath = path.join(resolveWorkspacePaths().services, 'multiaggregator.json')) {
    this.settingsPath = settingsPath
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation)
    this.operationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  async initialize(): Promise<void> {
    if (!this.initialized) this.initialized = this.load()
    return this.initialized
  }

  private async load(): Promise<void> {
    await ensureSafeDirectory(path.dirname(this.settingsPath))
    try {
      const stat = await fs.lstat(this.settingsPath)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Multi-AI Aggregator settings must be a regular file.')
      if (stat.size > MAX_SETTINGS_BYTES) throw new Error('Multi-AI Aggregator settings exceed 16 KiB.')
      const parsed: unknown = JSON.parse(await fs.readFile(this.settingsPath, 'utf8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Multi-AI Aggregator settings are invalid.')
      const record = parsed as Record<string, unknown>
      if (record.schemaVersion !== 1 || typeof record.executablePath !== 'string' || !path.isAbsolute(record.executablePath)) {
        throw new Error('Multi-AI Aggregator settings use an unsupported schema.')
      }
      this.executablePath = path.resolve(record.executablePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  private async persist(): Promise<void> {
    await ensureSafeDirectory(path.dirname(this.settingsPath))
    try {
      const stat = await fs.lstat(this.settingsPath)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Multi-AI Aggregator settings destination must be a regular file.')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const tempPath = this.settingsPath + '.' + process.pid + '.' + randomUUID() + '.tmp'
    const document: StoredExecutable = { schemaVersion: 1, executablePath: this.executablePath! }
    try {
      await fs.writeFile(tempPath, JSON.stringify(document, null, 2), { encoding: 'utf8', flag: 'wx' })
      await fs.rename(tempPath, this.settingsPath)
    } catch (error) {
      await fs.unlink(tempPath).catch(() => undefined)
      throw error
    }
  }

  async setExecutable(executable: unknown): Promise<string> {
    return this.enqueue(async () => {
      await this.initialize()
      if (typeof executable !== 'string' || executable.length > 4_096 || !path.isAbsolute(executable)) {
        throw new Error('Multi-AI Aggregator executable must be an absolute path.')
      }
      const stat = await fs.lstat(executable)
      if (stat.isSymbolicLink() || !stat.isFile() || path.basename(executable).toLocaleLowerCase() !== 'multi-ai aggregator.exe') {
        throw new Error('Select the Multi-AI Aggregator executable file.')
      }
      const realPath = await fs.realpath(executable)
      const previous = this.executablePath
      this.executablePath = realPath
      try {
        await this.persist()
      } catch (error) {
        this.executablePath = previous
        throw error
      }
      return realPath
    })
  }

  async clearExecutable(): Promise<boolean> {
    return this.enqueue(async () => {
      await this.initialize()
      if (!this.executablePath) return false
      const previous = this.executablePath
      this.executablePath = null
      try {
        await fs.unlink(this.settingsPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error
        })
      } catch (error) {
        this.executablePath = previous
        throw error
      }
      return true
    })
  }

  async getStatus(): Promise<LocalIntegrationStatus> {
    await this.initialize()
    if (!this.executablePath) {
      return {
        id: 'multiaggregator',
        name: 'Multi-AI Aggregator',
        state: 'unavailable',
        description: 'Desktop AI workspace and local browser bridge.',
        detail: 'Select the installed Multi-AI Aggregator executable to enable launch from DevKit.',
        canStart: false,
        canStop: false,
        stopHint: STOP_HINT,
      }
    }

    try {
      const stat = await fs.lstat(this.executablePath)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Configured executable is no longer a regular file.')
      const realPath = await fs.realpath(this.executablePath)
      if (realPath.toLocaleLowerCase() !== this.executablePath.toLocaleLowerCase()) {
        throw new Error('Configured executable resolves through a symbolic link.')
      }

      const script = [
        '$exe = ' + quotePowerShell(realPath),
        '$process = Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -ieq $exe } | Select-Object -First 1',
        '$pidValue = if ($process) { [int]$process.ProcessId } else { $null }',
        '[pscustomobject]@{ running = [bool]($null -ne $process); pid = $pidValue } | ConvertTo-Json -Compress',
      ].join('\n')
      const output = await runPowerShell(script)
      const firstBrace = output.indexOf('{')
      const lastBrace = output.lastIndexOf('}')
      if (firstBrace < 0 || lastBrace <= firstBrace) throw new Error('Multi-AI Aggregator returned an invalid process status.')
      const payload: unknown = JSON.parse(output.slice(firstBrace, lastBrace + 1))
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Multi-AI Aggregator process status is invalid.')
      const record = payload as Record<string, unknown>
      const running = record.running === true
      const pid = typeof record.pid === 'number' && Number.isInteger(record.pid) ? record.pid : undefined
      return {
        id: 'multiaggregator',
        name: 'Multi-AI Aggregator',
        state: running ? 'running' : 'stopped',
        description: 'Desktop AI workspace and local browser bridge.',
        detail: running ? 'Application is running. Close it from its own window.' : 'Installed application is ready to launch.',
        ...(pid ? { pid } : {}),
        canStart: !running,
        canStop: false,
        stopHint: STOP_HINT,
      }
    } catch (error) {
      return {
        id: 'multiaggregator',
        name: 'Multi-AI Aggregator',
        state: 'error',
        description: 'Desktop AI workspace and local browser bridge.',
        detail: error instanceof Error ? error.message : 'Could not inspect Multi-AI Aggregator.',
        canStart: false,
        canStop: false,
        stopHint: STOP_HINT,
      }
    }
  }

  async start(): Promise<LocalIntegrationStatus> {
    await this.initialize()
    if (!this.executablePath) throw new Error('Select the Multi-AI Aggregator executable before launching it.')
    const status = await this.getStatus()
    if (status.state === 'running') return status
    if (status.state === 'error' || status.state === 'unavailable') throw new Error(status.detail || 'Multi-AI Aggregator is unavailable.')

    const child = spawn(this.executablePath, [], {
      cwd: path.dirname(this.executablePath),
      detached: true,
      windowsHide: false,
      stdio: 'ignore',
      shell: false,
    })
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('spawn', resolve)
    })
    child.unref()
    return {
      id: 'multiaggregator',
      name: 'Multi-AI Aggregator',
      state: 'starting',
      description: 'Desktop AI workspace and local browser bridge.',
      detail: 'Launch requested. The application owns its window and shutdown lifecycle.',
      canStart: false,
      canStop: false,
      stopHint: STOP_HINT,
    }
  }

  async stop(): Promise<LocalIntegrationStatus> {
    return this.getStatus()
  }
}
