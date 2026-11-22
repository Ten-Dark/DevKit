const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Runtime soak test requires Windows x64.')
}

const root = path.resolve(__dirname, '..')
const addonPath = path.join(root, 'dist-electron', 'main', 'native', 'windows_process_control.node')
if (!fs.existsSync(addonPath)) throw new Error('Production native addon is missing. Run npm run build first.')
const addon = require(addonPath)

const durationHours = Number(process.env.DEVKIT_SOAK_HOURS ?? 2)
const batchSize = Number(process.env.DEVKIT_SOAK_BATCH_SIZE ?? 100)
const cycleTimeoutMs = Number(process.env.DEVKIT_SOAK_CYCLE_TIMEOUT_MS ?? 10000)
if (!Number.isFinite(durationHours) || durationHours <= 0 || durationHours > 24) {
  throw new Error('DEVKIT_SOAK_HOURS must be greater than 0 and no more than 24.')
}
if (!Number.isSafeInteger(batchSize) || batchSize < 1 || batchSize > 500) {
  throw new Error('DEVKIT_SOAK_BATCH_SIZE must be an integer between 1 and 500.')
}

const durationMs = durationHours * 60 * 60 * 1000
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-runtime-soak-'))
const logPath = path.join(directory, 'samples.csv')
const environment = Object.fromEntries(
  ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'].flatMap((key) =>
    process.env[key] ? [[key, process.env[key]]] : [],
  ),
)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let activeHandle = null

function cleanupActiveHandle() {
  if (!activeHandle) return
  const handle = activeHandle
  activeHandle = null
  try { handle.terminateJob() } catch { /* The final close still enforces kill-on-close. */ }
  try { handle.close() } catch { /* Process exit will close the native handle table. */ }
}

process.on('exit', cleanupActiveHandle)
process.on('SIGINT', () => {
  cleanupActiveHandle()
  process.exit(130)
})
process.on('SIGTERM', () => {
  cleanupActiveHandle()
  process.exit(143)
})

async function waitForEmpty(handle, label) {
  const deadline = Date.now() + cycleTimeoutMs
  while (Date.now() < deadline) {
    if (handle.isJobEmpty()) return
    await sleep(20)
  }
  throw new Error('Timed out waiting for Job Object to empty: ' + label + ' (pid ' + handle.pid + ').')
}

async function runCycle(index) {
  const handle = addon.spawnManagedProcess(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000)'],
    directory,
    environment,
  )
  activeHandle = handle
  try {
    const terminated = handle.terminateJob()
    assert.equal(terminated, true, 'TerminateJobObject failed at cycle ' + index)
    await waitForEmpty(handle, 'cycle ' + index)
  } finally {
    try { handle.close() } finally {
      if (activeHandle === handle) activeHandle = null
    }
  }
}

async function main() {
  const startedAt = Date.now()
  const deadline = startedAt + durationMs
  const warmupCycles = 20
  let cycles = 0
  let batches = 0
  let minHandles
  let maxHandles
  let baselineHandles
  let previousHandles
  let sampleCount = 0

  fs.writeFileSync(logPath, 'timestamp,elapsed_seconds,cycles,handles,batch\n')
  console.log('Runtime native soak started: ' + durationHours + 'h; batch size ' + batchSize + '.')
  console.log('Temporary telemetry: ' + logPath)

  try {
    for (let index = 0; index < warmupCycles; index += 1) {
      await runCycle('warmup-' + index)
    }
    await sleep(1000)
    baselineHandles = addon.getCurrentProcessHandleCount()
    previousHandles = baselineHandles
    minHandles = baselineHandles
    maxHandles = baselineHandles

    while (Date.now() < deadline) {
      const batchStarted = Date.now()
      const remainingCycles = Math.min(batchSize, Math.max(1, Math.floor((deadline - Date.now()) / 1000)))
      for (let index = 0; index < remainingCycles && Date.now() < deadline; index += 1) {
        await runCycle(cycles + 1)
        cycles += 1
      }

      await sleep(250)
      const handles = addon.getCurrentProcessHandleCount()
      minHandles = Math.min(minHandles, handles)
      maxHandles = Math.max(maxHandles, handles)
      sampleCount += 1
      batches += 1

      const elapsedSeconds = Math.round((Date.now() - startedAt) / 1000)
      fs.appendFileSync(logPath, [
        new Date().toISOString(),
        elapsedSeconds,
        cycles,
        handles,
        batches,
      ].join(',') + '\n')

      if (handles > baselineHandles + 3) {
        throw new Error('Handle count exceeded baseline tolerance: ' + baselineHandles + ' -> ' + handles)
      }
      if (previousHandles > baselineHandles + 3) {
        throw new Error('Previous sample exceeded handle-count tolerance.')
      }
      previousHandles = handles

      if (batches % 10 === 0) {
        console.log(
          'Soak progress: ' + elapsedSeconds + 's; cycles=' + cycles +
          '; handles=' + handles + '; min/max=' + minHandles + '/' + maxHandles +
          '; last batch=' + (Date.now() - batchStarted) + 'ms.',
        )
      }
    }

    await sleep(1000)
    const finalHandles = addon.getCurrentProcessHandleCount()
    assert.ok(finalHandles <= baselineHandles + 3, 'Final handle count exceeded tolerance: ' + baselineHandles + ' -> ' + finalHandles)
    console.log('RUNTIME_SOAK_PASS')
    console.log(JSON.stringify({
      durationHours,
      elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
      cycles,
      batches,
      samples: sampleCount,
      baselineHandles,
      finalHandles,
      minHandles,
      maxHandles,
      telemetry: logPath,
    }, null, 2))
  } finally {
    cleanupActiveHandle()
  }
}

main().catch((error) => {
  console.error('RUNTIME_SOAK_FAIL')
  console.error(error)
  process.exitCode = 1
})
