import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs/promises'
import { app, ipcMain } from 'electron'
import { resetIpcRegistry } from './ipc-registry.js'
import { DEFAULT_SETTINGS, registerSettingsHandlers, SETTINGS_FILE_NAME } from './settings.js'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(),
    getVersion: vi.fn(() => '1.0.0'),
  },
  ipcMain: { handle: vi.fn() },
}))

const handled = new Map<string, Function>()
let tmpDir: string
let settingsPath: string

beforeEach(async () => {
  vi.restoreAllMocks()
  handled.clear()
  resetIpcRegistry()
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'settings-test-'))
  settingsPath = path.join(tmpDir, SETTINGS_FILE_NAME)
  vi.mocked(app.getPath).mockReturnValue(tmpDir)
  vi.mocked(ipcMain.handle).mockImplementation(((channel: string, handler: Function) => {
    handled.set(channel, handler)
  }) as typeof ipcMain.handle)
  registerSettingsHandlers()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => undefined)
})

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const handler = handled.get(channel)
  if (!handler) throw new Error(`No handler for channel: ${channel}`)
  return handler({ sender: { send: vi.fn() } } as never, ...args) as Promise<T>
}

async function readPersisted(): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(settingsPath, 'utf-8')) as Record<string, unknown>
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('settings persistence', () => {
  it('returns defaults when settings.json does not exist', async () => {
    expect(await invoke('getSettings')).toEqual(DEFAULT_SETTINGS)
  })

  it('preserves unknown fields and merges partial settings', async () => {
    await fs.writeFile(settingsPath, JSON.stringify({ ...DEFAULT_SETTINGS, customField: 'kept' }))
    await invoke('saveSettings', { maxFileSizeKB: 256 })

    const persisted = await readPersisted()
    expect(persisted.maxFileSizeKB).toBe(256)
    expect(persisted.customField).toBe('kept')
    expect(persisted.favorites).toEqual([])
  })

  it('serializes Save then Reset even when Save is still reading the previous file', async () => {
    await fs.writeFile(settingsPath, JSON.stringify({ ...DEFAULT_SETTINGS, favorites: ['project-to-markdown'] }))
    const readStarted = deferred<void>()
    const releaseRead = deferred<string>()
    const readSpy = vi.spyOn(fs, 'readFile').mockImplementationOnce(async () => {
      readStarted.resolve()
      return releaseRead.promise
    })

    const save = invoke('saveSettings', { maxFileSizeKB: 512 })
    await readStarted.promise
    const reset = invoke('resetSettings')
    releaseRead.resolve(JSON.stringify({ ...DEFAULT_SETTINGS, favorites: ['project-to-markdown'] }))

    await expect(save).resolves.toEqual({ success: true })
    await expect(reset).resolves.toEqual({ success: true })
    expect((await readPersisted()).favorites).toEqual([])
    expect((await readPersisted()).maxFileSizeKB).toBe(DEFAULT_SETTINGS.maxFileSizeKB)
    readSpy.mockRestore()
  })

  it('serializes Reset then Save and applies the Save patch to defaults', async () => {
    await fs.writeFile(settingsPath, JSON.stringify({ ...DEFAULT_SETTINGS, favorites: ['project-to-markdown'] }))

    const reset = invoke('resetSettings')
    const save = invoke('saveSettings', { favorites: ['xmind-to-markdown'] })
    await Promise.all([reset, save])

    const persisted = await readPersisted()
    expect(persisted.favorites).toEqual(['xmind-to-markdown'])
    expect(persisted.maxFileSizeKB).toBe(DEFAULT_SETTINGS.maxFileSizeKB)
  })

  it('applies concurrent Save patches in order without losing independent fields', async () => {
    await fs.writeFile(settingsPath, JSON.stringify(DEFAULT_SETTINGS))

    const first = invoke('saveSettings', { maxFileSizeKB: 512 })
    const second = invoke('saveSettings', { includeTree: false })
    const third = invoke('saveSettings', { favorites: ['project-to-markdown'] })
    await Promise.all([first, second, third])

    const persisted = await readPersisted()
    expect(persisted.maxFileSizeKB).toBe(512)
    expect(persisted.includeTree).toBe(false)
    expect(persisted.favorites).toEqual(['project-to-markdown'])
  })

  it('preserves the previous file and continues after a temporary-file write failure', async () => {
    await fs.writeFile(settingsPath, JSON.stringify({ ...DEFAULT_SETTINGS, favorites: ['project-to-markdown'], maxFileSizeKB: 900 }))
    const writeSpy = vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('temp write failed'))

    await expect(invoke('saveSettings', { maxFileSizeKB: 128 })).rejects.toThrow('temp write failed')
    expect((await readPersisted()).maxFileSizeKB).toBe(900)
    expect((await readPersisted()).favorites).toEqual(['project-to-markdown'])
    await expect(invoke('saveSettings', { maxFileSizeKB: 256 })).resolves.toEqual({ success: true })

    expect((await readPersisted()).maxFileSizeKB).toBe(256)
    expect(writeSpy).toHaveBeenCalledTimes(2)
    expect((await fs.readdir(tmpDir)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('preserves the previous file and continues after rename failure', async () => {
    await fs.writeFile(settingsPath, JSON.stringify({ ...DEFAULT_SETTINGS, maxFileSizeKB: 900 }))
    const renameSpy = vi.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('rename failed'))

    await expect(invoke('saveSettings', { maxFileSizeKB: 128 })).rejects.toThrow('rename failed')
    expect((await readPersisted()).maxFileSizeKB).toBe(900)
    await expect(invoke('saveSettings', { maxFileSizeKB: 256 })).resolves.toEqual({ success: true })
    expect((await readPersisted()).maxFileSizeKB).toBe(256)
    expect(renameSpy).toHaveBeenCalledTimes(2)
    expect((await fs.readdir(tmpDir)).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('does not replace settings with defaults when reading fails for a reason other than ENOENT', async () => {
    await fs.writeFile(settingsPath, JSON.stringify({ ...DEFAULT_SETTINGS, favorites: ['project-to-markdown'] }))
    vi.spyOn(fs, 'readFile').mockRejectedValueOnce(Object.assign(new Error('permission denied'), { code: 'EACCES' }))

    await expect(invoke('saveSettings', { maxFileSizeKB: 128 })).rejects.toThrow('permission denied')
    expect((await readPersisted()).favorites).toEqual(['project-to-markdown'])
  })

  it('reset persists a clean copy of defaults and removes previous favorites', async () => {
    await fs.writeFile(settingsPath, JSON.stringify({ ...DEFAULT_SETTINGS, favorites: ['project-to-markdown'] }))

    await expect(invoke('resetSettings')).resolves.toEqual({ success: true })
    expect(await readPersisted()).toEqual(DEFAULT_SETTINGS)
  })
})
