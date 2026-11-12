// Updater types shared between main process and preload/renderer.
export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'update-available'
  | 'update-not-available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'

export interface UpdaterInfo {
  status: UpdaterStatus
  currentVersion: string
  availableVersion?: string
  releaseNotes?: string
  releaseDate?: string
  downloadProgress?: number
  error?: string
  lastCheck?: string
}

export interface UpdaterDownloadProgress {
  bytesPerSecond: number
  percent: number
  total: number
  transferred: number
}

export type UpdaterEventHandler = (payload: UpdaterInfo) => void
export type UpdaterDownloadHandler = (payload: UpdaterDownloadProgress) => void
