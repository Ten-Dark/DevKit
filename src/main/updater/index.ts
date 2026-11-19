export {
  getUpdaterInfo,
  setMainWindow,
  checkForUpdates,
  downloadUpdate,
  cancelDownload,
  installUpdate,
  startPeriodicCheck,
  stopPeriodicCheck,
  registerUpdaterHandlers,
  onStatusChange,
  onDownloadProgress,
} from './updater.js'

export type { UpdaterInfo, UpdaterStatus, UpdaterDownloadProgress } from './updater.types.js'
