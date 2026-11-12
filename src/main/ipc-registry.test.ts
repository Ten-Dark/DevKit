import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('electron', () => ({
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
    expect(handleMock).toHaveBeenCalledWith('test:channel', handler)
    expect(getRegisteredChannels()).toContain('test:channel')
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
