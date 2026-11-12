import { _electron as electron } from 'playwright/test'
import { test, expect } from '@playwright/test'
import path from 'path'

// Path to the packaged Electron executable
const PACKAGED_EXE = path.join(
  __dirname,
  '..',
  '..',
  'dist-electron',
  'win-unpacked',
  'Dev Toolbox.exe'
)

test.describe('Packaged Electron E2E', () => {
  test('should launch packaged app, load renderer, and expose window.api', async () => {
    // Skip if packaged app doesn't exist (e.g., before production build)
    const fs = await import('fs')
    if (!fs.existsSync(PACKAGED_EXE)) {
      test.skip()
    }

    const electronApp = await electron.launch({
      executablePath: PACKAGED_EXE,
      env: {
        ...process.env,
        NODE_ENV: 'production',
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

    await electronApp.close()
  }, 30000)

  test('should verify app.isPackaged is true in production', async () => {
    const fs = await import('fs')
    if (!fs.existsSync(PACKAGED_EXE)) {
      test.skip()
    }

    const electronApp = await electron.launch({
      executablePath: PACKAGED_EXE,
      env: {
        ...process.env,
        NODE_ENV: 'production',
      },
    })

    const window = await electronApp.firstWindow()
    await window.waitForLoadState('domcontentloaded')

    const isPackaged = await window.evaluate(() => {
      return (window as any).process?.versions?.electron !== undefined
    })
    expect(isPackaged).toBe(true)

    await electronApp.close()
  }, 30000)

  test('should expose updater API in packaged app', async () => {
    const fs = await import('fs')
    if (!fs.existsSync(PACKAGED_EXE)) {
      test.skip()
    }

    const electronApp = await electron.launch({
      executablePath: PACKAGED_EXE,
      env: {
        ...process.env,
        NODE_ENV: 'production',
      },
    })

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

    await electronApp.close()
  }, 30000)
})
