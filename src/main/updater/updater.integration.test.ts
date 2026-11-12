import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock electron modules before importing anything
vi.mock('electron', () => ({
  app: {
    isPackaged: true,
    getVersion: () => '1.0.1',
    on: vi.fn(),
  },
  BrowserWindow: vi.fn(),
  ipcMain: {
    handle: vi.fn(),
  },
}))

// Mock electron-updater default export
vi.mock('electron-updater', () => ({
  default: {
    autoUpdater: {
      autoDownload: false,
      autoInstallOnAppQuit: false,
      updateConfigPath: '',
      checkForUpdates: vi.fn(),
      downloadUpdate: vi.fn(),
      quitAndInstall: vi.fn(),
      on: vi.fn(),
      removeAllListeners: vi.fn(),
    },
  },
}))

import { ipcMain } from 'electron'
import electronUpdater from 'electron-updater'
import { registerUpdaterHandlers, getUpdaterInfo } from './updater'
import { resetIpcRegistry } from '../ipc-registry'

const { autoUpdater } = electronUpdater
const ipcMainHandle = vi.mocked(ipcMain.handle)

describe('Updater integration - updater:getInfo regression', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetIpcRegistry()
  })

  afterEach(() => {
    resetIpcRegistry()
  })

  it('registers updater:getInfo handler without throwing', () => {
    expect(() => registerUpdaterHandlers()).not.toThrow()
    expect(ipcMainHandle).toHaveBeenCalledWith(
      'updater:getInfo',
      expect.any(Function),
    )
  })

  it('registers all four updater IPC handlers exactly once', () => {
    registerUpdaterHandlers()
    const channels = ipcMainHandle.mock.calls.map((c) => c[0])
    expect(channels).toContain('updater:getInfo')
    expect(channels).toContain('updater:check')
    expect(channels).toContain('updater:download')
    expect(channels).toContain('updater:install')
    // No duplicates
    expect(new Set(channels).size).toBe(channels.length)
  })

  it('getUpdaterInfo returns initial idle status', () => {
    const info = getUpdaterInfo()
    expect(info.status).toBe('idle')
    expect(info.currentVersion).toBe('1.0.1')
    expect(info.availableVersion).toBeUndefined()
    expect(info.error).toBeUndefined()
  })

  it('registering handlers twice throws (fail fast)', () => {
    registerUpdaterHandlers()
    expect(() => registerUpdaterHandlers()).toThrow(
      "IPC handler already registered for channel 'updater:getInfo'",
    )
  })

  it('autoUpdater event listeners are attached', () => {
    registerUpdaterHandlers()
    expect(autoUpdater.on).toHaveBeenCalledWith('checking-for-update', expect.any(Function))
    expect(autoUpdater.on).toHaveBeenCalledWith('update-available', expect.any(Function))
    expect(autoUpdater.on).toHaveBeenCalledWith('update-not-available', expect.any(Function))
    expect(autoUpdater.on).toHaveBeenCalledWith('download-progress', expect.any(Function))
    expect(autoUpdater.on).toHaveBeenCalledWith('update-downloaded', expect.any(Function))
    expect(autoUpdater.on).toHaveBeenCalledWith('error', expect.any(Function))
  })
})
