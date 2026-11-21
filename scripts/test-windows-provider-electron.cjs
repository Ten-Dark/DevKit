const assert = require('node:assert/strict')
const { spawn, spawnSync } = require('node:child_process')
const { once } = require('node:events')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const asar = require('@electron/asar')

const root = path.resolve(__dirname, '..')
const fixture = path.join(root, 'dist-electron', 'native-provider-smoke')
const sourceDirectory = path.join(fixture, 'source')
const appAsar = path.join(fixture, 'app.asar')
const unpackedNativeDirectory = path.join(fixture, 'app.asar.unpacked', 'dist-electron', 'main', 'native')
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const portableNode = path.join(root, '.tools', 'node-v22.23.5-win-x64', 'node.exe')
const nodeExe = fs.existsSync(portableNode) ? portableNode : process.execPath

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Electron native-provider smoke test requires Windows x64.')
}
for (const required of [electronExe, nodeExe]) {
  if (!fs.existsSync(required)) throw new Error('Required native-provider smoke-test artifact is missing: ' + required)
}

const coreDirectory = path.join(sourceDirectory, 'dist-electron', 'main', 'core')
const providerSource = path.join(root, 'dist-electron', 'main', 'core', 'windows-process-control-provider.js')
const addonSource = path.join(root, 'dist-electron', 'main', 'native', 'windows_process_control.node')
for (const required of [providerSource, addonSource]) {
  if (!fs.existsSync(required)) throw new Error('Required native-provider smoke-test artifact is missing: ' + required)
}

const testEnvironment = Object.fromEntries(
  ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'].flatMap((key) =>
    process.env[key] ? [[key, process.env[key]]] : [],
  ),
)

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function waitFor(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await sleep(25)
  }
  throw new Error('Timed out waiting for ' + description + '.')
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if (error && (error.code === 'ESRCH' || error.code === 'EINVAL')) return false
    throw error
  }
}

async function main() {
  fs.rmSync(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  fs.mkdirSync(coreDirectory, { recursive: true })
  fs.mkdirSync(unpackedNativeDirectory, { recursive: true })
  fs.copyFileSync(providerSource, path.join(coreDirectory, 'windows-process-control-provider.js'))
  fs.copyFileSync(addonSource, path.join(unpackedNativeDirectory, 'windows_process_control.node'))
  fs.writeFileSync(path.join(sourceDirectory, 'package.json'), JSON.stringify({
    name: 'devkit-native-provider-packaged-smoke',
    version: '1.0.0',
    type: 'module',
    main: 'main.mjs',
  }, null, 2))

  fs.writeFileSync(path.join(sourceDirectory, 'main.mjs'), `import { app } from 'electron'
import { once } from 'node:events'
import { writeFileSync } from 'node:fs'
import { WindowsProcessControlProvider } from './dist-electron/main/core/windows-process-control-provider.js'

app.whenReady().then(async () => {
  try {
    if (!app.getAppPath().toLowerCase().endsWith('app.asar')) {
      throw new Error('Smoke fixture did not load from an app.asar archive: ' + app.getAppPath())
    }
    const provider = new WindowsProcessControlProvider()
    if (!provider.capabilities.processTreeManagement) throw new Error('Job Object capability is not enabled.')
    const handle = provider.spawn(process.env.DEVKIT_TEST_NODE, ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: process.cwd(),
      env: process.env,
    })
    await once(handle, 'spawn')

    if (process.env.DEVKIT_ELECTRON_CRASH_TEST === '1') {
      writeFileSync(process.env.DEVKIT_SMOKE_PID_FILE, String(handle.pid))
      setInterval(() => {}, 1000)
      return
    }

    const exited = once(handle, 'exit')
    provider.forceTerminate(handle)
    await exited
    console.log('Packaged-ASAR Electron native-provider smoke test passed.')
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
`)

  try {
    await asar.createPackage(sourceDirectory, appAsar)

    const normal = spawnSync(electronExe, [appAsar], {
      cwd: fixture,
      env: { ...testEnvironment, DEVKIT_TEST_NODE: nodeExe },
      encoding: 'utf8',
      timeout: 20000,
      windowsHide: true,
    })
    if (normal.stdout) process.stdout.write(normal.stdout)
    if (normal.stderr) process.stderr.write(normal.stderr)
    if (normal.error) throw normal.error
    if (normal.status !== 0) throw new Error('Packaged-ASAR Electron smoke test exited with status ' + String(normal.status))

    const pidFile = path.join(fixture, 'crash-managed-process.pid')
    const electron = spawn(electronExe, [appAsar], {
      cwd: fixture,
      env: {
        ...testEnvironment,
        DEVKIT_TEST_NODE: nodeExe,
        DEVKIT_ELECTRON_CRASH_TEST: '1',
        DEVKIT_SMOKE_PID_FILE: pidFile,
      },
      windowsHide: true,
      stdio: 'ignore',
    })
    const electronExit = once(electron, 'exit')
    try {
      await waitFor(() => fs.existsSync(pidFile), 10000, 'packaged Electron to start its managed child')
      const managedPid = Number(fs.readFileSync(pidFile, 'utf8'))
      assert.ok(Number.isInteger(managedPid) && managedPid > 0)
      assert.equal(isProcessAlive(managedPid), true)
      electron.kill('SIGKILL')
      await electronExit
      await waitFor(() => !isProcessAlive(managedPid), 5000, 'kill-on-close after abrupt packaged Electron main-process termination')
      console.log('Packaged-ASAR Electron main-process crash-containment test passed.')
    } finally {
      if (electron.exitCode === null && electron.signalCode === null) {
        electron.kill('SIGKILL')
        await Promise.race([electronExit, sleep(5000)])
      }
    }
  } finally {
    fs.rmSync(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
