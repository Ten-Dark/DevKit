import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'node:path'
import { app, ipcMain } from 'electron'
import { resetIpcRegistry } from '../ipc-registry.js'
import { isTrustedRuntimeIpcSender, registerTrustedRuntimeIpcHandler } from './secure-ipc.js'

vi.mock('electron', () => ({
  app: { getAppPath: vi.fn(() => 'C:/devkit') },
  ipcMain: { handle: vi.fn() },
}))

const handled = new Map<string, Function>()

function eventFor(url: string, parent: unknown = null) {
  return {
    sender: { isDestroyed: () => false },
    senderFrame: { url, parent },
  } as never
}

beforeEach(() => {
  handled.clear()
  resetIpcRegistry()
  vi.mocked(app.getAppPath).mockReturnValue('C:/devkit')
  vi.mocked(ipcMain.handle).mockImplementation(((channel: string, handler: Function) => {
    handled.set(channel, handler)
  }) as typeof ipcMain.handle)
})

afterEach(() => {
  resetIpcRegistry()
  vi.restoreAllMocks()
})

describe('trusted runtime IPC boundary', () => {
  it('accepts the configured loopback development renderer', () => {
    expect(isTrustedRuntimeIpcSender(eventFor('http://localhost:5173/'))).toBe(true)
    expect(isTrustedRuntimeIpcSender(eventFor('http://127.0.0.1:5173/'))).toBe(false)
  })

  it('rejects remote origins, unexpected paths and subframes', () => {
    expect(isTrustedRuntimeIpcSender(eventFor('https://example.com/'))).toBe(false)
    expect(isTrustedRuntimeIpcSender(eventFor('http://localhost:5173/untrusted'))).toBe(false)
    expect(isTrustedRuntimeIpcSender(eventFor('http://localhost:5173/', {}))).toBe(false)
  })

  it('accepts only the packaged renderer entry point', () => {
    const rendererPath = path.join('C:/devkit', 'dist-electron', 'renderer', 'index.html')
    const rendererUrl = new URL(`file:///${rendererPath.replaceAll('\\\\', '/')}`).href
    expect(isTrustedRuntimeIpcSender(eventFor(rendererUrl))).toBe(true)
    expect(isTrustedRuntimeIpcSender(eventFor('file:///C:/devkit/other.html'))).toBe(false)
  })

  it('checks the sender before invoking a registered runtime handler', async () => {
    const handler = vi.fn(async (_event: unknown, value: string) => value)
    registerTrustedRuntimeIpcHandler('runtime:test', handler)
    const wrapped = handled.get('runtime:test')
    if (!wrapped) throw new Error('Handler was not registered.')

    await expect(wrapped(eventFor('https://example.com/'), 'blocked')).rejects.toThrow(/Access denied/)
    expect(handler).not.toHaveBeenCalled()
    await expect(wrapped(eventFor('http://localhost:5173/'), 'allowed')).resolves.toBe('allowed')
    expect(handler).toHaveBeenCalledTimes(1)
  })
})
