import { BrowserWindow, dialog, shell, clipboard } from 'electron'
import path from 'path'

import { fileURLToPath } from 'url'
import { addAllowedBaseDir, readAuthorizedFile, writeAuthorizedFile } from './security.js'
import { registerIpcHandler } from './ipc-registry.js'
import { isTrustedRendererUrl } from './ipc-security.js'
import { setMainWindow as setUpdaterMainWindow } from './updater/index.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export let mainWindow: BrowserWindow | null = null

export function setMainWindow(window: BrowserWindow | null): void {
  mainWindow = window
}

export function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, '../preload/preload.cjs'),
    },
  })

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  if (process.env.NODE_ENV === 'development' && process.env.OPEN_DEVTOOLS !== 'false') {
    mainWindow.webContents.openDevTools()
  }

  // Never let an untrusted document inherit the privileged preload bridge.
  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    if (!isTrustedRendererUrl(navigationUrl)) event.preventDefault()
  })
  mainWindow.webContents.on('will-redirect', (event, navigationUrl) => {
    if (!isTrustedRendererUrl(navigationUrl)) event.preventDefault()
  })
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  mainWindow.on('closed', () => {
    mainWindow = null
    setUpdaterMainWindow(null)
  })

  setMainWindow(mainWindow)
  setUpdaterMainWindow(mainWindow)

  // Error diagnostics for production
  const timestamp = () => new Date().toISOString()

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(
      `[${timestamp()}] Renderer failed to load: ${errorDescription} (code ${errorCode}) URL: ${validatedURL}`,
    )
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(
      `[${timestamp()}] Render process gone: ${details.reason ?? 'unknown'} (exit code: ${details.exitCode ?? 'unknown'})`,
    )
  })

  ;(mainWindow.webContents as { on: (event: string, listener: (...args: unknown[]) => void) => void }).on(
    'crashed',
    (_event: unknown, killed: unknown) => {
      console.error(`[${timestamp()}] Renderer crashed: killed=${killed}`)
    },
  )
}

export function registerWindowHandlers(): void {
  registerIpcHandler('openDirectory', async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory']
    })
    for (const p of result.filePaths) {
      addAllowedBaseDir(p)
    }
    return result.filePaths
  })

  registerIpcHandler('readFile', async (_, filePath: string) => {
    const content = await readAuthorizedFile(filePath)
    return content.toString('utf-8')
  })

  registerIpcHandler('writeFile', async (_, filePath: string, content: string) => {
    await writeAuthorizedFile(filePath, content)
    return { success: true }
  })

  registerIpcHandler('copyToClipboard', async (_, text: string) => {
    clipboard.writeText(text)
    return { success: true }
  })

  registerIpcHandler('openExternal', async (_, url: string) => {
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
