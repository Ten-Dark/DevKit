import { app, BrowserWindow } from 'electron'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import electronUpdater from 'electron-updater'
import type { AppUpdater } from 'electron-updater'
import { CancellationToken } from 'builder-util-runtime'
import type {
  UpdaterInfo,
  UpdaterDownloadProgress,
  UpdaterEventHandler,
  UpdaterDownloadHandler,
  UpdaterActionResult,
} from './updater.types.js'
import { registerIpcHandler } from '../ipc-registry.js'

const { autoUpdater } = electronUpdater as { autoUpdater: AppUpdater }
autoUpdater.autoDownload = false
autoUpdater.autoInstallOnAppQuit = false

const UNSIGNED_PUBLISHER_SENTINEL = 'UNSIGNED_BUILD_UPDATES_DISABLED'

function hasTrustedPublisherConfiguration(): boolean {
  try {
    const config = readFileSync(join(process.resourcesPath, 'app-update.yml'), 'utf8')
    const lines = config.split(String.fromCharCode(10))
    const publisherIndex = lines.findIndex((line) => line.trim().startsWith('publisherName:'))
    if (publisherIndex < 0) return false

    const inlineValue = lines[publisherIndex].slice(lines[publisherIndex].indexOf(':') + 1).trim()
    const publisherNames = inlineValue ? [inlineValue.replace(/^['"]|['"]$/g, '')] : []
    if (!inlineValue) {
      for (const line of lines.slice(publisherIndex + 1)) {
        const item = line.trim()
        if (!item) continue
        if (!item.startsWith('- ')) break
        publisherNames.push(item.slice(2).trim().replace(/^['"]|['"]$/g, ''))
      }
    }

    return publisherNames.length > 0 &&
      publisherNames.every((name) => name && name !== UNSIGNED_PUBLISHER_SENTINEL && !name.includes('${'))
  } catch {
    return false
  }
}

// A loopback-only feed override is available exclusively to isolated packaged E2E runs.
if (process.env.DEVKIT_UPDATER_TEST_MODE === '1' && process.env.DEVKIT_UPDATER_TEST_FEED_URL) {
  const testFeed = new URL(process.env.DEVKIT_UPDATER_TEST_FEED_URL)
  if (testFeed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(testFeed.hostname)) {
    throw new Error('The updater test feed must use a loopback HTTP URL.')
  }
  autoUpdater.setFeedURL(testFeed.toString())
}

const STARTUP_CHECK_DELAY_MS = 30_000
const INSTALL_WATCHDOG_DELAY_MS = 30_000

let currentStatus: UpdaterInfo = {
  status: 'idle',
  currentVersion: app.getVersion(),
}
let mainWindowRef: BrowserWindow | null = null
let checkPromise: Promise<UpdaterInfo> | null = null
let downloadPromise: Promise<UpdaterActionResult> | null = null
let downloadToken: CancellationToken | null = null
let handlersRegistered = false
let lifecycleStarted = false
let startupCheckTimer: NodeJS.Timeout | null = null
let periodicCheckTimer: NodeJS.Timeout | null = null
let installWatchdogTimer: NodeJS.Timeout | null = null
let installRequested = false

const statusListeners: UpdaterEventHandler[] = []
const downloadListeners: UpdaterDownloadHandler[] = []

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function normalizeReleaseNotes(notes: unknown): string | undefined {
  if (typeof notes === 'string') return notes
  if (!Array.isArray(notes)) return undefined
  const lines = notes.flatMap((entry) => {
    if (typeof entry === 'string') return [entry]
    if (entry && typeof entry === 'object' && 'note' in entry && typeof entry.note === 'string') {
      return [entry.note]
    }
    return []
  })
  return lines.length > 0 ? lines.join('\n\n') : undefined
}

function isValidVersion(version: unknown): version is string {
  return typeof version === 'string' && /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)
}

function notifyStatus(): void {
  const snapshot = { ...currentStatus }
  for (const listener of [...statusListeners]) {
    try { listener(snapshot) } catch { /* A renderer listener must not break updater state. */ }
  }
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    try { mainWindowRef.webContents.send('updater:status', snapshot) } catch { /* Window may be closing. */ }
  }
}

function setInstallError(error: unknown): void {
  if (installWatchdogTimer) {
    clearTimeout(installWatchdogTimer)
    installWatchdogTimer = null
  }
  installRequested = false
  currentStatus = { ...currentStatus, status: 'downloaded', error: errorMessage(error) }
  notifyStatus()
}

function setError(error: unknown, preserveAvailableUpdate = false): void {
  currentStatus = {
    status: 'error',
    currentVersion: app.getVersion(),
    ...(preserveAvailableUpdate && currentStatus.availableVersion
      ? {
          availableVersion: currentStatus.availableVersion,
          releaseNotes: currentStatus.releaseNotes,
          releaseDate: currentStatus.releaseDate,
        }
      : {}),
    lastCheck: currentStatus.lastCheck,
    error: errorMessage(error),
  }
  notifyStatus()
}

function applyUpdateInfo(info: {
  version: string
  releaseNotes?: unknown
  releaseDate?: string
}): void {
  if (!isValidVersion(info.version)) {
    throw new Error('The update feed returned malformed release version metadata.')
  }
  currentStatus = {
    status: 'update-available',
    currentVersion: app.getVersion(),
    availableVersion: info.version,
    releaseNotes: normalizeReleaseNotes(info.releaseNotes),
    releaseDate: info.releaseDate,
    lastCheck: new Date().toISOString(),
  }
  notifyStatus()
}

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindowRef = window
}

export function getUpdaterInfo(): UpdaterInfo {
  return { ...currentStatus }
}

export function checkForUpdates(): Promise<UpdaterInfo> {
  if (checkPromise) return checkPromise

  if (!app.isPackaged) {
    currentStatus = {
      status: 'unsupported',
      currentVersion: app.getVersion(),
      error: 'Updates are available only in packaged Windows NSIS builds.',
      lastCheck: new Date().toISOString(),
    }
    notifyStatus()
    return Promise.resolve({ ...currentStatus })
  }

  if (process.platform !== 'win32') {
    currentStatus = {
      status: 'unsupported',
      currentVersion: app.getVersion(),
      error: 'Automatic updates are currently supported only by the Windows NSIS package.',
      lastCheck: new Date().toISOString(),
    }
    notifyStatus()
    return Promise.resolve({ ...currentStatus })
  }

  if (!hasTrustedPublisherConfiguration()) {
    currentStatus = {
      status: 'unsupported',
      currentVersion: app.getVersion(),
      error: 'Automatic updates are disabled because this build has no trusted code-signing publisher configured.',
      lastCheck: new Date().toISOString(),
    }
    notifyStatus()
    return Promise.resolve({ ...currentStatus })
  }

  if (['downloading', 'downloaded', 'installing'].includes(currentStatus.status)) {
    return Promise.resolve({ ...currentStatus })
  }

  currentStatus = {
    status: 'checking',
    currentVersion: app.getVersion(),
    lastCheck: new Date().toISOString(),
  }
  notifyStatus()

  const operation = (async (): Promise<UpdaterInfo> => {
    try {
      const result = await autoUpdater.checkForUpdates()
      if (!result?.updateInfo) {
        throw new Error('The update provider returned no release metadata.')
      }
      if (currentStatus.status === 'checking') {
        if (result.isUpdateAvailable === false) {
          currentStatus = {
            status: 'update-not-available',
            currentVersion: app.getVersion(),
            lastCheck: new Date().toISOString(),
          }
          notifyStatus()
        } else {
          applyUpdateInfo(result.updateInfo)
        }
      }
    } catch (error) {
      // A late rejection must not overwrite a newer state produced by updater events.
      if (currentStatus.status === 'checking') setError(error)
    }
    return { ...currentStatus }
  })()

  checkPromise = operation
  void operation.finally(() => {
    if (checkPromise === operation) checkPromise = null
  })
  return operation
}

export function downloadUpdate(): Promise<UpdaterActionResult> {
  if (!hasTrustedPublisherConfiguration()) {
    return Promise.resolve({ success: false, error: 'Updates are disabled because no trusted publisher is configured.' })
  }
  if (downloadPromise) return downloadPromise
  if (!['update-available', 'error'].includes(currentStatus.status) || !currentStatus.availableVersion) {
    return Promise.resolve({ success: false, error: 'There is no available update to download.' })
  }

  const token = new CancellationToken()
  downloadToken = token
  currentStatus = {
    ...currentStatus,
    status: 'downloading',
    downloadProgress: 0,
    downloadSpeedBytesPerSecond: 0,
    downloadedBytes: 0,
    totalBytes: undefined,
    cancellationRequested: false,
    error: undefined,
  }
  notifyStatus()

  const operation = (async (): Promise<UpdaterActionResult> => {
    try {
      await autoUpdater.downloadUpdate(token)
      if (currentStatus.status === 'downloading') {
        throw new Error('The updater finished downloading without confirming the downloaded event.')
      }
      return { success: currentStatus.status === 'downloaded' || currentStatus.status === 'installing' }
    } catch (error) {
      if (token.cancelled) {
        currentStatus = {
          status: 'update-available',
          currentVersion: app.getVersion(),
          availableVersion: currentStatus.availableVersion,
          releaseNotes: currentStatus.releaseNotes,
          releaseDate: currentStatus.releaseDate,
          lastCheck: currentStatus.lastCheck,
        }
        notifyStatus()
        return { success: false, error: 'Download cancelled.' }
      }
      setError(error, true)
      return { success: false, error: errorMessage(error) }
    } finally {
      token.dispose()
      if (downloadToken === token) downloadToken = null
      downloadPromise = null
    }
  })()

  downloadPromise = operation
  return operation
}

export function cancelDownload(): UpdaterActionResult {
  if (currentStatus.status !== 'downloading' || !downloadToken) {
    return { success: false, error: 'No active download can be cancelled.' }
  }
  currentStatus = { ...currentStatus, cancellationRequested: true }
  notifyStatus()
  downloadToken.cancel()
  return { success: true }
}

export function installUpdate(): UpdaterActionResult {
  if (!hasTrustedPublisherConfiguration()) {
    return { success: false, error: 'Updates are disabled because no trusted publisher is configured.' }
  }
  if (currentStatus.status !== 'downloaded') {
    return { success: false, error: 'The update has not finished downloading.' }
  }
  if (installRequested) {
    return { success: false, error: 'Update installation is already in progress.' }
  }

  installRequested = true
  currentStatus = { ...currentStatus, status: 'installing', error: undefined }
  notifyStatus()
  installWatchdogTimer = setTimeout(() => {
    if (currentStatus.status === 'installing') {
      setInstallError(new Error('The installer did not start the application restart. You can retry installation.'))
    }
  }, INSTALL_WATCHDOG_DELAY_MS)
  try {
    autoUpdater.quitAndInstall(true, true)
    return { success: true }
  } catch (error) {
    setInstallError(error)
    return { success: false, error: errorMessage(error) }
  }
}

export function startPeriodicCheck(intervalHours = 6): void {
  if (lifecycleStarted || !app.isPackaged || process.platform !== 'win32' || !hasTrustedPublisherConfiguration()) return
  const safeIntervalHours = Number.isFinite(intervalHours) && intervalHours > 0 ? intervalHours : 6
  lifecycleStarted = true
  startupCheckTimer = setTimeout(() => {
    startupCheckTimer = null
    void checkForUpdates()
  }, STARTUP_CHECK_DELAY_MS)
  periodicCheckTimer = setInterval(() => {
    void checkForUpdates()
  }, safeIntervalHours * 60 * 60 * 1000)
}

export function stopPeriodicCheck(): void {
  if (startupCheckTimer) {
    clearTimeout(startupCheckTimer)
    startupCheckTimer = null
  }
  if (periodicCheckTimer) {
    clearInterval(periodicCheckTimer)
    periodicCheckTimer = null
  }
  if (installWatchdogTimer) {
    clearTimeout(installWatchdogTimer)
    installWatchdogTimer = null
  }
  lifecycleStarted = false
  if (downloadToken && !installRequested) downloadToken.cancel()
}

function registerUpdaterEvents(): void {
  autoUpdater.on('checking-for-update', () => {
    if (currentStatus.status === 'downloading' || currentStatus.status === 'downloaded' || currentStatus.status === 'installing') return
    currentStatus = { ...currentStatus, status: 'checking' }
    notifyStatus()
  })
  autoUpdater.on('update-available', (info) => {
    if (currentStatus.status !== 'checking') return
    try { applyUpdateInfo(info) } catch (error) { setError(error) }
  })
  autoUpdater.on('update-not-available', () => {
    if (currentStatus.status !== 'checking') return
    currentStatus = {
      status: 'update-not-available',
      currentVersion: app.getVersion(),
      lastCheck: new Date().toISOString(),
    }
    notifyStatus()
  })
  autoUpdater.on('download-progress', (progress: UpdaterDownloadProgress) => {
    if (currentStatus.status !== 'downloading') return
    const safePercent = Number.isFinite(progress.percent) ? Math.min(100, Math.max(0, progress.percent)) : 0
    currentStatus = {
      ...currentStatus,
      downloadProgress: safePercent,
      downloadSpeedBytesPerSecond: progress.bytesPerSecond,
      downloadedBytes: progress.transferred,
      totalBytes: progress.total,
    }
    for (const listener of [...downloadListeners]) {
      try { listener(progress) } catch { /* Listener errors are isolated. */ }
    }
    notifyStatus()
  })
  autoUpdater.on('update-downloaded', (info) => {
    if (currentStatus.status !== 'downloading') return
    try {
      if (!isValidVersion(info.version)) throw new Error('The downloaded update has malformed version metadata.')
      if (currentStatus.availableVersion && info.version !== currentStatus.availableVersion) {
        throw new Error('The downloaded update version does not match the available release metadata.')
      }
      currentStatus = {
        status: 'downloaded',
        currentVersion: app.getVersion(),
        availableVersion: info.version,
        releaseNotes: normalizeReleaseNotes(info.releaseNotes),
        releaseDate: info.releaseDate,
        downloadProgress: 100,
        downloadedBytes: currentStatus.totalBytes,
        totalBytes: currentStatus.totalBytes,
        lastCheck: currentStatus.lastCheck,
      }
      notifyStatus()
    } catch (error) {
      setError(error, true)
    }
  })
  autoUpdater.on('error', (error) => {
    if (currentStatus.status === 'installing') {
      setInstallError(error)
      return
    }
    if (currentStatus.status !== 'checking' && currentStatus.status !== 'downloading') return
    setError(error, currentStatus.status === 'downloading')
  })
}

export function registerUpdaterHandlers(): void {
  if (handlersRegistered) return
  registerIpcHandler('updater:getInfo', () => getUpdaterInfo())
  registerIpcHandler('updater:check', () => checkForUpdates())
  registerIpcHandler('updater:download', () => downloadUpdate())
  registerIpcHandler('updater:cancelDownload', () => cancelDownload())
  registerIpcHandler('updater:install', () => installUpdate())
  registerUpdaterEvents()
  handlersRegistered = true
}

export function onStatusChange(handler: UpdaterEventHandler): () => void {
  statusListeners.push(handler)
  return () => {
    const index = statusListeners.indexOf(handler)
    if (index >= 0) statusListeners.splice(index, 1)
  }
}

export function onDownloadProgress(handler: UpdaterDownloadHandler): () => void {
  downloadListeners.push(handler)
  return () => {
    const index = downloadListeners.indexOf(handler)
    if (index >= 0) downloadListeners.splice(index, 1)
  }
}

export function __resetUpdaterForTests(): void {
  stopPeriodicCheck()
  autoUpdater.removeAllListeners?.()
  currentStatus = { status: 'idle', currentVersion: app.getVersion() }
  checkPromise = null
  downloadPromise = null
  downloadToken = null
  handlersRegistered = false
  installRequested = false
  mainWindowRef = null
  statusListeners.length = 0
  downloadListeners.length = 0
}
