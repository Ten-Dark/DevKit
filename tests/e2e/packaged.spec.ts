import { _electron as electron } from 'playwright/test'
import { test, expect } from '@playwright/test'
import path from 'path'
import fs from 'fs/promises'
import os from 'os'
import { fileURLToPath } from 'url'
import { once } from 'node:events'
import type { ChildProcess } from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Path to the packaged Electron executable
const PACKAGED_EXE_PATH = process.env.PACKAGED_EXE ?? path.join(
  __dirname,
  '..',
  '..',
  'dist',
  'win-unpacked',
  'Dev Toolbox.exe'
)

const PACKAGED_EXE = path.resolve(PACKAGED_EXE_PATH)

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

async function waitForFileSize(filePath: string, minimumSize: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const size = await fs.stat(filePath).then((stat) => stat.size).catch(() => 0)
    if (size >= minimumSize) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Managed process did not write its heartbeat within ${timeoutMs} ms.`)
}

async function waitForFileStable(filePath: string, quietMs: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let previousSize = await fs.stat(filePath).then((stat) => stat.size)
  let lastChangeAt = Date.now()
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100))
    const size = await fs.stat(filePath).then((stat) => stat.size)
    if (size !== previousSize) {
      previousSize = size
      lastChangeAt = Date.now()
    }
    if (Date.now() - lastChangeAt >= quietMs) return
  }
  throw new Error(`Managed process heartbeat continued changing for ${timeoutMs} ms.`)
}


// Log the resolved executable path for diagnostics
console.log(`Packaged EXE resolved to: ${PACKAGED_EXE}`)

test.describe('Packaged Electron E2E', () => {
  test('starts the packaged MCPWorkers sidecar and reports ownership in Services UI', async () => {
    const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'packaged-mcpworkers-data-'))
    const registryDirectory = path.join(dataRoot, 'registry')
    await fs.mkdir(registryDirectory, { recursive: true })
    await fs.writeFile(
      path.join(registryDirectory, 'registry.json'),
      JSON.stringify({ schemaVersion: 1, definitions: [], instances: [] }),
      'utf8',
    )
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'packaged-mcpworkers-ui-'))
    const electronApp = await electron.launch({
      executablePath: PACKAGED_EXE,
      args: [`--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        DEVKIT_USER_DATA_DIR: userDataDir,
        NODE_ENV: 'production',
        DEVKIT_MCPWORKERS_DATA_ROOT: dataRoot,
      },
    })
    let managerPid: number | undefined

    try {
      const window = await electronApp.firstWindow()
      await expect(window).toHaveTitle(/Dev Toolbox/)
      await expect.poll(async () => window.evaluate(async () => {
        const status = await window.api.mcpWorkers.getManagerRuntimeStatus()
        return status.runtime.state
      }), { timeout: 20_000 }).toBe('managed')

      const runtimeStatus = await window.evaluate(() => window.api.mcpWorkers.getManagerRuntimeStatus())
      expect(runtimeStatus.runtime).toMatchObject({ state: 'managed', ownership: 'devkit' })
      managerPid = runtimeStatus.runtime.pid
      expect(managerPid).toEqual(expect.any(Number))
      expect(runtimeStatus.dataRoot).toBe(dataRoot)

      await window.getByRole('button', { name: 'Services', exact: true }).click()
      await expect(window.getByRole('heading', { name: 'Services', exact: true })).toBeVisible()
      await expect.poll(async () => window.evaluate(async () => (
        await window.api.mcpWorkers.getHealth()
      )).then((health) => health.state), { timeout: 15_000 }).toBe('reachable')


      await expect(window.getByText('Runtime ownership: Managed by DevKit')).toBeVisible()
      await expect(window.getByRole('button', { name: 'Shutdown DevKit-owned' })).toBeEnabled()

      const services = await window.evaluate(() => window.api.runtime.listServices())
      const managerService = services.find((item) => item.service.id === 'mcpworkers-manager')
      expect(managerService?.snapshot.state).toBe('running')
      expect(managerService?.snapshot.process.identityVerified).toBe(true)
    } finally {
      await electronApp.close().catch(() => {})
      if (managerPid) await waitForProcessExit(managerPid, 10_000)
      await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
      await fs.rm(dataRoot, { recursive: true, force: true }).catch(() => {})
    }
  }, 45_000)

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
        DEVKIT_USER_DATA_DIR: userDataDir,
        NODE_ENV: 'production',
      },
    })

    try {
      const window = await electronApp.firstWindow()

      // Verify the window opened
      await expect(window).toHaveTitle(/Dev Toolbox/)

      // Verify window.api is exposed via Preload
      const apiAvailable = await window.evaluate(() => {
        return typeof window.api === 'object' && window.api !== null
      })
      expect(apiAvailable).toBe(true)
      const storageAndIntegrationApiAvailable = await window.evaluate(() =>
        typeof window.api.storage.karakeep?.getStatus === 'function'
        && typeof window.api.storage.karakeep?.connectWithSecretReference === 'function'
        && typeof window.api.storage.karakeep?.disconnect === 'function'
        && !('connect' in window.api.storage.karakeep)
        && !('list' in window.api.storage.karakeep)
        && !('search' in window.api.storage.karakeep)
        && !('readBookmark' in window.api.storage.karakeep)
        && typeof window.api.integrations.selectMultiAggregatorExecutable === 'function'
      )
      expect(storageAndIntegrationApiAvailable).toBe(true)

      // Verify no console errors
      const consoleErrors: string[] = []
      window.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text())
        }
      })

      await window.waitForLoadState('domcontentloaded')
      await expect(window.getByRole('region', { name: 'Workspace status' })).toBeVisible()
      await expect(window.getByRole('button', { name: 'Open Services' })).toBeVisible()
      await expect(window.getByRole('button', { name: 'Open MCPWorkers Manager' })).toBeVisible()
      await new Promise((resolve) => setTimeout(resolve, 2000))

      await expect(window.getByRole('button', { name: 'Open Storage' })).toBeVisible()
      await window.getByRole('button', { name: 'Open Storage' }).click()

      await expect(window.getByRole('heading', { name: 'Storage', exact: true })).toBeVisible()
      await expect(window.getByText('Karakeep', { exact: true })).toBeVisible()
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

  test('completes the MCP stdio lifecycle through IPC and the main-process trust gate', async () => {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'packaged-mcp-e2e-user-data-'))
    const electronApp = await electron.launch({
      executablePath: PACKAGED_EXE,
      args: [`--user-data-dir=${userDataDir}`],
      env: { ...process.env, DEVKIT_USER_DATA_DIR: userDataDir, NODE_ENV: 'production' },
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
      const result = await window.evaluate(async ({ nodeExecutable, fixturePath, workingDirectory, childPidFile }) => {
        const created = await window.api.mcp.addConnection({
          id: 'e2e-mcp-fixture',
          name: 'Packaged E2E MCP fixture',
          transport: {
            type: 'stdio',
            command: nodeExecutable,
            args: [fixturePath],
            cwd: workingDirectory,
            env: { DEVKIT_E2E_CHILD_PID_FILE: childPidFile },
          },
        })
        const connected = await window.api.mcp.connect(created.id)
        if (!connected || connected.state !== 'connected') {
          throw new Error('Packaged MCP fixture did not connect: ' + (connected?.error ?? 'connection was cancelled'))
        }
        if (!connected.tools.some((tool) => tool.name === 'fixture_ping')) {
          throw new Error('Packaged MCP fixture did not expose its expected tool.')
        }
        const disconnected = await window.api.mcp.disconnect(created.id)
        if (disconnected.state !== 'disconnected') throw new Error('Packaged MCP fixture did not disconnect.')
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
        workingDirectory: path.join(__dirname, 'fixtures'),
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

  test('should verify app.isPackaged is true in production', async () => {
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'packaged-e2e-user-data-'))
    const electronApp = await electron.launch({
      executablePath: PACKAGED_EXE,
      args: [`--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        DEVKIT_USER_DATA_DIR: userDataDir,
        NODE_ENV: 'production',
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
        DEVKIT_USER_DATA_DIR: userDataDir,
        NODE_ENV: 'production',
      },
    })

    try {
      const window = await electronApp.firstWindow()
      await window.waitForLoadState('domcontentloaded')

      const updaterAvailable = await window.evaluate(() => {
        const api = window.api
        return (
          typeof api?.updater === 'object' &&
          typeof api?.updater?.getInfo === 'function' &&
          typeof api?.updater?.check === 'function'
        )
      })
      expect(updaterAvailable).toBe(true)

      if (process.env.REQUIRE_WINDOWS_CODE_SIGNING !== '1') {
        const updaterStatus = await window.evaluate(async () => window.api.updater.check())
        expect(updaterStatus.status).not.toBe('unsupported')
        expect(updaterStatus.error ?? '').not.toContain('trusted code-signing publisher')
      }
    } finally {
      await electronApp.close().catch(() => {})
      await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
    }
  }, 30000)
  test('should terminate a managed service when the packaged Electron main process crashes', async () => {
    test.skip(process.platform !== 'win32' || process.arch !== 'x64', 'Native process containment is Windows x64 only.')
    const userDataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'packaged-crash-e2e-'))
    const electronApp = await electron.launch({
      executablePath: PACKAGED_EXE,
      args: [`--user-data-dir=${userDataDir}`],
      env: { ...process.env, DEVKIT_USER_DATA_DIR: userDataDir, NODE_ENV: 'production' },
    })
    const heartbeatPath = path.join(userDataDir, 'managed-child-heartbeat.txt')
    let managedPid: number | undefined
    const playwrightProcess: ChildProcess = electronApp.process()

    try {
      const window = await electronApp.firstWindow()
      await window.waitForLoadState('domcontentloaded')
      const started = await window.evaluate(async ({ executablePath, workingDirectory, heartbeatPath }) => {
        const serviceId = 'installed-crash-probe'
        await window.api.runtime.registerService({
          id: serviceId,
          name: 'Installed application crash probe',
          version: '1.0.0',
          adapterId: 'process.local',
          owner: { kind: 'managed', resourceId: serviceId },
          capabilities: ['status', 'health', 'start', 'stop', 'restart'],
          platforms: ['win32'],
          dependencies: [],
          config: {
            executablePath,
            workingDirectory,
            args: [
              '-e',
              'const fs = require("node:fs"); const p = process.argv[1]; let n = 0; fs.writeFileSync(p, String(process.pid) + "|"); const timer = setInterval(() => { fs.appendFileSync(p, "x"); if (++n >= 120) { clearInterval(timer); process.exit(0); } }, 100);',
              heartbeatPath,
            ],
          },
        })
        const plan = await window.api.runtime.getStartPlan(serviceId)
        if (!plan.canExecute) throw new Error(`Crash probe startup plan is blocked: ${plan.blockers.join('; ')}`)
        const result = await window.api.runtime.executeStartPlan(serviceId, plan.toStart)
        const service = result.services.find((item) => item.service.id === serviceId)
        if (!service || service.snapshot.state !== 'running' || !service.snapshot.process.pid) {
          throw new Error('Installed Runtime did not report the managed crash probe as running.')
        }
        return { pid: service.snapshot.process.pid, state: service.snapshot.state }
      }, { executablePath: process.execPath, workingDirectory: path.dirname(process.execPath), heartbeatPath })

      managedPid = started.pid
      expect(started.state).toBe('running')
      await waitForFileSize(heartbeatPath, 3, 5000)
      const heartbeatPid = Number((await fs.readFile(heartbeatPath, 'utf8')).split('|')[0])
      expect(heartbeatPid).toBe(managedPid)

      await window.evaluate(() => window.api.runtime.stopService('installed-crash-probe'))
      await waitForFileStable(heartbeatPath, 1000, 5000)
      await fs.writeFile(heartbeatPath, '')
      const restarted = await window.evaluate(async () => {
        const plan = await window.api.runtime.getStartPlan('installed-crash-probe')
        if (!plan.canExecute) throw new Error(`Crash probe restart plan is blocked: ${plan.blockers.join('; ')}`)
        const result = await window.api.runtime.executeStartPlan('installed-crash-probe', plan.toStart)
        const service = result.services.find((item) => item.service.id === 'installed-crash-probe')
        if (!service || service.snapshot.state !== 'running' || !service.snapshot.process.pid) {
          throw new Error('Installed Runtime did not restart the managed crash probe.')
        }
        return service.snapshot.process.pid
      })
      managedPid = restarted
      await waitForFileSize(heartbeatPath, 3, 5000)
      const restartedHeartbeatPid = Number((await fs.readFile(heartbeatPath, 'utf8')).split('|')[0])
      expect(restartedHeartbeatPid).toBe(managedPid)

      const electronMainPid = await electronApp.evaluate(() => process.pid)
      console.log('[crash-containment] Playwright process PID=' + playwrightProcess.pid + ', Electron main PID=' + electronMainPid + ', managed PID=' + managedPid)
      process.kill(electronMainPid, 'SIGKILL')
      await waitForFileStable(heartbeatPath, 1000, 5000)
    } finally {
      await electronApp.close().catch(() => {})
      if (playwrightProcess.exitCode === null && playwrightProcess.signalCode === null) {
        const processExit = once(playwrightProcess, 'exit')
        playwrightProcess.kill('SIGKILL')
        await Promise.race([processExit, new Promise((resolve) => setTimeout(resolve, 5000))])
      }
      if (managedPid && await fs.stat(heartbeatPath).catch(() => false)) {
        await waitForFileStable(heartbeatPath, 1000, 15000)
      }
      await fs.rm(userDataDir, { recursive: true, force: true }).catch(() => {})
    }
  }, 45000)
})
