import { app, BrowserWindow } from 'electron'
import { createWindow } from './window.js'
import { registerSettingsHandlers } from './settings.js'
import { registerWindowHandlers } from './window.js'
import { registerXMindHandlers } from './xmind.js'
import { registerProjectMarkdownHandlers } from './project-markdown.js'

registerSettingsHandlers()
registerWindowHandlers()
registerXMindHandlers()
registerProjectMarkdownHandlers()

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

app.whenReady().then(() => {
  try {
    createWindow()
  } catch (err) {
    logStartupError(err)
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
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// Log uncaught exceptions in the main process
process.on('uncaughtException', (err) => {
  logStartupError(err)
})

process.on('unhandledRejection', (reason) => {
  const timestamp = new Date().toISOString()
  console.error(`[${timestamp}] Electron main process unhandled rejection:`)
  console.error(`  Reason: ${String(reason)}`)
})
