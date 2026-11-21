import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerRuntimeHandlers } from './runtime-ipc.js'

const handlers = new Map<string, (...args: unknown[]) => unknown>()
const registerMock = vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
  handlers.set(channel, handler)
})

vi.mock('./secure-ipc.js', () => ({
  registerTrustedRuntimeIpcHandler: (channel: string, handler: (...args: unknown[]) => unknown) =>
    registerMock(channel, handler),
}))
vi.mock('../window.js', () => ({ mainWindow: null }))
vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn().mockResolvedValue({ canceled: true, filePaths: [] }) },
}))



function createRuntime() {
  return {
    eventLogger: { emit: vi.fn().mockResolvedValue(undefined) },
    listServices: vi.fn().mockResolvedValue([]),
    getServiceDetails: vi.fn().mockResolvedValue({ service: { id: 'api' } }),
    getStartPlan: vi.fn().mockResolvedValue({ toStart: ['api'], canExecute: true }),
    registerService: vi.fn().mockResolvedValue({ id: 'api' }),
    executeStartPlan: vi.fn().mockResolvedValue({ startedServiceIds: ['api'] }),
    stopService: vi.fn().mockResolvedValue({ state: 'stopped' }),
    restartService: vi.fn().mockResolvedValue({ state: 'running' }),
    unregisterService: vi.fn().mockResolvedValue(true),
    getRecentEvents: vi.fn().mockResolvedValue([]),
  }
}

beforeEach(() => {
  handlers.clear()
  registerMock.mockClear()
})

describe('runtime IPC contract', () => {
  it('registers only the declared runtime channels', () => {
    const runtime = createRuntime()
    registerRuntimeHandlers(runtime as never)

    expect([...handlers.keys()]).toEqual(expect.arrayContaining([
      'runtime:listServices',
      'runtime:getServiceDetails',
      'runtime:getStartPlan',
      'runtime:registerService',
      'runtime:executeStartPlan',
      'runtime:stopService',
      'runtime:restartService',
      'runtime:acknowledgeUnobservableStopped',
      'runtime:unregisterService',
      'runtime:getRecentEvents',
      'runtime:selectExecutable',
      'runtime:selectWorkingDirectory',
    ]))
  })

  it('validates service identifiers before calling the runtime', async () => {
    const runtime = createRuntime()
    registerRuntimeHandlers(runtime as never)

    await expect(handlers.get('runtime:getServiceDetails')!({}, '../outside')).rejects.toThrow(/Invalid service identifier/)
    expect(runtime.getServiceDetails).not.toHaveBeenCalled()
  })

  it('validates service identifiers before calling mutating runtime operations', async () => {
    const runtime = createRuntime()
    registerRuntimeHandlers(runtime as never)

    await expect(handlers.get('runtime:stopService')!({}, '../outside')).rejects.toThrow(/Invalid service identifier/)
    expect(runtime.stopService).not.toHaveBeenCalled()
  })

  it('validates approved service IDs and prevents duplicate plan entries', async () => {
    const runtime = createRuntime()
    registerRuntimeHandlers(runtime as never)

    await expect(
      handlers.get('runtime:executeStartPlan')!({}, 'api', ['api', 'api']),
    ).rejects.toThrow(/Approved service identifiers are invalid/)
    expect(runtime.executeStartPlan).not.toHaveBeenCalled()
  })

  it('audits successful mutations with a main-process-generated operation ID', async () => {
    const runtime = createRuntime()
    registerRuntimeHandlers(runtime as never)

    await expect(
      handlers.get('runtime:stopService')!({}, 'api'),
    ).resolves.toEqual({ state: 'stopped' })

    expect(runtime.stopService).toHaveBeenCalledWith('api')
    expect(runtime.eventLogger.emit).toHaveBeenCalledTimes(2)
    expect(runtime.eventLogger.emit).toHaveBeenNthCalledWith(1, expect.objectContaining({
      type: 'runtime.operation.started',
      correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    }))
    expect(runtime.eventLogger.emit).toHaveBeenNthCalledWith(2, expect.objectContaining({
      type: 'runtime.operation.completed',
      correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    }))
    const events = runtime.eventLogger.emit.mock.calls.map(([event]) => event as { correlationId: string })
    expect(events[1].correlationId).toBe(events[0].correlationId)
  })


  it('audits failed mutations and propagates the original error', async () => {
    const runtime = createRuntime()
    runtime.stopService.mockRejectedValueOnce(new Error('dependent service is running'))
    registerRuntimeHandlers(runtime as never)

    await expect(handlers.get('runtime:stopService')!({}, 'api'))
      .rejects.toThrow('dependent service is running')
    expect(runtime.eventLogger.emit).toHaveBeenCalledTimes(2)
    expect(runtime.eventLogger.emit).toHaveBeenLastCalledWith(expect.objectContaining({
      type: 'runtime.operation.failed',
      correlationId: expect.stringMatching(/^[0-9a-f-]{36}$/i),
    }))
  })

  it('validates event limits', async () => {
    const runtime = createRuntime()
    registerRuntimeHandlers(runtime as never)

    await expect(handlers.get('runtime:getRecentEvents')!({}, 10_001)).rejects.toThrow(/between 1 and 1000/)
    expect(runtime.getRecentEvents).not.toHaveBeenCalled()
  })
})
