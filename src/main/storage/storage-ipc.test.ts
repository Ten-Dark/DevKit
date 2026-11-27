import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const handlers = vi.hoisted(() => new Map<string, (...args: unknown[]) => unknown>())

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
  },
}))

vi.mock('../ipc-security.js', () => ({
  isTrustedIpcSender: () => true,
}))

import type { IpcMainInvokeEvent } from 'electron'
import { resetIpcRegistry } from '../ipc-registry.js'
import { registerStorageHandlers } from './storage-ipc.js'

describe('Storage IPC secret handling', () => {
  beforeEach(() => {
    handlers.clear()
    resetIpcRegistry()
  })

  afterEach(() => {
    handlers.clear()
    resetIpcRegistry()
  })

  it('prompts in Main Process and never accepts a KeePassXC password from Renderer', async () => {
    const promptForPassword = vi.fn().mockResolvedValue('main-process-only-password')
    const connectWithSecretReference = vi.fn().mockResolvedValue({ state: 'connected' })
    const karakeep = { connectWithSecretReference } as never

    registerStorageHandlers({} as never, karakeep, { promptForPassword })

    const handler = handlers.get('storage:karakeep:connectWithSecretReference')
    expect(handler).toBeTypeOf('function')
    expect(handlers.has('storage:karakeep:connect')).toBe(false)
    expect(handlers.has('storage:karakeep:list')).toBe(false)
    expect(handlers.has('storage:karakeep:search')).toBe(false)
    expect(handlers.has('storage:karakeep:readBookmark')).toBe(false)

    const reference = {
      providerId: 'keepassxc',
      reference: {
        databasePath: 'Y:\\\\data\\\\system_cache.dll',
        entryPath: 'Dev Secrets / SSH & APIes / Karakeep',
        attribute: 'Password',
      },
    }

    await expect(handler!(
      { senderFrame: { url: 'http://localhost:5173/', parent: null } } as unknown as IpcMainInvokeEvent,
      'http://localhost:3001',
      reference,
    )).resolves.toEqual({ state: 'connected' })

    expect(promptForPassword).toHaveBeenCalledOnce()
    expect(connectWithSecretReference).toHaveBeenCalledWith(
      'http://localhost:3001',
      reference,
      'main-process-only-password',
    )
  })

  it('does not resolve the KeePassXC reference when the secure prompt is cancelled', async () => {
    const promptForPassword = vi.fn().mockRejectedValue(new Error('Secure prompt was cancelled.'))
    const connectWithSecretReference = vi.fn()
    registerStorageHandlers(
      {} as never,
      { connectWithSecretReference } as never,
      { promptForPassword },
    )

    const handler = handlers.get('storage:karakeep:connectWithSecretReference')
    await expect(handler!(
      { senderFrame: { url: 'http://localhost:5173/', parent: null } } as unknown as IpcMainInvokeEvent,
      'http://localhost:3001',
      { providerId: 'keepassxc', reference: {} },
    )).rejects.toThrow('Secure prompt was cancelled.')

    expect(connectWithSecretReference).not.toHaveBeenCalled()
  })
})
