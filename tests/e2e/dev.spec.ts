import { _electron as electron } from 'playwright/test'
import { test, expect } from '@playwright/test'
import path from 'path'
import os from 'os'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const ELECTRON_BIN = path.join(__dirname, '..', '..', 'node_modules', '.bin', 'electron')

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && ['ESRCH', 'EINVAL'].includes(String(error.code))) return
      throw error
    }
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error('Managed MCP process ' + pid + ' remained alive after disconnect.')
}

test.describe('Dev Electron E2E', () => {
  test('should launch Electron, load renderer, and expose window.api', async () => {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-e2e-user-data-'))
    const electronApp = await electron.launch({
      executablePath: ELECTRON_BIN,
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
      await expect(window).toHaveTitle(/Dev Toolbox/)
      const apiAvailable = await window.evaluate(() => typeof window.api === 'object' && window.api !== null)
      expect(apiAvailable).toBe(true)

      const apiMethods = await window.evaluate(() => ({
        openDirectory: typeof window.api.openDirectory === 'function',
        readFile: typeof window.api.readFile === 'function',
        writeFile: typeof window.api.writeFile === 'function',
        copyToClipboard: typeof window.api.copyToClipboard === 'function',
        getSettings: typeof window.api.getSettings === 'function',
        saveSettings: typeof window.api.saveSettings === 'function',
        getAppVersion: typeof window.api.getAppVersion === 'function',
        updater: typeof window.api.updater === 'object',
        storage: typeof window.api.storage === 'object' && typeof window.api.storage.getStatus === 'function',
        karakeep: typeof window.api.storage.karakeep === 'object'
          && typeof window.api.storage.karakeep.getStatus === 'function'
          && typeof window.api.storage.karakeep.connectWithSecretReference === 'function'
          && typeof window.api.storage.karakeep.disconnect === 'function'
          && !('connect' in window.api.storage.karakeep)
          && !('list' in window.api.storage.karakeep)
          && !('search' in window.api.storage.karakeep)
          && !('readBookmark' in window.api.storage.karakeep),
        multiAggregatorPicker: typeof window.api.integrations.selectMultiAggregatorExecutable === 'function',
      }))
      expect(apiMethods).toEqual({
        openDirectory: true,
        readFile: true,
        writeFile: true,
        copyToClipboard: true,
        getSettings: true,
        saveSettings: true,
        getAppVersion: true,
        updater: true,
        storage: true,
        karakeep: true,
        multiAggregatorPicker: true,
      })
    } finally {
      await electronApp.close().catch(() => {})
      await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
    }
  }, 30000)

  test('should load Home and navigate to Storage without a white screen', async () => {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-e2e-user-data-'))
    const electronApp = await electron.launch({
      executablePath: ELECTRON_BIN,
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
      await expect(window.getByRole('region', { name: 'Workspace status' })).toBeVisible()
      await expect(window.getByRole('button', { name: 'Open Services' })).toBeVisible()
      await expect(window.getByRole('button', { name: 'Open MCPWorkers Manager' })).toBeVisible()
      await expect(window.getByRole('button', { name: 'Open Storage' })).toBeVisible()
      await window.getByRole('button', { name: 'Open Storage' }).click()
      await expect(window.getByRole('heading', { name: 'Storage', exact: true })).toBeVisible()
      await expect(window.getByText('No local folder connected')).toBeVisible()
      await expect(window.getByText('Karakeep', { exact: true })).toBeVisible()
      const bodyText = await window.locator('body').textContent()
      expect(bodyText).toBeTruthy()
      expect(bodyText.length).toBeGreaterThan(10)
    } finally {
      await electronApp.close().catch(() => {})
      await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
    }
  }, 30000)

  test('completes the MCP stdio lifecycle through IPC and the main-process trust gate', async () => {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dev-mcp-e2e-user-data-'))
    const electronApp = await electron.launch({
      executablePath: ELECTRON_BIN,
      args: ['.', `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        VITE_DEV_SERVER_URL: 'http://localhost:5173',
        OPEN_DEVTOOLS: 'false',
      },
    })

    try {
      await electronApp.evaluate(({ dialog }) => {
        Object.defineProperty(dialog, 'showMessageBox', {
          configurable: true,
          value: async () => {
            const state = globalThis as typeof globalThis & { __devkitMcpConfirmCount?: number }
            state.__devkitMcpConfirmCount = (state.__devkitMcpConfirmCount ?? 0) + 1
            return { response: 1, checkboxChecked: false }
          },
        })
      })

      const window = await electronApp.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      const childPidFile = path.join(userDataDir, 'mcp-descendant.pid')
      const result = await window.evaluate(async ({ nodeExecutable, fixturePath, childPidFile }) => {
        const created = await window.api.mcp.addConnection({
          id: 'e2e-mcp-fixture',
          name: 'DevKit E2E MCP fixture',
          transport: {
            type: 'stdio',
            command: nodeExecutable,
            args: [fixturePath],
            cwd: fixturePath.slice(0, fixturePath.lastIndexOf('\\')),
            env: { DEVKIT_E2E_CHILD_PID_FILE: childPidFile },
          },
        })
        const connected = await window.api.mcp.connect(created.id)
        if (!connected || connected.state !== 'connected') {
          throw new Error('MCP fixture did not connect: ' + (connected?.error ?? 'connection was cancelled'))
        }
        if (!connected.tools.some((tool) => tool.name === 'fixture_ping')) {
          throw new Error('MCP fixture did not expose its expected tool.')
        }
        const disconnected = await window.api.mcp.disconnect(created.id)
        if (disconnected.state !== 'disconnected') throw new Error('MCP fixture did not disconnect.')
        const removed = await window.api.mcp.removeConnection(created.id)
        const remaining = await window.api.mcp.listConnections()
        return {
          connectedState: connected.state,
          serverPid: connected.pid,
          toolNames: connected.tools.map((tool) => tool.name),
          disconnectedState: disconnected.state,
          removed,
          remaining: remaining.some((item) => item.id === created.id),
        }
      }, {
        nodeExecutable: process.execPath,
        fixturePath: path.join(__dirname, 'fixtures', 'mcp-stdio-server.cjs'),
        childPidFile,
      })

      const descendantPid = Number(await fs.readFile(childPidFile, 'utf8'))
      expect(Number.isInteger(descendantPid)).toBe(true)
      await waitForProcessExit(descendantPid, 5_000)
      if (result.serverPid) await waitForProcessExit(result.serverPid, 5_000)

      const confirmationCount = await electronApp.evaluate(() => {
        const state = globalThis as typeof globalThis & { __devkitMcpConfirmCount?: number }
        return state.__devkitMcpConfirmCount ?? 0
      })
      expect(confirmationCount).toBe(1)
      expect(result).toEqual({
        connectedState: 'connected',
        serverPid: expect.any(Number),
        toolNames: ['fixture_ping'],
        disconnectedState: 'disconnected',
        removed: true,
        remaining: false,
      })
    } finally {
      await electronApp.close().catch(() => {})
      await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
    }
  }, 45000)
})
