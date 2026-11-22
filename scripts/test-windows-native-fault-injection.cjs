const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Native fault-injection tests require Windows x64.')
}

const addonPath = path.join(
  __dirname,
  '..',
  'native',
  'windows-process-control',
  'build',
  'Release',
  'windows_process_control_fault_test.node',
)
if (!fs.existsSync(addonPath)) {
  throw new Error('Fault-injection addon is missing. Run npm run build first: ' + addonPath)
}

const addon = require(addonPath)
if (typeof addon.setNativeFaultMode !== 'function') {
  throw new Error('Fault-injection addon does not expose its test-only control.')
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-native-fault-'))
const markerFile = path.join(directory, 'must-not-execute.txt')
const serviceScript =
  'setTimeout(() => require("node:fs").writeFileSync(' + JSON.stringify(markerFile) + ', "executed"), 1000); setInterval(() => {}, 1000)'
const executable = process.execPath
const environment = Object.fromEntries(
  ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA'].flatMap((key) =>
    process.env[key] ? [[key, process.env[key]]] : [],
  ),
)

const scenarios = [
  ['assign-failure', /AssignProcessToJobObject failed/],
  ['resume-zero', /ResumeThread did not release exactly the initial suspend count/],
  ['resume-two', /ResumeThread did not release exactly the initial suspend count/],
  ['resume-failure', /ResumeThread failed/],
]

async function assertNoExecution(mode, expectedError) {
  addon.setNativeFaultMode(mode)
  assert.throws(
    () => addon.spawnManagedProcess(executable, ['-e', serviceScript], directory, environment),
    expectedError,
    'Injected ' + mode + ' fault must reject startup.',
  )
  // A real ResumeThread result of zero means the thread was already running.
  // The delayed marker also detects any child that was accidentally resumed on
  // another failure path and survived Job Object termination.
  await new Promise((resolve) => setTimeout(resolve, 1250))
  assert.equal(
    fs.existsSync(markerFile),
    false,
    'The child survived fail-closed Job Object termination after injected ' + mode + ' failure.',
  )
}

async function warmup() {
  // Initialize the Windows error-reporting path before measuring handles.
  assert.throws(
    () => addon.spawnManagedProcess(path.join(directory, 'missing.exe'), [], directory, environment),
    /CreateProcessW failed/,
  )

  for (let index = 0; index < 5; index += 1) {
    const managed = addon.spawnManagedProcess(executable, ['-e', 'process.exit(0)'], directory, environment)
    const deadline = Date.now() + 5000
    while (!managed.isJobEmpty() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    assert.equal(managed.isJobEmpty(), true, 'Native fault-injection warm-up process did not exit.')
    managed.close()
  }

  // Exercise each error-reporting path once before the handle baseline.
  for (const [mode, expectedError] of scenarios) {
    await assertNoExecution(mode, expectedError)
  }
  await new Promise((resolve) => setTimeout(resolve, 500))
}

async function main() {
  try {
    await warmup()
    const baseline = addon.getCurrentProcessHandleCount()

    for (const [mode, expectedError] of scenarios) {
      for (let iteration = 0; iteration < 5; iteration += 1) {
        await assertNoExecution(mode, expectedError)
        console.log('Fault-injection fail-closed scenario passed: ' + mode + ' (' + (iteration + 1) + '/5).')
      }
    }

    const settled = addon.getCurrentProcessHandleCount()
    assert.ok(
      settled <= baseline + 1,
      'Native handle count did not return near baseline after fault injection: ' + baseline + ' -> ' + settled,
    )

    // The ordinary production addon must never expose the fault-injection API.
    const productionAddonPath = path.join(__dirname, '..', 'dist-electron', 'main', 'native', 'windows_process_control.node')
    if (fs.existsSync(productionAddonPath)) {
      const productionAddon = require(productionAddonPath)
      assert.equal(productionAddon.setNativeFaultMode, undefined)
    }

    console.log(
      'Native fault-injection suite passed: four scenarios x five repetitions; handles ' +
        baseline +
        ' -> ' +
        settled +
        '.',
    )
  } finally {
    addon.setNativeFaultMode('none')
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
