import { _electron as electron } from 'playwright/test'
import { test, expect } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = path.resolve(__dirname, '..', '..')
const ELECTRON_BIN = path.join(
  PROJECT_ROOT,
  'node_modules',
  'electron',
  'dist',
  'electron.exe',
)

async function createUserDataDir(): Promise<string> {
  // Use the runner-owned temp directory to avoid short user-profile paths on Windows CI.
  const tempRoot = process.env.RUNNER_TEMP || os.tmpdir()
  return fs.mkdtemp(path.join(tempRoot, 'dev-e2e-user-data-'))
}

type E2EWindow = Window & {
  api?: Record<string, unknown> & {
    updater?: Record<string, unknown>
  }
}

test.describe('Dev Electron E2E', () => {
  test('should launch Electron, load renderer, and expose window.api', async () => {
    const userDataDir = await createUserDataDir()
    const electronApp = await electron.launch({
      executablePath: ELECTRON_BIN,
      cwd: PROJECT_ROOT,
      args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        VITE_DEV_SERVER_URL: 'http://localhost:5173',
        OPEN_DEVTOOLS: 'false',
      },
    })

    try {
      const window = await electronApp.firstWindow()
      const runtimeVersions = await electronApp.evaluate(() => ({
        electron: process.versions.electron,
        node: process.versions.node,
        chromium: process.versions.chrome,
      }))
      console.log('Electron runtime versions:', runtimeVersions)
      expect(runtimeVersions.electron).toBe('45.4.1')
      const webPreferences = await electronApp.evaluate(({ BrowserWindow }) => {
        const mainWindow = BrowserWindow.getAllWindows()[0]
        return mainWindow?.webContents.getLastWebPreferences()
      })
      expect(webPreferences?.contextIsolation).toBe(true)
      expect(webPreferences?.nodeIntegration).toBe(false)
      expect(webPreferences?.sandbox).toBe(true)

      // Verify the window opened
      await expect(window).toHaveTitle(/DevTools|Dev Toolbox/)

      // Verify window.api is exposed via Preload
      const apiAvailable = await window.evaluate(() => {
        const api = (window as E2EWindow).api
        return typeof api === 'object' && api !== null
      })
      expect(apiAvailable).toBe(true)

      // Verify no console errors
      const consoleErrors: string[] = []
      window.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text())
        }
      })

      // Give the app time to load and report errors
      await window.waitForLoadState('domcontentloaded')
      await new Promise((resolve) => setTimeout(resolve, 2000))

      // Filter out expected Electron/Chrome extension errors
      const criticalErrors = consoleErrors.filter(
        (e) =>
          !e.includes('favicon') &&
          !e.includes('extension') &&
          !e.includes('webstore') &&
          !e.includes('DevTools')
      )
      expect(criticalErrors).toHaveLength(0)
    } finally {
      await electronApp.close().catch(() => {})
      await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
    }
  }, 30000)

  test('should expose expected IPC endpoints via window.api', async () => {
    const userDataDir = await createUserDataDir()
    const electronApp = await electron.launch({
      executablePath: ELECTRON_BIN,
      cwd: PROJECT_ROOT,
      args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        VITE_DEV_SERVER_URL: 'http://localhost:5173',
        OPEN_DEVTOOLS: 'false',
      },
    })

    try {
      const window = await electronApp.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      // Verify key API methods exist
      const apiMethods = await window.evaluate(() => {
        const api = (window as E2EWindow).api
        return {
          openDirectory: typeof api?.openDirectory === 'function',
          readFile: typeof api?.readFile === 'function',
          writeFile: typeof api?.writeFile === 'function',
          copyToClipboard: typeof api?.copyToClipboard === 'function',
          getSettings: typeof api?.getSettings === 'function',
          saveSettings: typeof api?.saveSettings === 'function',
          getAppVersion: typeof api?.getAppVersion === 'function',
          updater: typeof api?.updater === 'object',
        }
      })

      expect(apiMethods.openDirectory).toBe(true)
      expect(apiMethods.readFile).toBe(true)
      expect(apiMethods.writeFile).toBe(true)
      expect(apiMethods.copyToClipboard).toBe(true)
      expect(apiMethods.getSettings).toBe(true)
      expect(apiMethods.saveSettings).toBe(true)
      expect(apiMethods.getAppVersion).toBe(true)
      expect(apiMethods.updater).toBe(true)
    } finally {
      await electronApp.close().catch(() => {})
      await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
    }
  }, 30000)

  test('should load Home page without white screen', async () => {
    const userDataDir = await createUserDataDir()
    const electronApp = await electron.launch({
      executablePath: ELECTRON_BIN,
      cwd: PROJECT_ROOT,
      args: [PROJECT_ROOT, `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        VITE_DEV_SERVER_URL: 'http://localhost:5173',
        OPEN_DEVTOOLS: 'false',
      },
    })

    try {
      const window = await electronApp.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      // Check that the page has content (not a white screen)
      const bodyText = await window.locator('body').textContent()
      expect(bodyText).toBeTruthy()
      expect(bodyText.length).toBeGreaterThan(10)
    } finally {
      await electronApp.close().catch(() => {})
      await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
    }
  }, 30000)
})
