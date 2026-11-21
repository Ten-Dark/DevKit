import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import { RuntimeCore } from './runtime-core.js'
import type { ServiceDefinition } from './contracts.js'
import { createTestProcessControlProvider } from './test-process-control-provider.js'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(),
    getVersion: vi.fn(() => '1.0.0'),
  },
}))

let tempDir: string
let runtime: RuntimeCore

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devkit-runtime-core-'))
  vi.mocked(app.getPath).mockReturnValue(tempDir)
  runtime = new RuntimeCore({
    registry: { filePath: path.join(tempDir, 'registry', 'services.json') },
    processManager: {
      processControlProvider: createTestProcessControlProvider(),
      stateFilePath: path.join(tempDir, 'registry', 'process-instances.json'),
      gracefulStopTimeoutMs: 2_000,
    },
    eventFilePath: path.join(tempDir, 'events', 'runtime.jsonl'),
    readinessTimeoutMs: 1_000,
    readinessPollIntervalMs: 50,
  })
})

afterEach(async () => {
  const services = await runtime.registry.list().catch(() => [])
  for (const service of services) {
    await runtime.processManager.stop(service).catch(() => undefined)
  }
  await fs.rm(tempDir, { recursive: true, force: true })
})

function makeService(
  id: string,
  dependencies: ServiceDefinition['dependencies'] = [],
  executablePath = process.execPath,
): ServiceDefinition {
  return {
    id,
    name: id,
    version: '1.0.0',
    adapterId: 'process.local',
    owner: { kind: 'managed', resourceId: id },
    capabilities: ['status', 'health', 'start', 'stop', 'restart', 'logs'],
    platforms: ['win32'],
    dependencies,
    config: {
      executablePath,
      args: ['-e', 'setInterval(() => {}, 1000)'],
      workingDirectory: tempDir,
    },
  }
}

describe('runtime core orchestration', () => {
  it('registers a managed local service and reports its initial stopped state', async () => {
    await runtime.registerService(makeService('api'))

    const services = await runtime.listServices()
    expect(services).toHaveLength(1)
    expect(services[0].service.id).toBe('api')
    expect(services[0].snapshot.state).toBe('stopped')
  })

  it('requires status and health capabilities and rejects connected process ownership', async () => {
    await expect(runtime.registerService({
      ...makeService('missing-observation'),
      capabilities: ['start', 'stop'],
    })).rejects.toThrow(/status and health/)

    await expect(runtime.registerService({
      ...makeService('connected'),
      owner: { kind: 'connected', provider: 'external', resourceId: 'connected' },
    })).rejects.toThrow(/DevKit-managed/)

    await expect(runtime.registerService({
      ...makeService('owner-mismatch'),
      owner: { kind: 'managed', resourceId: 'another-service' },
    })).rejects.toThrow(/must match the service identifier/)

    await expect(runtime.registerService({
      ...makeService('unsupported-platform'),
      platforms: ['linux'],
    })).rejects.toThrow(/does not support/)

    await expect(runtime.registerService({
      ...makeService('unrecognized-config'),
      config: { ...makeService('unrecognized-config').config, accessToken: 'must-not-persist' },
    })).rejects.toThrow(/unsupported process config key/)
  })

  it('executes an explicitly approved provider-first startup plan', async () => {
    await runtime.registerService(makeService('application', [{ serviceId: 'database', required: true }]))
    await runtime.registerService(makeService('database'))

    const plan = await runtime.getStartPlan('application')
    expect(plan.toStart).toEqual(['database', 'application'])
    expect(plan.canExecute).toBe(true)

    const result = await runtime.executeStartPlan('application', plan.toStart)
    expect(result.startedServiceIds).toEqual(['database', 'application'])
    expect(result.services.every((item) => item.snapshot.state === 'running')).toBe(true)

    await expect(runtime.stopService('database')).rejects.toThrow(/dependent service 'application'/)
    await runtime.stopService('application')
    await runtime.stopService('database')
  })

  it('restarts a managed service through its adapter and readiness checks', async () => {
    await runtime.registerService(makeService('api'))
    const plan = await runtime.getStartPlan('api')
    await runtime.executeStartPlan('api', plan.toStart)
    const before = await runtime.processManager.getObservation('api')

    const restarted = await runtime.restartService('api')
    const after = await runtime.processManager.getObservation('api')

    expect(restarted.state).toBe('running')
    expect(after.state).toBe('present')
    expect(after.pid).not.toBe(before.pid)
    await runtime.stopService('api')
  })

  it.each(['degraded', 'unknown'] as const)('blocks startup plans when a registered process is %s', async (state) => {
    await runtime.registerService(makeService('api'))
    const initialPlan = await runtime.getStartPlan('api')
    await runtime.executeStartPlan('api', initialPlan.toStart)
    const process = await runtime.processManager.getObservation('api')

    vi.spyOn(runtime.healthManager, 'check').mockResolvedValue({
      serviceId: 'api',
      state,
      process: state === 'unknown' ? { ...process, state: 'unobservable', identityVerified: false } : process,
      healthChecks: [],
      observedAt: new Date().toISOString(),
    })

    const plan = await runtime.getStartPlan('api')
    expect(plan.canExecute).toBe(false)
    expect(plan.blockers.join(' ')).toContain(`Service 'api' is ${state}`)
  })

  it('blocks startup plans when a required service lacks lifecycle capabilities', async () => {
    await runtime.registerService({
      ...makeService('read-only'),
      capabilities: ['status', 'health'],
    })

    const plan = await runtime.getStartPlan('read-only')
    expect(plan.canExecute).toBe(false)
    expect(plan.blockers[0]).toContain('cannot be started safely')
  })

  it('rejects execution when the confirmed plan no longer matches', async () => {
    await runtime.registerService(makeService('api'))
    await expect(runtime.executeStartPlan('api', [])).rejects.toThrow(/plan changed/)
    expect((await runtime.processManager.getObservation('api')).state).toBe('absent')
  })

  it('rolls back only services newly started by a failed dependency plan', async () => {
    await runtime.registerService(makeService('application', [{ serviceId: 'database', required: true }], path.join(tempDir, 'missing.exe')))
    await runtime.registerService(makeService('database'))

    const plan = await runtime.getStartPlan('application')
    await expect(runtime.executeStartPlan('application', plan.toStart)).rejects.toThrow(/Startup plan failed/)
    expect((await runtime.processManager.getObservation('database')).state).toBe('exited')
    expect((await runtime.processManager.getObservation('application')).state).toBe('absent')
  })

  it('serializes lifecycle and unregister mutations to prevent orphaned processes', async () => {
    await runtime.registerService(makeService('api'))
    const plan = await runtime.getStartPlan('api')
    const originalStart = runtime.processManager.start.bind(runtime.processManager)
    vi.spyOn(runtime.processManager, 'start').mockImplementation(async (...args) => {
      await new Promise((resolve) => setTimeout(resolve, 100))
      return originalStart(...args)
    })

    const starting = runtime.executeStartPlan('api', plan.toStart)
    const unregistering = runtime.unregisterService('api')
    await starting
    await expect(unregistering).rejects.toThrow(/process may still be running/)
    expect(await runtime.registry.get('api')).toBeDefined()
    await runtime.stopService('api')
  })

  it('prevents unregistering a service with registered dependents', async () => {
    await runtime.registerService(makeService('application', [{ serviceId: 'database', required: true }]))
    await runtime.registerService(makeService('database'))

    await expect(runtime.unregisterService('database')).rejects.toThrow(/depend on it/)
    await runtime.unregisterService('application')
    await expect(runtime.unregisterService('database')).resolves.toBe(true)
  })

  it('does not delete service data when removing a registration', async () => {
    await runtime.registerService(makeService('api'))
    const serviceData = path.join(tempDir, 'service-data', 'api')
    await fs.mkdir(serviceData, { recursive: true })
    await fs.writeFile(path.join(serviceData, 'state.txt'), 'preserve')

    await runtime.unregisterService('api')
    await expect(fs.readFile(path.join(serviceData, 'state.txt'), 'utf8')).resolves.toBe('preserve')
  })
})
