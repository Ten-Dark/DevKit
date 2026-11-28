import { _electron as electron } from 'playwright/test'
import { test, expect } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const electronBin = path.join(root, 'node_modules', '.bin', 'electron')

test('Storage status IPC settles the KeePassXC and Karakeep indicators', async () => {
  const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-storage-status-e2e-'))
  const electronApp = await electron.launch({
    executablePath: electronBin,
    args: ['.', `--user-data-dir=${userDataDir}`],
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

    const status = await window.evaluate(() => window.api.storage.karakeep.getStatus())
    expect(status).toBeNull()

    await window.getByRole('button', { name: 'Open Storage' }).click()
    await expect(window.getByRole('heading', { name: 'Storage', exact: true })).toBeVisible()
    await expect(window.getByText('Not connected', { exact: true })).toHaveCount(2, { timeout: 10_000 })
    const connectButton = window.getByRole('button', { name: 'Connect with KeePassXC' })
    await expect(connectButton).toBeEnabled()
    await expect(window.getByLabel('KeePassXC master password')).toHaveCount(0)
    await expect(window.getByText(/separate secure PowerShell prompt/)).toBeVisible()
  } finally {
    await electronApp.close().catch(() => {})
    await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
  }
}, 30_000)
