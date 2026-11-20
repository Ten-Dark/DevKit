import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs/promises'
import { ipcMain } from 'electron'
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

import { registerWindowHandlers } from './window.js'

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
  return handler({ sender: {} } as any, ...args)
}

describe('window filesystem IPC security', () => {
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
