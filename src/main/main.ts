import { app, BrowserWindow } from 'electron'
import { createWindow } from './window.js'
import { migrateLegacySettings, registerSettingsHandlers } from './settings.js'
import { registerWindowHandlers } from './window.js'
import { registerXMindHandlers } from './xmind.js'
import { registerProjectMarkdownHandlers } from './project-markdown.js'
import { registerUpdaterHandlers, startPeriodicCheck, stopPeriodicCheck } from './updater/index.js'
import { bootstrapWorkspace } from './workspace.js'
import { RuntimeCore } from './core/runtime-core.js'
import { registerRuntimeHandlers } from './core/runtime-ipc.js'

// Acquire the process lock before registering IPC handlers or initializing
// persistent state. A second launch must not race workspace/config mutations.
const hasSingleInstanceLock = app.requestSingleInstanceLock()

if (!hasSingleInstanceLock) {
  app.quit()
} else {
  let runtimeInitialized = false

  app.on('second-instance', () => {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    if (!mainWindow) {
      if (runtimeInitialized) createWindow()
      return
    }
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  registerSettingsHandlers()
  registerWindowHandlers()
  registerXMindHandlers()
  registerProjectMarkdownHandlers()
  registerUpdaterHandlers()

  // ------------------------------------------------------------------- diagnostics -----

  function logStartupError(err: unknown): void {
    const timestamp = new Date().toISOString()
    console.error(`[${timestamp}] Electron main process startup error:`)
    if (err instanceof Error) {
      console.error(`  Message: ${err.message}`)
      console.error(`  Stack: ${err.stack}`)
    } else {
      console.error(`  Error: ${String(err)}`)
    }
  }

  app.whenReady().then(async () => {
    try {
      await bootstrapWorkspace()
      await migrateLegacySettings()
      const runtime = new RuntimeCore()
      await runtime.initialize()
      registerRuntimeHandlers(runtime)
      runtimeInitialized = true
      createWindow()
      startPeriodicCheck(6)
    } catch (err) {
      logStartupError(err)
      // Do not expose a partially initialized workspace to the renderer.
      app.quit()
      return
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        try {
          createWindow()
        } catch (err) {
          logStartupError(err)
        }
      }
    })
  }).catch((err: unknown) => {
    logStartupError(err)
    app.quit()
  })

  app.on('before-quit', () => {
    stopPeriodicCheck()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit()
    }
  })
}

// Log uncaught exceptions in the main process
process.on('uncaughtException', (err) => {
  const timestamp = new Date().toISOString()
  console.error(`[${timestamp}] Electron main process uncaught exception:`)
  console.error(err)
})

process.on('unhandledRejection', (reason) => {
  const timestamp = new Date().toISOString()
  console.error(`[${timestamp}] Electron main process unhandled rejection:`)
  console.error(`  Reason: ${String(reason)}`)
})
