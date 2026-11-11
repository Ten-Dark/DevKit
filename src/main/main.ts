import { app, BrowserWindow, ipcMain, dialog, shell, clipboard } from 'electron'
import path from 'path'
import fs from 'fs/promises'

let mainWindow: BrowserWindow | null = null

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools()
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

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

ipcMain.handle('openDirectory', async () => {
  const result = await dialog.showOpenDialog(mainWindow!, {
    properties: ['openDirectory']
  })
  return result.filePaths
})

ipcMain.handle('readFile', async (_, filePath: string) => {
  const content = await fs.readFile(filePath, 'utf-8')
  return content
})

ipcMain.handle('writeFile', async (_, filePath: string, content: string) => {
  await fs.writeFile(filePath, content, 'utf-8')
  return { success: true }
})

ipcMain.handle('copyToClipboard', async (_, text: string) => {
  clipboard.writeText(text)
  return { success: true }
})

ipcMain.handle('getSettings', async () => {
  return {}
})

ipcMain.handle('saveSettings', async (_, settings: Record<string, unknown>) => {
  return { success: true }
})

ipcMain.handle('openExternal', async (_, url: string) => {
  await shell.openExternal(url)
  return { success: true }
})
