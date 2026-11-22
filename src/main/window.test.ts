import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs/promises'
import { BrowserWindow, ipcMain } from 'electron'
import { addAllowedBaseDir } from './security.js'
import { resetIpcRegistry } from './ipc-registry.js'

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  dialog: { showOpenDialog: vi.fn(), showSaveDialog: vi.fn() },
  shell: { openExternal: vi.fn() },
  clipboard: { writeText: vi.fn() },
  ipcMain: { handle: vi.fn() },
}))

vi.mock('./updater/index.js', () => ({ setMainWindow: vi.fn() }))

import { createWindow, registerWindowHandlers } from './window.js'

const handled = new Map<string, Function>()
let rootDir: string

beforeEach(async () => {
  handled.clear()
  resetIpcRegistry()
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'window-security-'))
  addAllowedBaseDir(rootDir)
  vi.mocked(ipcMain.handle).mockImplementation((channel, handler) => {
    handled.set(channel, handler)
  })
  registerWindowHandlers()
})

afterEach(async () => {
  await fs.rm(rootDir, { recursive: true, force: true }).catch(() => {})
  vi.clearAllMocks()
})

async function invoke(channel: string, ...args: unknown[]) {
  const handler = handled.get(channel)
  if (!handler) throw new Error(`Missing IPC handler: ${channel}`)
  return handler({ sender: {}, senderFrame: { url: 'http://localhost:5173/', parent: null } } as any, ...args)
}

describe('window filesystem IPC security', () => {
  it('blocks untrusted navigation, redirects, and child windows', () => {
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const webContents = {
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => listeners.set(event, listener)),
      setWindowOpenHandler: vi.fn(),
      openDevTools: vi.fn(),
    }
    const browserWindow = {
      webContents,
      on: vi.fn(),
      loadFile: vi.fn(),
      loadURL: vi.fn(),
    }
    vi.mocked(BrowserWindow).mockImplementation(function () { return browserWindow as unknown as InstanceType<typeof BrowserWindow> })

    createWindow()

    const willNavigate = listeners.get('will-navigate') as ((event: { preventDefault: () => void }, url: string) => void) | undefined
    const blockedNavigation = { preventDefault: vi.fn() }
    willNavigate?.(blockedNavigation, 'https://example.com/')
    expect(blockedNavigation.preventDefault).toHaveBeenCalledOnce()

    const trustedNavigation = { preventDefault: vi.fn() }
    willNavigate?.(trustedNavigation, 'http://localhost:5173/')
    expect(trustedNavigation.preventDefault).not.toHaveBeenCalled()

    const willRedirect = listeners.get('will-redirect') as ((event: { preventDefault: () => void }, url: string) => void) | undefined
    const blockedRedirect = { preventDefault: vi.fn() }
    willRedirect?.(blockedRedirect, 'https://example.com/redirect')
    expect(blockedRedirect.preventDefault).toHaveBeenCalledOnce()

    const openHandler = webContents.setWindowOpenHandler.mock.calls[0]?.[0]
    expect(openHandler?.()).toEqual({ action: 'deny' })
  })

  it('reads a regular file under an approved root', async () => {
    const file = path.join(rootDir, 'allowed.txt')
    await fs.writeFile(file, 'approved')
    await expect(invoke('readFile', file)).resolves.toBe('approved')
  })

  it('writes a regular file under an approved root', async () => {
    const file = path.join(rootDir, 'allowed.txt')
    await invoke('writeFile', file, 'updated')
    await expect(fs.readFile(file, 'utf8')).resolves.toBe('updated')
  })

  it('rejects reading through a junction to an external directory', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'window-outside-'))
    const junction = path.join(rootDir, 'outside')
    const secret = path.join(outside, 'secret.txt')
    await fs.writeFile(secret, 'secret')
    try {
      await fs.symlink(outside, junction, 'junction')
    } catch {
      await fs.rm(outside, { recursive: true, force: true })
      return
    }
    try {
      await expect(invoke('readFile', path.join(junction, 'secret.txt'))).rejects.toThrow(/Access denied/)
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })

  it('rejects writing through a junction to an external directory', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'window-outside-write-'))
    const junction = path.join(rootDir, 'outside')
    const protectedFile = path.join(outside, 'protected.txt')
    await fs.writeFile(protectedFile, 'original')
    try {
      await fs.symlink(outside, junction, 'junction')
    } catch {
      await fs.rm(outside, { recursive: true, force: true })
      return
    }
    try {
      await expect(invoke('writeFile', path.join(junction, 'protected.txt'), 'modified')).rejects.toThrow(/Access denied/)
      await expect(fs.readFile(protectedFile, 'utf8')).resolves.toBe('original')
    } finally {
      await fs.rm(outside, { recursive: true, force: true })
    }
  })
})
