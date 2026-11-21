import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProcessManager } from './process-manager.js'
import type { ProcessControlProvider } from './process-control-provider.js'
import type { ServiceDefinition } from './contracts.js'

let tempDir: string
let stateFilePath: string
let service: ServiceDefinition

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devkit-process-'))
  stateFilePath = path.join(tempDir, 'registry', 'process-instances.json')
  service = {
    id: 'test-service',
    name: 'Test Service',
    version: '1.0.0',
    adapterId: 'process.local',
    owner: { kind: 'managed', resourceId: 'test-service' },
    capabilities: ['status', 'health', 'start', 'stop'],
    platforms: [process.platform],
    dependencies: [],
    config: {},
  }
})

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true })
})

function launchSpec(args = ['-e', 'setInterval(() => {}, 1000)']) {
  return {
    executablePath: process.execPath,
    args,
    workingDirectory: tempDir,
  }
}

describe('process manager', () => {
  it('starts and stops only a process launched by this manager', async () => {
    const manager = new ProcessManager({ stateFilePath, gracefulStopTimeoutMs: 2_000 })
    const started = await manager.start(service, launchSpec())

    expect(started.state).toBe('present')
    expect(started.identityVerified).toBe(true)
    expect(started.pid).toBeTypeOf('number')

    const stopped = await manager.stop(service)
    expect(stopped.state).toBe('exited')
    expect(stopped.identityVerified).toBe(true)
    expect(await manager.getObservation(service.id)).toMatchObject({ state: 'exited' })
  })

  it('rejects duplicate starts for a service already managed by this instance', async () => {
    const manager = new ProcessManager({ stateFilePath })
    await manager.start(service, launchSpec())

    await expect(manager.start(service, launchSpec())).rejects.toThrow(/already running/)
    await manager.stop(service)
  })

  it('rejects connected services and missing lifecycle capabilities', async () => {
    const manager = new ProcessManager({ stateFilePath })
    const connected = {
      ...service,
      owner: { kind: 'connected' as const, provider: 'external', resourceId: 'external-service' },
    }
    await expect(manager.start(connected, launchSpec())).rejects.toThrow(/DevKit-managed/)
    await expect(manager.start({ ...service, capabilities: ['start'] }, launchSpec())).rejects.toThrow(/both start and stop/)
  })

  it('validates absolute paths, argument bounds and secret environment variables', async () => {
    const manager = new ProcessManager({ stateFilePath })

    await expect(manager.start(service, { ...launchSpec(), executablePath: 'node.exe' })).rejects.toThrow(/absolute/)
    await expect(manager.start(service, { ...launchSpec(), workingDirectory: '.' })).rejects.toThrow(/absolute/)
    await expect(manager.start(service, { ...launchSpec(), env: { API_TOKEN: 'sensitive' } })).rejects.toThrow(/not allowed/)
    await expect(manager.start(service, { ...launchSpec(), args: ['bad\0argument'] })).rejects.toThrow(/valid string/)
  })

  it('does not reattach to or terminate a PID recorded by a previous app session', async () => {
    const firstManager = new ProcessManager({ stateFilePath, gracefulStopTimeoutMs: 2_000 })
    const started = await firstManager.start(service, launchSpec())
    const secondManager = new ProcessManager({ stateFilePath })

    await expect(secondManager.getObservation(service.id)).resolves.toMatchObject({
      state: 'unobservable',
      pid: started.pid,
      identityVerified: false,
    })
    await expect(secondManager.stop(service)).rejects.toThrow(/refusing to terminate/)
    await expect(secondManager.start(service, launchSpec())).rejects.toThrow(/refusing to start a duplicate/)

    await firstManager.stop(service)
    // Drain exit-event persistence before the next session acknowledges the old record.
    await firstManager.getObservation(service.id)
    await secondManager.acknowledgeUnobservableStopped(service.id, true)
    await expect(secondManager.getObservation(service.id)).resolves.toMatchObject({ state: 'absent' })
  })

  it('requires explicit confirmation before clearing an unobservable process record', async () => {
    const firstManager = new ProcessManager({ stateFilePath })
    await firstManager.start(service, launchSpec())
    const secondManager = new ProcessManager({ stateFilePath })
    await expect(secondManager.acknowledgeUnobservableStopped(service.id, false)).rejects.toThrow(/confirmation/)
    await firstManager.stop(service)
    // Ensure the prior manager has finished its queued exit persistence.
    await firstManager.getObservation(service.id)
    await secondManager.acknowledgeUnobservableStopped(service.id, true)
  })

  it('fails closed and preserves a corrupt process state file', async () => {
    await fs.mkdir(path.dirname(stateFilePath), { recursive: true })
    await fs.writeFile(stateFilePath, '{broken')
    const manager = new ProcessManager({ stateFilePath })

    await expect(manager.initialize()).rejects.toThrow()
    expect(await fs.readFile(stateFilePath, 'utf8')).toBe('{broken')
  })

  it('does not misreport process lifecycle when event-log persistence is unavailable', async () => {
    const logger = { emit: vi.fn().mockRejectedValue(new Error('event log unavailable')) }
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const manager = new ProcessManager({
      stateFilePath,
      eventLogger: logger as never,
      gracefulStopTimeoutMs: 2_000,
    })

    const started = await manager.start(service, launchSpec())
    expect(started.state).toBe('present')
    const stopped = await manager.stop(service)
    expect(stopped.state).toBe('exited')
  })

  it('cancels a process through its own managed child handle', async () => {
    const manager = new ProcessManager({ stateFilePath, gracefulStopTimeoutMs: 2_000 })
    const controller = new AbortController()
    await manager.start(service, launchSpec(), controller.signal)
    controller.abort()

    const deadline = Date.now() + 3_000
    let observation = await manager.getObservation(service.id)
    while (observation.state === 'present' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25))
      observation = await manager.getObservation(service.id)
    }
    expect(observation.state).toBe('exited')
    await manager.stop(service)
  })
  it('does not report a process stopped when termination fails', async () => {
    const child = new EventEmitter() as EventEmitter & { pid: number; kill: (signal: NodeJS.Signals) => boolean }
    child.pid = 12_345
    child.kill = vi.fn((_signal: NodeJS.Signals) => {
      queueMicrotask(() => child.emit('error', new Error('Access denied')))
      return false
    })
    const processControlProvider: ProcessControlProvider = {
      platform: process.platform,
      capabilities: {
        gracefulShutdown: false,
        processTreeManagement: false,
        ownershipVerification: 'session-child-reference',
      },
      spawn: (() => {
        queueMicrotask(() => child.emit('spawn'))
        return child as never
      }) as ProcessControlProvider['spawn'],
      requestGracefulStop: () => 'unsupported',
      forceTerminate: () => child.kill('SIGKILL'),
    }
    const manager = new ProcessManager({ stateFilePath, forceStopTimeoutMs: 100, processControlProvider })

    await manager.start(service, launchSpec())
    await expect(manager.stop(service)).rejects.toThrow(/did not exit/)
    await expect(manager.getObservation(service.id)).resolves.toMatchObject({
      state: 'unobservable',
      identityVerified: false,
    })
    expect(child.kill).toHaveBeenCalledTimes(1)
  })

  it('waits for a provider-confirmed graceful stop before forcing termination', async () => {
    const child = new EventEmitter() as EventEmitter & { pid: number }
    child.pid = 12_346
    const forceTerminate = vi.fn(() => true)
    const processControlProvider: ProcessControlProvider = {
      platform: process.platform,
      capabilities: {
        gracefulShutdown: true,
        processTreeManagement: false,
        ownershipVerification: 'session-child-reference',
      },
      spawn: (() => {
        queueMicrotask(() => child.emit('spawn'))
        return child as never
      }) as ProcessControlProvider['spawn'],
      requestGracefulStop: () => {
        queueMicrotask(() => child.emit('exit', 0, null))
        return 'requested'
      },
      forceTerminate,
    }
    const manager = new ProcessManager({ stateFilePath, processControlProvider })

    await manager.start(service, launchSpec())
    await expect(manager.stop(service)).resolves.toMatchObject({ state: 'exited' })
    expect(forceTerminate).not.toHaveBeenCalled()
  })
})
