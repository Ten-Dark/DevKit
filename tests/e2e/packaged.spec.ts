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
  'dist-electron',
  'win-unpacked',
  'Dev Toolbox.exe'
)

const PACKAGED_EXE = path.resolve(PACKAGED_EXE_PATH)

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
      env: { ...process.env, NODE_ENV: 'production' },
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
