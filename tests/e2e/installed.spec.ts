import { test, expect } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const installerPath = path.resolve('dist', 'Dev Toolbox Setup 1.0.4.exe')

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
  throw new Error('Installed MCPWorkers Manager process did not exit after DevKit shutdown.')
}

test('NSIS-installed DevKit starts and gracefully shuts down MCPWorkers using a persisted existing data root', async () => {
  test.skip(process.platform !== 'win32' || process.arch !== 'x64', 'NSIS installed-app acceptance is Windows x64 only.')
  test.skip(process.env.DEVKIT_RUN_NSIS_INSTALLED !== '1', 'Set DEVKIT_RUN_NSIS_INSTALLED=1 to run the isolated NSIS installation acceptance.')

  await fs.access(installerPath)
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'devkit-nsis-stage2-'))
  const installDirectory = path.join(temporaryRoot, 'install')
  const profileDirectory = path.join(temporaryRoot, 'profile')
  const dataRoot = path.join(temporaryRoot, 'existing-mcpworkers-data')
  const registryDirectory = path.join(dataRoot, 'registry')
  const userDataDirectory = path.join(profileDirectory, 'devkit')
  const configPath = path.join(userDataDirectory, 'mcpworkers-manager-runtime.json')
  let electronApp: Awaited<ReturnType<typeof electron.launch>> | undefined
  let managerPid: number | undefined

  try {
    const install = spawnSync(installerPath, ['/S', '/D=' + installDirectory], {
      encoding: 'utf8',
      timeout: 120_000,
      windowsHide: true,
    })
    if (install.error) throw install.error
    if (install.status !== 0) throw new Error('NSIS installer exited with status ' + String(install.status))

    const installedExecutable = path.join(installDirectory, 'Dev Toolbox.exe')
    await fs.access(installedExecutable)
    await fs.mkdir(registryDirectory, { recursive: true })
    await fs.mkdir(userDataDirectory, { recursive: true })
    await fs.writeFile(
      path.join(registryDirectory, 'registry.json'),
      JSON.stringify({ schemaVersion: 1, definitions: [], instances: [] }),
      'utf8',
    )
    // This is the persisted result of the Services > Locate existing storage flow.
    await fs.writeFile(configPath, JSON.stringify({ schemaVersion: 1, dataRoot }), 'utf8')

    const environment = { ...process.env, DEVKIT_USER_DATA_DIR: userDataDirectory, NODE_ENV: 'production' }
    delete environment.DEVKIT_MCPWORKERS_DATA_ROOT
    electronApp = await electron.launch({
      executablePath: installedExecutable,
      args: [],
      env: environment,
    })

    const window = await electronApp.firstWindow()
    await expect(window).toHaveTitle(/Dev Toolbox/)
    await expect.poll(async () => window.evaluate(async () => (
      (await window.api.mcpWorkers.getManagerRuntimeStatus()).runtime.state
    )), { timeout: 30_000 }).toBe('managed')

    const runtimeStatus = await window.evaluate(() => window.api.mcpWorkers.getManagerRuntimeStatus())
    expect(runtimeStatus.runtime).toMatchObject({ state: 'managed', ownership: 'devkit' })
    expect(runtimeStatus.dataRoot).toBe(dataRoot)
    managerPid = runtimeStatus.runtime.pid
    expect(managerPid).toEqual(expect.any(Number))

    await window.getByRole('button', { name: 'Services', exact: true }).click()
    await expect(window.getByRole('heading', { name: 'Services', exact: true })).toBeVisible()
    await expect(window.getByText('Runtime ownership: Managed by DevKit')).toBeVisible()
    await expect(window.getByText(dataRoot)).toBeVisible()
    await expect.poll(async () => window.evaluate(async () => (
      (await window.api.mcpWorkers.getHealth()).state
    )), { timeout: 15_000 }).toBe('reachable')

    await electronApp.close()
    electronApp = undefined
    if (managerPid) await waitForProcessExit(managerPid, 10_000)
    await expect.poll(async () => fetch('http://127.0.0.1:43127/v1/health').then(() => true).catch(() => false), {
      timeout: 5_000,
    }).toBe(false)
  } finally {
    await electronApp?.close().catch(() => {})
    if (managerPid) await waitForProcessExit(managerPid, 10_000).catch(() => {})
    const uninstallerPath = path.join(installDirectory, 'Uninstall Dev Toolbox.exe')
    if (await fs.stat(uninstallerPath).catch(() => false)) {
      spawnSync(uninstallerPath, ['/S'], { encoding: 'utf8', timeout: 60_000, windowsHide: true })
    }
    await fs.rm(temporaryRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }).catch(() => {})
  }
}, 180_000)
