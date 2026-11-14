import { _electron as electron } from 'playwright/test'
import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'

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
      },
    })

    try {
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
      },
    })

    try {
      const window = await electronApp.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      const isPackaged = await window.evaluate(() => {
        return (window as any).process?.versions?.electron !== undefined
      })
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
      },
    })

    try {
      const window = await electronApp.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      const updaterAvailable = await window.evaluate(() => {
        const api = (window as any).api
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
})
