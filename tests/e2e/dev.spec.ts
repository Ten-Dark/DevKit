import { _electron as electron } from 'playwright/test'
import { test, expect } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs/promises'

// Path to the Electron binary installed in node_modules
const ELECTRON_BIN = path.join(__dirname, '..', '..', 'node_modules', '.bin', 'electron')

// Isolated userData directory for this test run
let userDataDir: string

test.describe('Dev Electron E2E', () => {
  test.beforeAll(async () => {
    userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-e2e-user-data-'))
  })

  test.afterAll(async () => {
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  })

  test('should launch Electron, load renderer, and expose window.api', async () => {
    const electronApp = await electron.launch({
      executablePath: ELECTRON_BIN,
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        VITE_DEV_SERVER_URL: 'http://localhost:5173',
      },
    })

    const window = await electronApp.firstWindow()

    // Verify the window opened
    await expect(window).toHaveTitle(/Dev Toolbox/)

    // Verify window.api is exposed via Preload
    const apiAvailable = await window.evaluate(() => {
      return typeof (window as any).api === 'object' && (window as any).api !== null
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

    await electronApp.close()
  }, 30000)

  test('should expose expected IPC endpoints via window.api', async () => {
    const electronApp = await electron.launch({
      executablePath: ELECTRON_BIN,
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        VITE_DEV_SERVER_URL: 'http://localhost:5173',
      },
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Verify key API methods exist
    const apiMethods = await window.evaluate(() => {
      const api = (window as any).api
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

    await electronApp.close()
  }, 30000)

  test('should load Home page without white screen', async () => {
    const electronApp = await electron.launch({
      executablePath: ELECTRON_BIN,
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        VITE_DEV_SERVER_URL: 'http://localhost:5173',
      },
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    // Check that the page has content (not a white screen)
    const bodyText = await window.locator('body').textContent()
    expect(bodyText).toBeTruthy()
    expect(bodyText.length).toBeGreaterThan(10)

    await electronApp.close()
  }, 30000)
})
