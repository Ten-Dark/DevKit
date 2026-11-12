import { app, BrowserWindow, ipcMain } from 'electron'
import path from 'path'
import { fileURLToPath } from 'url'

import electronUpdater from 'electron-updater'
import type { AppUpdater } from 'electron-updater'

const { autoUpdater } = electronUpdater as { autoUpdater: AppUpdater }

import type {
  UpdaterInfo,
  UpdaterDownloadProgress,
  UpdaterEventHandler,
  UpdaterDownloadHandler,
} from './updater.types'
import { registerIpcHandler } from '../ipc-registry.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Configure electron-updater to use GitHub Releases
autoUpdater.autoDownload = false // Don't auto-download, let user choose
autoUpdater.autoInstallOnAppQuit = false // Don't auto-install
autoUpdater.updateConfigPath = path.join(__dirname, 'app-update.yml')

// State
let currentStatus: UpdaterInfo = {
  status: 'idle',
  currentVersion: app.getVersion(),
  lastCheck: undefined,
}

let mainWindowRef: BrowserWindow | null = null
let checkInterval: NodeJS.Timeout | null = null
let isChecking = false

// Set the main window reference (called from window.ts after creation)
export function setMainWindow(window: BrowserWindow | null): void {
  mainWindowRef = window
}

// Get current updater status
export function getUpdaterInfo(): UpdaterInfo {
  return { ...currentStatus }
}

// Check for updates
export async function checkForUpdates(): Promise<UpdaterInfo> {
  if (isChecking) {
    return currentStatus
  }

  if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    currentStatus = {
      status: 'update-not-available',
      currentVersion: app.getVersion(),
      lastCheck: new Date().toISOString(),
    }
    return currentStatus
  }

  isChecking = true
  currentStatus = {
    ...currentStatus,
    status: 'checking',
    currentVersion: app.getVersion(),
    lastCheck: new Date().toISOString(),
  }
  notifyStatus()

  try {
    const updateInfo = await autoUpdater.checkForUpdates()

    if (updateInfo?.updateInfo) {
      currentStatus = {
        status: 'update-available',
        currentVersion: app.getVersion(),
        availableVersion: updateInfo.updateInfo.version,
        releaseNotes: (updateInfo.updateInfo.releaseNotes as string | undefined) ?? undefined,
        releaseDate: updateInfo.updateInfo.releaseDate,
        lastCheck: new Date().toISOString(),
      }
    } else {
      currentStatus = {
        status: 'update-not-available',
        currentVersion: app.getVersion(),
        lastCheck: new Date().toISOString(),
      }
    }
  } catch (err) {
    currentStatus = {
      status: 'error',
      currentVersion: app.getVersion(),
      lastCheck: new Date().toISOString(),
      error: err instanceof Error ? err.message : String(err),
    }
  } finally {
    isChecking = false
    notifyStatus()
  }

  return currentStatus
}

// Download update
export async function downloadUpdate(): Promise<void> {
  if (currentStatus.status !== 'update-available') {
    return
  }

  currentStatus = {
    ...currentStatus,
    status: 'downloading',
    downloadProgress: 0,
  }
  notifyStatus()

  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    currentStatus = {
      ...currentStatus,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    }
    notifyStatus()
  }
}

// Install update (quits and installs)
export function installUpdate(): void {
  if (currentStatus.status !== 'downloaded') {
    return
  }

  currentStatus = {
    ...currentStatus,
    status: 'installing',
  }
  notifyStatus()

  autoUpdater.quitAndInstall()
}

// Start periodic update checks (every 6 hours)
export function startPeriodicCheck(intervalHours: number = 6): void {
  if (checkInterval) {
    clearInterval(checkInterval)
  }

  // Initial check after 30 seconds
  setTimeout(() => {
    checkForUpdates()
  }, 30000)

  checkInterval = setInterval(() => {
    checkForUpdates()
  }, intervalHours * 60 * 60 * 1000)
}

// Stop periodic checks
export function stopPeriodicCheck(): void {
  if (checkInterval) {
    clearInterval(checkInterval)
    checkInterval = null
  }
}

// Notify all listeners about status change
function notifyStatus(): void {
  const statusCopy = { ...currentStatus }
  statusListeners.forEach((cb) => {
    try {
      cb(statusCopy)
    } catch {
      // Listener errors should not break the updater
    }
  })
  // Forward to renderer via IPC
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    try {
      mainWindowRef.webContents.send('updater:status', statusCopy)
    } catch {
      // Renderer may not be ready yet
    }
  }
}

const statusListeners: UpdaterEventHandler[] = []
const downloadListeners: UpdaterDownloadHandler[] = []

// Register IPC handlers
export function registerUpdaterHandlers(): void {
  registerIpcHandler('updater:getInfo', () => {
    return getUpdaterInfo()
  })

  registerIpcHandler('updater:check', async () => {
    return checkForUpdates()
  })

  registerIpcHandler('updater:download', async () => {
    await downloadUpdate()
    return { success: true }
  })

  registerIpcHandler('updater:install', () => {
    installUpdate()
    return { success: true }
  })

  // electron-updater event listeners
  autoUpdater.on('checking-for-update', () => {
    currentStatus = { ...currentStatus, status: 'checking' }
    notifyStatus()
  })

  autoUpdater.on('update-available', (info) => {
    currentStatus = {
      status: 'update-available',
      currentVersion: app.getVersion(),
      availableVersion: info.version,
      releaseNotes: (info.releaseNotes as string | undefined) ?? undefined,
      releaseDate: info.releaseDate,
      lastCheck: new Date().toISOString(),
    }
    notifyStatus()
  })

  autoUpdater.on('update-not-available', () => {
    currentStatus = {
      status: 'update-not-available',
      currentVersion: app.getVersion(),
      lastCheck: new Date().toISOString(),
    }
    notifyStatus()
  })

  autoUpdater.on('download-progress', (progress: UpdaterDownloadProgress) => {
    currentStatus = {
      ...currentStatus,
      status: 'downloading',
      downloadProgress: progress.percent,
    }
    downloadListeners.forEach((cb) => {
      try {
        cb(progress)
      } catch {
        // Listener errors should not break the updater
      }
    })
    notifyStatus()
  })

  autoUpdater.on('update-downloaded', (info) => {
    currentStatus = {
      status: 'downloaded',
      currentVersion: app.getVersion(),
      availableVersion: info.version,
      releaseNotes: (info.releaseNotes as string | undefined) ?? undefined,
      releaseDate: info.releaseDate,
      downloadProgress: 100,
      lastCheck: new Date().toISOString(),
    }
    notifyStatus()
  })

  autoUpdater.on('error', (err) => {
    currentStatus = {
      ...currentStatus,
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    }
    notifyStatus()
  })
}

// Expose listener management for preload
export function onStatusChange(handler: UpdaterEventHandler): () => void {
  statusListeners.push(handler)
  return () => {
    const idx = statusListeners.indexOf(handler)
    if (idx >= 0) {
      statusListeners.splice(idx, 1)
    }
  }
}

export function onDownloadProgress(handler: UpdaterDownloadHandler): () => void {
  downloadListeners.push(handler)
  return () => {
    const idx = downloadListeners.indexOf(handler)
    if (idx >= 0) {
      downloadListeners.splice(idx, 1)
    }
  }
}
