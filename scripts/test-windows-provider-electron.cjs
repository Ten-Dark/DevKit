const { spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const fixture = path.join(root, 'dist-electron', 'native-provider-smoke')
const electronExe = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const portableNode = path.join(root, '.tools', 'node-v22.23.5-win-x64', 'node.exe')
const nodeExe = fs.existsSync(portableNode) ? portableNode : process.execPath
const providerSource = path.join(root, 'dist-electron', 'main', 'core', 'windows-process-control-provider.js')
const addonSource = path.join(root, 'dist-electron', 'main', 'native', 'windows_process_control.node')

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Electron native-provider smoke test requires Windows x64.')
}
for (const required of [electronExe, providerSource, addonSource, nodeExe]) {
  if (!fs.existsSync(required)) throw new Error('Required native-provider smoke-test artifact is missing: ' + required)
}

const coreDirectory = path.join(fixture, 'dist-electron', 'main', 'core')
const nativeDirectory = path.join(fixture, 'dist-electron', 'main', 'native')
fs.rmSync(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
fs.mkdirSync(coreDirectory, { recursive: true })
fs.mkdirSync(nativeDirectory, { recursive: true })
fs.copyFileSync(providerSource, path.join(coreDirectory, 'windows-process-control-provider.js'))
fs.copyFileSync(addonSource, path.join(nativeDirectory, 'windows_process_control.node'))
fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({
  name: 'devkit-native-provider-smoke',
  version: '1.0.0',
  type: 'module',
  main: 'main.mjs',
}, null, 2))

fs.writeFileSync(path.join(fixture, 'main.mjs'), `import { app } from 'electron'
import { once } from 'node:events'
import { WindowsProcessControlProvider } from './dist-electron/main/core/windows-process-control-provider.js'

app.whenReady().then(async () => {
  try {
    const provider = new WindowsProcessControlProvider()
    if (!provider.capabilities.processTreeManagement) throw new Error('Job Object capability is not enabled.')
    const handle = provider.spawn(process.env.DEVKIT_TEST_NODE, ['-e', 'setInterval(() => {}, 1000)'], {
      cwd: app.getAppPath(),
      env: process.env,
    })
    await once(handle, 'spawn')
    const exited = once(handle, 'exit')
    provider.forceTerminate(handle)
    await exited
    console.log('Electron native-provider smoke test passed.')
    app.exit(0)
  } catch (error) {
    console.error(error)
    app.exit(1)
  }
})
`)

try {
  const result = spawnSync(electronExe, [fixture], {
    cwd: root,
    env: {
      ...Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'].flatMap((key) =>
        process.env[key] ? [[key, process.env[key]]] : [],
      )),
      DEVKIT_TEST_NODE: nodeExe,
    },
    encoding: 'utf8',
    timeout: 20000,
    windowsHide: true,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error('Electron native-provider smoke test exited with status ' + String(result.status))
  console.log('Electron native-provider smoke test completed.')
} finally {
  fs.rmSync(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
