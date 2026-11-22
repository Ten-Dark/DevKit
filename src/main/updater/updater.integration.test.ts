import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  app: { isPackaged: true, getVersion: () => '1.0.1', on: vi.fn() },
  ipcMain: { handle: vi.fn() },
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
}))

vi.mock('electron', () => ({
  app: mocks.app,
  BrowserWindow: vi.fn(),
  ipcMain: mocks.ipcMain,
}))
vi.mock('electron-updater', () => ({ default: { autoUpdater: mocks.autoUpdater } }))

import { resetIpcRegistry } from '../ipc-registry.js'
import {
  __resetUpdaterForTests,
  getUpdaterInfo,
  registerUpdaterHandlers,
} from './updater.js'

describe('Updater IPC integration', () => {
  beforeEach(() => {
    __resetUpdaterForTests()
    resetIpcRegistry()
    vi.clearAllMocks()
    mocks.app.isPackaged = true
  })

  afterEach(() => {
    __resetUpdaterForTests()
    resetIpcRegistry()
  })

  it('registers the updater API including safe download cancellation', () => {
    registerUpdaterHandlers()
    const channels = mocks.ipcMain.handle.mock.calls.map((call) => call[0])
    expect(channels).toEqual([
      'updater:getInfo',
      'updater:check',
      'updater:download',
      'updater:cancelDownload',
      'updater:install',
    ])
    expect(new Set(channels).size).toBe(channels.length)
  })

  it('is idempotent and does not attach duplicate event listeners', () => {
    registerUpdaterHandlers()
    const firstRegistrationCount = mocks.autoUpdater.on.mock.calls.length
    registerUpdaterHandlers()
    expect(mocks.ipcMain.handle).toHaveBeenCalledTimes(5)
    expect(mocks.autoUpdater.on).toHaveBeenCalledTimes(firstRegistrationCount)
  })

  it('exposes a stable initial state through the getInfo IPC handler', async () => {
    registerUpdaterHandlers()
    const handler = mocks.ipcMain.handle.mock.calls.find((call) => call[0] === 'updater:getInfo')?.[1]
    expect(handler).toBeTypeOf('function')
    await expect(handler?.({ senderFrame: { url: 'http://localhost:5173/', parent: null } } as never)).resolves.toMatchObject({
      status: 'idle',
      currentVersion: '1.0.1',
    })
    expect(getUpdaterInfo().status).toBe('idle')
  })

  it('registers status, progress and error event subscriptions once', () => {
    registerUpdaterHandlers()
    const events = mocks.autoUpdater.on.mock.calls.map((call) => call[0])
    expect(events).toEqual([
      'checking-for-update',
      'update-available',
      'update-not-available',
      'download-progress',
      'update-downloaded',
      'error',
    ])
  })
})
