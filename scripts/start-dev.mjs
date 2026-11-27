import { execFileSync, spawn } from 'node:child_process'
import { createServer } from 'node:net'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const port = 5173
const rendererUrl = 'http://localhost:' + port
const viteEntry = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js')
const electronBinary = path.join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')

let viteProcess
let electronProcess
let shuttingDown = false

function stopProcess(child) {
  if (child && child.exitCode === null && child.signalCode === null) child.kill()
}

async function ensurePortIsAvailable() {
  await new Promise((resolve, reject) => {
    const probe = createServer()
    probe.once('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        reject(new Error('Port ' + port + ' is already in use. Close the other DevKit/Vite development session first.'))
        return
      }
      reject(error)
    })
    probe.listen(port, 'localhost', () => {
      probe.close((error) => error ? reject(error) : resolve())
    })
  })
}

function compileElectronRuntime() {
  const compiler = path.join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc')
  execFileSync(process.execPath, [compiler], { cwd: projectRoot, stdio: 'inherit' })
  execFileSync(process.execPath, [path.join(projectRoot, 'scripts', 'build-stdio-bootstrap.cjs')], {
    cwd: projectRoot,
    stdio: 'inherit',
  })
  execFileSync(process.execPath, [
    compiler,
    '--target', 'ES2022',
    '--module', 'commonjs',
    '--moduleResolution', 'node',
    '--outDir', path.join(projectRoot, 'dist-electron', 'preload-cjs'),
    '--skipLibCheck',
    '--esModuleInterop',
    '--types', 'node,electron',
    path.join(projectRoot, 'src', 'preload', 'preload.ts'),
  ], { cwd: projectRoot, stdio: 'inherit' })
  execFileSync(process.execPath, [path.join(projectRoot, 'scripts', 'rename-preload.mjs')], {
    cwd: projectRoot,
    stdio: 'inherit',
  })
  console.log('Electron main and preload compiled from current sources.')
}

async function waitForVite() {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (viteProcess.exitCode !== null || viteProcess.signalCode !== null) {
      throw new Error('Vite exited before the development server became ready.')
    }
    try {
      const response = await fetch(rendererUrl, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return
    } catch {
      // Vite is still starting.
    }
    await delay(250)
  }
  throw new Error('Vite did not become ready at ' + rendererUrl + ' within 30 seconds.')
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  stopProcess(electronProcess)
  stopProcess(viteProcess)
  process.exitCode = exitCode
}

async function main() {
  await ensurePortIsAvailable()
  compileElectronRuntime()
  const env = { ...process.env, NODE_ENV: 'development', VITE_DEV_SERVER_URL: rendererUrl }

  viteProcess = spawn(process.execPath, [viteEntry, '--host', 'localhost'], {
    cwd: projectRoot, env, stdio: 'inherit',
  })
  viteProcess.once('error', (error) => {
    console.error('Could not start Vite:', error)
    shutdown(1)
  })
  viteProcess.once('exit', (code) => {
    if (!shuttingDown) {
      console.error('Vite exited unexpectedly (code ' + (code ?? 'unknown') + ').')
      shutdown(code ?? 1)
    }
  })

  await waitForVite()
  console.log('Vite is ready at ' + rendererUrl + '; launching Electron with the development environment.')

  electronProcess = spawn(electronBinary, [projectRoot], {
    cwd: projectRoot, env, stdio: 'inherit',
  })
  electronProcess.once('error', (error) => {
    console.error('Could not start the Electron application:', error)
    shutdown(1)
  })
  electronProcess.once('exit', (code, signal) => {
    if (!shuttingDown) {
      if (signal) console.error('Electron exited after signal ' + signal + '.')
      shutdown(code ?? 1)
    }
  })
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => shutdown(signal === 'SIGINT' ? 130 : 143))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  shutdown(1)
})
