import { BrowserWindow, ipcMain, dialog, shell, clipboard } from 'electron'
import path from 'path'
import fs from 'fs/promises'
import { isPathAllowed, addAllowedBaseDir } from './security'

export let mainWindow: BrowserWindow | null = null

export function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '../preload/preload.js'),
    },
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

export function registerWindowHandlers(): void {
  ipcMain.handle('openDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory']
    })
    for (const p of result.filePaths) {
      addAllowedBaseDir(p)
    }
    return result.filePaths
  })

  ipcMain.handle('readFile', async (_, filePath: string) => {
    if (!isPathAllowed(filePath)) {
      throw new Error('Access denied: path is not in an allowed directory')
    }
    const content = await fs.readFile(filePath, 'utf-8')
    return content
  })

  ipcMain.handle('writeFile', async (_, filePath: string, content: string) => {
    if (!isPathAllowed(filePath)) {
      throw new Error('Access denied: path is not in an allowed directory')
    }
    await fs.writeFile(filePath, content, 'utf-8')
    return { success: true }
  })

  ipcMain.handle('copyToClipboard', async (_, text: string) => {
    clipboard.writeText(text)
    return { success: true }
  })

  ipcMain.handle('openExternal', async (_, url: string) => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error('Access denied: only http:// and https:// URLs are allowed')
      }
    } catch {
      throw new Error('Access denied: invalid URL')
    }
    await shell.openExternal(url)
    return { success: true }
  })
}
