import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => {
  const eventHandlers = new Map<string, Array<(...args: any[]) => void>>()
  const autoUpdater = {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    updateConfigPath: '',
    setFeedURL: vi.fn(),
    checkForUpdates: vi.fn(),
    downloadUpdate: vi.fn(),
    quitAndInstall: vi.fn(),
    on: vi.fn((event: string, handler: (...args: any[]) => void) => {
      const listeners = eventHandlers.get(event) ?? []
      listeners.push(handler)
      eventHandlers.set(event, listeners)
      return autoUpdater
    }),
    removeAllListeners: vi.fn(() => eventHandlers.clear()),
    emit: (event: string, ...args: any[]) => {
      for (const handler of [...(eventHandlers.get(event) ?? [])]) handler(...args)
    },
    listenerCount: (event: string) => eventHandlers.get(event)?.length ?? 0,
  }
  return {
    eventHandlers,
    autoUpdater,
    app: {
      isPackaged: true,
      getVersion: () => '1.0.1',
      on: vi.fn(),
    },
    ipcMain: { handle: vi.fn() },
  }
})

vi.mock('electron', () => ({
  app: mocks.app,
  BrowserWindow: vi.fn(),
  ipcMain: mocks.ipcMain,
}))

vi.mock('electron-updater', () => ({
  default: { autoUpdater: mocks.autoUpdater },
}))

import { app } from 'electron'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resetIpcRegistry } from '../ipc-registry.js'
import {
  __resetUpdaterForTests,
  cancelDownload,
  checkForUpdates,
  downloadUpdate,
  getUpdaterInfo,
  installUpdate,
  onStatusChange,
  registerUpdaterHandlers,
  startPeriodicCheck,
  stopPeriodicCheck,
} from './updater.js'

const updateResult = (version = '1.0.2') => ({
  isUpdateAvailable: true,
  updateInfo: { version, releaseNotes: 'Fixes', releaseDate: '2026-11-19', files: [] },
})
let updaterResourcesPath = ''

describe('Updater lifecycle', () => {

  beforeEach(() => {
    __resetUpdaterForTests()
    resetIpcRegistry()
    vi.clearAllMocks()
    mocks.app.isPackaged = true
    updaterResourcesPath = mkdtempSync(join(tmpdir(), 'devkit-updater-test-'))
    writeFileSync(join(updaterResourcesPath, 'app-update.yml'), `provider: github${String.fromCharCode(10)}owner: Ten-Dark${String.fromCharCode(10)}repo: DevKit${String.fromCharCode(10)}channel: latest${String.fromCharCode(10)}publisherName:${String.fromCharCode(10)}  - "DevKit Test Publisher"${String.fromCharCode(10)}`)
    Object.defineProperty(process, 'resourcesPath', { configurable: true, value: updaterResourcesPath })
    mocks.autoUpdater.checkForUpdates.mockResolvedValue({
      isUpdateAvailable: false,
      updateInfo: { version: '1.0.1', files: [] },
    })
    mocks.autoUpdater.downloadUpdate.mockResolvedValue(['update.exe'])
    registerUpdaterHandlers()
  })

  afterEach(() => {
    stopPeriodicCheck()
    __resetUpdaterForTests()
    resetIpcRegistry()
    vi.useRealTimers()
    Reflect.deleteProperty(process, 'resourcesPath')
    rmSync(updaterResourcesPath, { recursive: true, force: true })
    updaterResourcesPath = ''
  })

  it('starts idle and configures explicit user consent', () => {
    expect(getUpdaterInfo()).toMatchObject({ status: 'idle', currentVersion: '1.0.1' })
    expect(mocks.autoUpdater.autoDownload).toBe(false)
    expect(mocks.autoUpdater.autoInstallOnAppQuit).toBe(false)
    expect(mocks.autoUpdater.setFeedURL).not.toHaveBeenCalled()
  })

  it('allows unsigned packaged builds when publisherName is omitted and rejects the legacy disable sentinel', async () => {
    writeFileSync(join(updaterResourcesPath, 'app-update.yml'), `provider: github${String.fromCharCode(10)}owner: Ten-Dark${String.fromCharCode(10)}repo: DevKit${String.fromCharCode(10)}channel: latest${String.fromCharCode(10)}`)
    const unsignedResult = await checkForUpdates()
    expect(unsignedResult.status).toBe('update-not-available')
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)

    writeFileSync(join(updaterResourcesPath, 'app-update.yml'), `provider: github${String.fromCharCode(10)}owner: Ten-Dark${String.fromCharCode(10)}repo: DevKit${String.fromCharCode(10)}publisherName: UNSIGNED_BUILD_UPDATES_DISABLED${String.fromCharCode(10)}`)

    const result = await checkForUpdates()
    expect(result.status).toBe('unsupported')
    expect(result.error).toContain('no trusted code-signing publisher')
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(await downloadUpdate()).toMatchObject({ success: false, error: expect.stringContaining('no trusted publisher') })
    expect(installUpdate()).toMatchObject({ success: false, error: expect.stringContaining('no trusted publisher') })
  })

  it('uses packaged updater behavior even if NODE_ENV is set to development', async () => {
    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'development'
    try {
      const result = await checkForUpdates()
      expect(result.status).toBe('update-not-available')
      expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousNodeEnv
    }
  })

  it('reports development/unpackaged mode as unsupported without a network request', async () => {
    mocks.app.isPackaged = false
    const result = await checkForUpdates()
    expect(result.status).toBe('unsupported')
    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('checks successfully and distinguishes no update from an error', async () => {
    const result = await checkForUpdates()
    expect(result.status).toBe('update-not-available')
    mocks.autoUpdater.checkForUpdates.mockRejectedValueOnce(new Error('Network unavailable'))
    expect((await checkForUpdates()).status).toBe('error')
    expect(getUpdaterInfo().error).toContain('Network unavailable')
  })

  it('uses updater events and validates release metadata', async () => {
    mocks.autoUpdater.checkForUpdates.mockResolvedValueOnce(updateResult())
    const result = await checkForUpdates()
    expect(result).toMatchObject({ status: 'update-available', availableVersion: '1.0.2', releaseNotes: 'Fixes' })
    mocks.autoUpdater.checkForUpdates.mockResolvedValueOnce(updateResult('not-a-version'))
    expect((await checkForUpdates()).status).toBe('error')
    expect(getUpdaterInfo().error).toContain('malformed')
  })

  it('does not let a late check rejection overwrite a newer update-available event', async () => {
    let reject!: (error: Error) => void
    mocks.autoUpdater.checkForUpdates.mockReturnValueOnce(new Promise((_resolve, done) => { reject = done }))
    const operation = checkForUpdates()
    mocks.autoUpdater.emit('update-available', updateResult().updateInfo)
    reject(new Error('late provider rejection'))
    expect((await operation).status).toBe('update-available')
    expect(getUpdaterInfo().availableVersion).toBe('1.0.2')
  })

  it('coalesces concurrent manual checks into one request', async () => {
    let resolve!: (value: ReturnType<typeof updateResult>) => void
    mocks.autoUpdater.checkForUpdates.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const first = checkForUpdates()
    const second = checkForUpdates()
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    resolve(updateResult())
    expect((await first).status).toBe('update-available')
    expect((await second).status).toBe('update-available')
  })

  it('schedules one startup check and one six-hour interval and cleans both timers', async () => {
    vi.useFakeTimers()
    startPeriodicCheck()
    startPeriodicCheck()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(6 * 60 * 60 * 1000)
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
    stopPeriodicCheck()
    await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000)
    expect(mocks.autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('does not create startup or periodic timers in unpackaged mode', async () => {
    vi.useFakeTimers()
    mocks.app.isPackaged = false
    startPeriodicCheck()
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
    expect(mocks.autoUpdater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('rejects download without a confirmed available update', async () => {
    expect(await downloadUpdate()).toMatchObject({ success: false })
    expect(mocks.autoUpdater.downloadUpdate).not.toHaveBeenCalled()
  })

  it('tracks progress and only enters downloaded after the downloaded event', async () => {
    mocks.autoUpdater.checkForUpdates.mockResolvedValueOnce(updateResult())
    await checkForUpdates()
    let finish!: (paths: string[]) => void
    mocks.autoUpdater.downloadUpdate.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const operation = downloadUpdate()
    mocks.autoUpdater.emit('download-progress', { percent: 42.5, bytesPerSecond: 2048, total: 1000, transferred: 425 })
    expect(getUpdaterInfo()).toMatchObject({
      status: 'downloading',
      downloadProgress: 42.5,
      downloadSpeedBytesPerSecond: 2048,
      downloadedBytes: 425,
      totalBytes: 1000,
    })
    mocks.autoUpdater.emit('update-downloaded', { version: '1.0.2', releaseNotes: 'Fixes' })
    expect(getUpdaterInfo().status).toBe('downloaded')
    finish(['update.exe'])
    expect(await operation).toMatchObject({ success: true })
  })

  it('preserves the available version after a failed download so retry is possible', async () => {
    mocks.autoUpdater.checkForUpdates.mockResolvedValueOnce(updateResult())
    await checkForUpdates()
    mocks.autoUpdater.downloadUpdate.mockRejectedValueOnce(new Error('Connection dropped'))
    expect(await downloadUpdate()).toMatchObject({ success: false })
    expect(getUpdaterInfo()).toMatchObject({ status: 'error', availableVersion: '1.0.2' })
    mocks.autoUpdater.downloadUpdate.mockImplementationOnce(async () => {
      mocks.autoUpdater.emit('update-downloaded', { version: '1.0.2' })
      return ['update.exe']
    })
    expect(await downloadUpdate()).toMatchObject({ success: true })
    expect(getUpdaterInfo().status).toBe('downloaded')
  })

  it('rejects a downloaded payload whose version differs from the checked release', async () => {
    mocks.autoUpdater.checkForUpdates.mockResolvedValueOnce(updateResult())
    await checkForUpdates()
    let finish!: (paths: string[]) => void
    mocks.autoUpdater.downloadUpdate.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const operation = downloadUpdate()
    mocks.autoUpdater.emit('update-downloaded', { version: '1.0.9' })
    expect(getUpdaterInfo()).toMatchObject({ status: 'error', availableVersion: '1.0.2' })
    finish(['update.exe'])
    expect(await operation).toMatchObject({ success: false })
  })

  it('ignores stale updater errors after a check and after download completion', async () => {
    mocks.autoUpdater.checkForUpdates.mockResolvedValueOnce(updateResult())
    await checkForUpdates()
    mocks.autoUpdater.emit('error', new Error('stale check error'))
    expect(getUpdaterInfo().status).toBe('update-available')

    let finish!: (paths: string[]) => void
    mocks.autoUpdater.downloadUpdate.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const operation = downloadUpdate()
    expect(getUpdaterInfo().status).toBe('downloading')
    mocks.autoUpdater.emit('update-downloaded', { version: '1.0.2' })
    mocks.autoUpdater.emit('error', new Error('stale download error'))
    expect(getUpdaterInfo().status).toBe('downloaded')
    finish(['update.exe'])
    expect(await operation).toMatchObject({ success: true })
  })

  it('coalesces concurrent download requests into one updater operation', async () => {
    mocks.autoUpdater.checkForUpdates.mockResolvedValueOnce(updateResult())
    await checkForUpdates()
    let finish!: (paths: string[]) => void
    mocks.autoUpdater.downloadUpdate.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
    const first = downloadUpdate()
    const second = downloadUpdate()
    expect(mocks.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
    mocks.autoUpdater.emit('update-not-available')
    mocks.autoUpdater.emit('update-available', updateResult('1.0.9').updateInfo)
    expect(getUpdaterInfo().status).toBe('downloading')
    mocks.autoUpdater.emit('update-downloaded', { version: '1.0.2' })
    finish(['update.exe'])
    expect(await first).toMatchObject({ success: true })
    expect(await second).toMatchObject({ success: true })
  })

  it('supports safe cancellation and returns to update-available', async () => {
    mocks.autoUpdater.checkForUpdates.mockResolvedValueOnce(updateResult())
    await checkForUpdates()
    mocks.autoUpdater.downloadUpdate.mockImplementationOnce((token: { on: (event: string, cb: () => void) => void }) =>
      new Promise((_resolve, reject) => token.on('cancel', () => reject(new Error('cancelled')))),
    )
    const operation = downloadUpdate()
    expect(cancelDownload()).toMatchObject({ success: true })
    expect(getUpdaterInfo().cancellationRequested).toBe(true)
    expect(await operation).toMatchObject({ success: false })
    expect(getUpdaterInfo()).toMatchObject({ status: 'update-available', availableVersion: '1.0.2' })
  })

  it('prevents duplicate installs and calls quitAndInstall only after download completion', async () => {
    expect(installUpdate()).toMatchObject({ success: false })
    mocks.autoUpdater.checkForUpdates.mockResolvedValueOnce(updateResult())
    await checkForUpdates()
    mocks.autoUpdater.downloadUpdate.mockImplementationOnce(async () => {
      mocks.autoUpdater.emit('update-downloaded', { version: '1.0.2' })
      return ['update.exe']
    })
    await downloadUpdate()
    expect(installUpdate()).toMatchObject({ success: true })
    expect(installUpdate()).toMatchObject({ success: false })
    expect(mocks.autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
    expect(getUpdaterInfo().status).toBe('installing')
  })

  it('recovers to an error if quitAndInstall throws synchronously', async () => {
    mocks.autoUpdater.checkForUpdates.mockResolvedValueOnce(updateResult())
    await checkForUpdates()
    mocks.autoUpdater.downloadUpdate.mockImplementationOnce(async () => {
      mocks.autoUpdater.emit('update-downloaded', { version: '1.0.2' })
      return ['update.exe']
    })
    await downloadUpdate()
    mocks.autoUpdater.quitAndInstall.mockImplementationOnce(() => { throw new Error('Installer launch failed') })
    expect(installUpdate()).toMatchObject({ success: false, error: 'Installer launch failed' })
    expect(getUpdaterInfo()).toMatchObject({ status: 'downloaded', error: 'Installer launch failed' })
    expect(installUpdate()).toMatchObject({ success: true })
  })

  it('recovers from a stuck installation state with a retryable downloaded state', async () => {
    vi.useFakeTimers()
    mocks.autoUpdater.checkForUpdates.mockResolvedValueOnce(updateResult())
    await checkForUpdates()
    mocks.autoUpdater.downloadUpdate.mockImplementationOnce(async () => {
      mocks.autoUpdater.emit('update-downloaded', { version: '1.0.2' })
      return ['update.exe']
    })
    await downloadUpdate()
    expect(installUpdate()).toMatchObject({ success: true })
    await vi.advanceTimersByTimeAsync(30_000)
    expect(getUpdaterInfo()).toMatchObject({
      status: 'downloaded',
      error: 'The installer did not start the application restart. You can retry installation.',
    })
  })

  it('registers IPC handlers and updater events exactly once', () => {
    registerUpdaterHandlers()
    registerUpdaterHandlers()
    const channels = mocks.ipcMain.handle.mock.calls.map((call) => call[0])
    expect(channels).toEqual([
      'updater:getInfo',
      'updater:check',
      'updater:download',
      'updater:cancelDownload',
      'updater:install',
    ])
    expect(mocks.autoUpdater.listenerCount('update-available')).toBe(1)
  })

  it('cleans status subscriptions when the renderer unsubscribes', async () => {
    const listener = vi.fn()
    const unsubscribe = onStatusChange(listener)
    await checkForUpdates()
    expect(listener).toHaveBeenCalled()
    unsubscribe()
    listener.mockClear()
    await checkForUpdates()
    expect(listener).not.toHaveBeenCalled()
  })
})
