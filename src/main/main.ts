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

app.whenReady().then(() => {
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
