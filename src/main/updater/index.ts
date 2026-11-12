export {
  getUpdaterInfo,
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  startPeriodicCheck,
  stopPeriodicCheck,
  registerUpdaterHandlers,
  onStatusChange,
  onDownloadProgress,
} from './updater.js'

export type { UpdaterInfo, UpdaterStatus, UpdaterDownloadProgress } from './updater.types.js'
