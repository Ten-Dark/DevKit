import { app, BrowserWindow } from 'electron'
import { createWindow } from './window'
import { registerSettingsHandlers } from './settings'
import { registerWindowHandlers } from './window'
import { registerXMindHandlers } from './xmind'
import { registerProjectMarkdownHandlers } from './project-markdown'

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
