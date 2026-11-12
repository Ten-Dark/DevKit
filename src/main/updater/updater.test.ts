import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

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
    },
  },
}))

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

import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

const mockCheckForUpdates = vi.mocked(autoUpdater.checkForUpdates)
const mockDownloadUpdate = vi.mocked(autoUpdater.downloadUpdate)
const mockQuitAndInstall = vi.mocked(autoUpdater.quitAndInstall)

import {
  getUpdaterInfo,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
} from './updater'

describe('Updater module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockCheckForUpdates.mockResolvedValue(null as any)
    mockDownloadUpdate.mockResolvedValue(undefined as any)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('getUpdaterInfo', () => {
    it('should return initial idle status', () => {
      const info = getUpdaterInfo()
      expect(info.status).toBe('idle')
      expect(info.currentVersion).toBe('1.0.1')
    })
  })

  describe('checkForUpdates', () => {
    it('should return update-not-available when no update found', async () => {
      mockCheckForUpdates.mockResolvedValue(null as any)
      const info = await checkForUpdates()
      expect(info.status).toBe('update-not-available')
      expect(info.currentVersion).toBe('1.0.1')
      expect(mockCheckForUpdates).toHaveBeenCalled()
    })

    it('should return update-available when update found', async () => {
      mockCheckForUpdates.mockResolvedValue({
        updateInfo: {
          version: '1.0.2',
          releaseNotes: 'Bug fixes',
          releaseDate: '2026-01-01',
          files: [],
          path: '',
          sha512: '',
        },
      } as any)
      const info = await checkForUpdates()
      expect(info.status).toBe('update-available')
      expect(info.availableVersion).toBe('1.0.2')
      expect(info.releaseNotes).toBe('Bug fixes')
    })

    it('should handle check errors gracefully', async () => {
      mockCheckForUpdates.mockRejectedValue(new Error('Network error'))
      const info = await checkForUpdates()
      expect(info.status).toBe('error')
      expect(info.error).toContain('Network error')
    })
  })

  describe('downloadUpdate', () => {
    it('should not throw when no update available', async () => {
      await expect(downloadUpdate()).resolves.toBeUndefined()
    })
  })

  describe('installUpdate', () => {
    it('should not throw when no update downloaded', () => {
      expect(() => installUpdate()).not.toThrow()
    })
  })
})
