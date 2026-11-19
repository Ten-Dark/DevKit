import { _electron as electron } from 'playwright/test'
import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

type E2EWindow = Window & {
  api?: Record<string, unknown> & {
    updater?: Record<string, unknown>
  }
  process?: {
    versions?: {
      electron?: string
    }
  }
}

// Path to the packaged Electron executable
const PACKAGED_EXE_PATH = process.env.PACKAGED_EXE ?? path.join(
  __dirname,
  '..',
  '..',
  'dist-electron',
  'win-unpacked',
  'Dev Toolbox.exe'
)

const PACKAGED_EXE = path.resolve(PACKAGED_EXE_PATH)

test.describe('Packaged Electron E2E', () => {
  test('should launch packaged app, load renderer, and expose window.api', async () => {
    // Fail fast if packaged executable does not exist
    if (!(await fs.stat(PACKAGED_EXE).catch(() => false))) {
      throw new Error(
        `Packaged executable not found at ${PACKAGED_EXE}. Run 'npm run dist' first.`
      )
    }

    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'packaged-e2e-user-data-'))
    const electronApp = await electron.launch({
      executablePath: PACKAGED_EXE,
      args: [`--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'production',
        APPDATA: userDataDir,
        LOCALAPPDATA: userDataDir,
      },
    })

    try {
      const window = await electronApp.firstWindow()
      const runtimeVersions = await electronApp.evaluate(() => ({
        electron: process.versions.electron,
        node: process.versions.node,
        chromium: process.versions.chrome,
      }))
      console.log('Packaged Electron runtime versions:', runtimeVersions)
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

      const xmindApiAvailable = await window.evaluate(() => {
        const api = (window as E2EWindow).api
        return (
          typeof api?.convertXMindToMarkdown === 'function' &&
          typeof api?.cancelXMindConversion === 'function' &&
          typeof api?.onXMindConversionProgress === 'function'
        )
      })
      expect(xmindApiAvailable).toBe(true)

      // Verify no console errors
      const consoleErrors: string[] = []
      window.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text())
        }
      })

      await window.waitForLoadState('domcontentloaded')
      await new Promise((resolve) => setTimeout(resolve, 2000))

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

  test('should verify app.isPackaged is true in production', async () => {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'packaged-e2e-user-data-'))
    const electronApp = await electron.launch({
      executablePath: PACKAGED_EXE,
      args: [`--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'production',
        APPDATA: userDataDir,
        LOCALAPPDATA: userDataDir,
      },
    })

    try {
      const window = await electronApp.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      const isPackaged = await electronApp.evaluate(({ app }) => app.isPackaged)
      expect(isPackaged).toBe(true)
    } finally {
      await electronApp.close().catch(() => {})
      await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
    }
  }, 30000)

  test('should expose updater API in packaged app', async () => {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'packaged-e2e-user-data-'))
    const electronApp = await electron.launch({
      executablePath: PACKAGED_EXE,
      args: [`--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'production',
        APPDATA: userDataDir,
        LOCALAPPDATA: userDataDir,
      },
    })

    try {
      const window = await electronApp.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      const updaterAvailable = await window.evaluate(() => {
        const api = (window as E2EWindow).api
        return (
          typeof api?.updater === 'object' &&
          typeof api?.updater?.getInfo === 'function' &&
          typeof api?.updater?.check === 'function'
        )
      })
      expect(updaterAvailable).toBe(true)
    } finally {
      await electronApp.close().catch(() => {})
      await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
    }
  }, 30000)

  test('should read settings and execute packaged IPC calls', async () => {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'packaged-e2e-user-data-'))
    const electronApp = await electron.launch({
      executablePath: PACKAGED_EXE,
      args: [`--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'production',
        APPDATA: userDataDir,
        LOCALAPPDATA: userDataDir,
      },
    })

    try {
      const window = await electronApp.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      const result = await window.evaluate(async () => {
        const api = (window as E2EWindow).api as unknown as {
          getSettings: () => Promise<Record<string, unknown>>
          saveSettings: (settings: Record<string, unknown>) => Promise<{ success: boolean }>
          getAppVersion: () => Promise<string>
          updater: { getInfo: () => Promise<{ status: string }> }
        }
        const [settings, version, updaterInfo] = await Promise.all([
          api.getSettings(),
          api.getAppVersion(),
          api.updater.getInfo(),
        ])
        const saveResult = await api.saveSettings({ maxFileSizeKB: 2048, includeTree: false })
        const updatedSettings = await api.getSettings()
        return {
          settings,
          updatedSettings,
          saveSuccess: saveResult.success,
          version,
          updaterStatus: updaterInfo.status,
        }
      })

      expect(result.settings.theme).toBe('dark')
      expect(result.settings.maxFileSizeKB).toBe(1024)
      expect(result.saveSuccess).toBe(true)
      expect(result.updatedSettings.maxFileSizeKB).toBe(2048)
      expect(result.updatedSettings.includeTree).toBe(false)
      expect(result.version).toBe('1.0.1')
      expect(result.updaterStatus).toBe('idle')
    } finally {
      await electronApp.close().catch(() => {})
      await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
    }
  }, 30000)
})
