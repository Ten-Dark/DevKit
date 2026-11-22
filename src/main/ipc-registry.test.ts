import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({
  app: { getAppPath: vi.fn(() => 'C:/devkit') },
  ipcMain: {
    handle: vi.fn(),
  },
}))

import { ipcMain } from 'electron'
import { registerIpcHandler, getRegisteredChannels, resetIpcRegistry } from './ipc-registry'

const handleMock = vi.mocked(ipcMain.handle)

describe('IPC handler registry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetIpcRegistry()
  })

  afterEach(() => {
    resetIpcRegistry()
  })

  it('registers a handler successfully on first call', () => {
    const handler = () => 'result'
    expect(() => registerIpcHandler('test:channel', handler)).not.toThrow()
    expect(handleMock).toHaveBeenCalledWith('test:channel', expect.any(Function))
    expect(getRegisteredChannels()).toContain('test:channel')
  })

  it('rejects calls from untrusted documents before invoking handlers', async () => {
    const handler = vi.fn(async () => 'allowed')
    registerIpcHandler('test:protected', handler)
    const wrapped = handleMock.mock.calls[0][1] as (event: unknown) => Promise<string>

    await expect(wrapped({ senderFrame: { url: 'https://example.com/', parent: null } })).rejects.toThrow(/Access denied/)
    await expect(wrapped({ senderFrame: { url: 'http://localhost:5173/', parent: {} } })).rejects.toThrow(/Access denied/)
    await expect(wrapped({})).rejects.toThrow(/Access denied/)
    expect(handler).not.toHaveBeenCalled()

    await expect(wrapped({ senderFrame: { url: 'http://localhost:5173/', parent: null } })).resolves.toBe('allowed')
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('throws on double registration of the same channel', () => {
    const handler1 = () => 'first'
    const handler2 = () => 'second'
    registerIpcHandler('test:channel', handler1)
    expect(() => registerIpcHandler('test:channel', handler2)).toThrow(
      "IPC handler already registered for channel 'test:channel'",
    )
    // Second handler should NOT have been registered
    expect(handleMock).toHaveBeenCalledTimes(1)
  })

  it('allows different channels to be registered', () => {
    registerIpcHandler('channel:one', () => 'one')
    registerIpcHandler('channel:two', () => 'two')
    expect(handleMock).toHaveBeenCalledTimes(2)
    expect(getRegisteredChannels()).toHaveLength(2)
    expect(getRegisteredChannels()).toContain('channel:one')
    expect(getRegisteredChannels()).toContain('channel:two')
  })

  it('reset clears the registry', () => {
    registerIpcHandler('test:channel', () => 'test')
    expect(getRegisteredChannels()).toHaveLength(1)
    resetIpcRegistry()
    expect(getRegisteredChannels()).toHaveLength(0)
    // After reset, the channel can be registered again
    registerIpcHandler('test:channel', () => 'test again')
    expect(handleMock).toHaveBeenCalledTimes(2)
  })
})
