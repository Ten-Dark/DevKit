import { beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => Promise<unknown>>())
const showMessageBox = vi.hoisted(() => vi.fn())
const registerHandler = vi.hoisted(() => vi.fn((channel: string, handler: (...args: unknown[]) => Promise<unknown>) => {
  handlers.set(channel, handler)
}))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => 'C:/devkit-test-user-data'), getVersion: vi.fn(() => '1.0.0') },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(value)),
    decryptString: vi.fn((value: Buffer) => value.toString()),
  },
  dialog: {
    showMessageBox: showMessageBox,
    showOpenDialog: vi.fn(),
  },
}))

vi.mock('../window.js', () => ({ mainWindow: null }))
vi.mock('../core/secure-ipc.js', () => ({
  registerTrustedRuntimeIpcHandler: registerHandler,
}))

import { registerMcpHandlers } from './mcp-ipc.js'

const connection = {
  id: 'local-server',
  name: 'Local MCP Server',
  transportType: 'stdio',
  command: 'npx',
  registryName: 'io.example/server',
  registryVersion: '1.0.0',
  state: 'disconnected',
}

function createHub() {
  return {
    listConnections: vi.fn().mockResolvedValue([connection]),
    connect: vi.fn().mockResolvedValue({ ...connection, state: 'connected', tools: [] }),
    disconnect: vi.fn(),
    addConnection: vi.fn(),
    removeConnection: vi.fn(),
  }
}

describe('MCP IPC trust confirmation', () => {
  beforeEach(() => {
    handlers.clear()
    showMessageBox.mockReset()
    registerHandler.mockClear()
  })

  it('requires native confirmation before launching a local MCP process', async () => {
    showMessageBox.mockResolvedValue({ response: 0 })
    const hub = createHub()
    registerMcpHandlers(hub as never)

    const handler = handlers.get('mcp:connect')
    expect(handler).toBeDefined()
    const result = await handler!({}, 'local-server')

    expect(showMessageBox).toHaveBeenCalledOnce()
    expect(showMessageBox.mock.calls[0][0]).toMatchObject({
      type: 'warning',
      title: 'Confirm MCP connection',
      buttons: ['Cancel', 'Connect'],
      defaultId: 0,
      cancelId: 0,
    })
    expect(showMessageBox.mock.calls[0][0].detail).toContain('Windows user permissions')
    expect(result).toBeNull()
    expect(hub.connect).not.toHaveBeenCalled()
  })

  it('connects only after the user confirms the native dialog', async () => {
    showMessageBox.mockResolvedValue({ response: 1 })
    const hub = createHub()
    registerMcpHandlers(hub as never)

    const handler = handlers.get('mcp:connect')
    const result = await handler!({}, 'local-server')

    expect(hub.connect).toHaveBeenCalledOnce()
    expect(hub.connect).toHaveBeenCalledWith('local-server')
    expect(result).toMatchObject({ state: 'connected' })
  })

  it('does not show a confirmation dialog for a missing connection', async () => {
    showMessageBox.mockResolvedValue({ response: 1 })
    const hub = createHub()
    hub.listConnections.mockResolvedValue([])
    registerMcpHandlers(hub as never)

    const handler = handlers.get('mcp:connect')
    await expect(handler!({}, 'local-server')).rejects.toThrow('MCP connection was not found')
    expect(showMessageBox).not.toHaveBeenCalled()
    expect(hub.connect).not.toHaveBeenCalled()
  })
})
