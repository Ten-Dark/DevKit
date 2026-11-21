const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawn, spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
const addonPath = path.join(root, 'dist-electron', 'main', 'native', 'windows_process_control.node')
const nestedHostPath = path.join(root, 'native', 'windows-process-control', 'build', 'Release', 'nested_job_host.exe')
if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Native process-control integration tests require Windows x64.')
}
for (const required of [addonPath, nestedHostPath]) {
  if (!fs.existsSync(required)) throw new Error('Required native test artifact is missing: ' + required)
}
const addon = require(addonPath)
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

async function verifyNestedJob(mode, directory) {
  const resultFile = path.join(directory, 'nested-' + mode + '.json')
  const markerFile = path.join(directory, 'nested-' + mode + '-executed.txt')
  const serviceScript = 'require("node:fs").writeFileSync(' + JSON.stringify(markerFile) + ', "executed"); setInterval(() => {}, 1000)'
  const nestedScript = [
    "const fs = require('node:fs')",
    'const addon = require(' + JSON.stringify(addonPath) + ')',
    'const resultFile = ' + JSON.stringify(resultFile),
    'const markerFile = ' + JSON.stringify(markerFile),
    'const mode = ' + JSON.stringify(mode),
    ';(async () => {',
    '  try {',
    '    const managed = addon.spawnManagedProcess(process.execPath, ["-e", ' + JSON.stringify(serviceScript) + '], process.cwd(), process.env)',
    '    const deadline = Date.now() + 5000',
    '    while (!fs.existsSync(markerFile) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20))',
    '    if (!fs.existsSync(markerFile)) throw new Error("Nested managed process did not execute after assignment.")',
    '    managed.terminateJob()',
    '    const emptyDeadline = Date.now() + 5000',
    '    while (!managed.isJobEmpty() && Date.now() < emptyDeadline) await new Promise(resolve => setTimeout(resolve, 20))',
    '    if (!managed.isJobEmpty()) throw new Error("Nested Job Object did not become empty.")',
    '    managed.close()',
    '    fs.writeFileSync(resultFile, JSON.stringify({ ok: true, pid: managed.pid }))',
    '  } catch (error) {',
    '    fs.writeFileSync(resultFile, JSON.stringify({ ok: false, error: String(error && error.message || error) }))',
    '    if (mode !== "constrained" || !String(error && error.message || error).includes("CreateProcessW failed")) process.exitCode = 1',
    '  }',
    '})()',
  ].join('\n')
  const scriptFile = path.join(directory, 'nested-' + mode + '.cjs')
  fs.writeFileSync(scriptFile, nestedScript)

  const result = spawnSync(nestedHostPath, [
    process.execPath,
    scriptFile,
    addonPath,
    resultFile,
    directory,
    mode,
  ], {
    cwd: directory,
    env: testEnvironment,
    encoding: 'utf8',
    timeout: 25000,
    windowsHide: true,
  })
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
  if (result.error) throw result.error

  if (result.status === 77) {
    console.warn('Nested Job Object test skipped: the host environment prevented creation of the outer test job.')
    return false
  }
  assert.equal(result.status, 0, 'Nested Job Object host exited unsuccessfully for mode ' + mode)
  assert.equal(fs.existsSync(resultFile), true, 'Nested Job Object result was not written for mode ' + mode)
  const outcome = JSON.parse(fs.readFileSync(resultFile, 'utf8'))

  if (mode === 'compatible') {
    assert.equal(outcome.ok, true, outcome.error || 'Compatible nested Job Object assignment failed.')
    assert.equal(fs.existsSync(markerFile), true, 'Managed process did not execute after nested assignment.')
    console.log('Compatible nested Job Object test passed.')
  } else {
    assert.equal(outcome.ok, false, 'Provider unexpectedly started a process inside an outer Job Object at its active-process limit.')
    assert.match(outcome.error, /CreateProcessW failed/)
    assert.equal(fs.existsSync(markerFile), false, 'Process executed despite the outer Job Object process limit.')
    console.log('Constrained parent Job Object fail-closed test passed.')
  }
  return true
}

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-job-object-'))
  let crashOwner = null
  try {
    assert.throws(
      () => addon.spawnManagedProcess(path.join(directory, 'missing.exe'), [], directory, {}),
      /CreateProcessW failed/,
    )
    assert.throws(
      () => addon.spawnManagedProcess(process.execPath, [], directory, { TOO_LARGE: 'x'.repeat(32768) }),
      /environment block/,
    )
    assert.throws(
      () => addon.spawnManagedProcess(process.execPath, [], directory, { ['INVALID\0KEY']: 'value' }),
      /environment/,
    )
    assert.throws(
      () => addon.spawnManagedProcess(process.execPath, [], directory, { VALID_KEY: 'invalid\0value' }),
      /environment/,
    )
    assert.throws(
      () => addon.spawnManagedProcess(process.execPath, [], directory, { ['INVALID=KEY']: 'value' }),
      /environment/,
    )
    assert.throws(
      () => addon.spawnManagedProcess(process.execPath, ['x'.repeat(32761)], directory, {}),
      /command line/,
    )

    const childPidFile = path.join(directory, 'grandchild.pid')
    const parentScript = [
      "const fs = require('node:fs')",
      "const { spawn } = require('node:child_process')",
      "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' })",
      'fs.writeFileSync(' + JSON.stringify(childPidFile) + ', String(child.pid))',
      'setInterval(() => {}, 1000)',
    ].join(';')
    const managed = addon.spawnManagedProcess(
      process.execPath,
      ['-e', parentScript],
      directory,
      testEnvironment,
    )

    await waitFor(() => fs.existsSync(childPidFile), 5000, 'the managed grandchild to start')
    const grandchildPid = Number(fs.readFileSync(childPidFile, 'utf8'))
    assert.ok(Number.isInteger(grandchildPid) && grandchildPid > 0)
    assert.equal(isProcessAlive(managed.pid), true)
    assert.equal(isProcessAlive(grandchildPid), true)

    assert.equal(managed.terminateJob(), true)
    await waitFor(() => managed.isJobEmpty(), 5000, 'the Job Object process count to reach zero')
    assert.equal(isProcessAlive(managed.pid), false)
    assert.equal(isProcessAlive(grandchildPid), false)
    managed.close()

    const argumentFile = path.join(directory, 'quoted-argument.txt')
    const argumentValue = 'Unicode Ω and quote " with trailing \\'
    const argumentScript = 'require("node:fs").writeFileSync(' + JSON.stringify(argumentFile) + ', process.argv[1])'
    const argumentManaged = addon.spawnManagedProcess(
      process.execPath,
      ['-e', argumentScript, argumentValue],
      directory,
      testEnvironment,
    )
    await waitFor(() => fs.existsSync(argumentFile), 5000, 'the quoted Unicode argument to be delivered')
    assert.equal(fs.readFileSync(argumentFile, 'utf8'), argumentValue)
    await waitFor(() => argumentManaged.isJobEmpty(), 5000, 'the argument fixture to exit')
    argumentManaged.close()

    const statusManaged = addon.spawnManagedProcess(
      process.execPath,
      ['-e', 'process.exit(259)'],
      directory,
      testEnvironment,
    )
    await waitFor(() => statusManaged.isJobEmpty(), 5000, 'the exit-code fixture to exit')
    assert.equal(statusManaged.getExitCode(), 259)
    statusManaged.close()

    const ownPidFile = path.join(directory, 'close-test.pid')
    const closeScript = 'require("node:fs").writeFileSync(' + JSON.stringify(ownPidFile) + ', String(process.pid)); setInterval(() => {}, 1000)'
    const closeManaged = addon.spawnManagedProcess(
      process.execPath,
      ['-e', closeScript],
      directory,
      testEnvironment,
    )
    await waitFor(() => fs.existsSync(ownPidFile), 5000, 'the kill-on-close test process to start')
    const closePid = Number(fs.readFileSync(ownPidFile, 'utf8'))
    closeManaged.close()
    await waitFor(() => !isProcessAlive(closePid), 5000, 'kill-on-close to terminate the process')

    const crashPidFile = path.join(directory, 'crash-owner-child.pid')
    const crashOwnerScript = [
      "const fs = require('node:fs')",
      'const addon = require(' + JSON.stringify(addonPath) + ')',
      'const managed = addon.spawnManagedProcess(process.execPath, ["-e", "setInterval(() => {}, 1000)"], process.cwd(), ' + JSON.stringify(testEnvironment) + ')',
      'fs.writeFileSync(' + JSON.stringify(crashPidFile) + ', String(managed.pid))',
      'setInterval(() => {}, 1000)',
    ].join(';')
    crashOwner = spawn(process.execPath, ['-e', crashOwnerScript], {
      cwd: directory,
      env: testEnvironment,
      windowsHide: true,
      stdio: 'ignore',
    })
    const crashOwnerExit = new Promise((resolve, reject) => {
      crashOwner.once('exit', resolve)
      crashOwner.once('error', reject)
    })
    await waitFor(() => fs.existsSync(crashPidFile), 5000, 'the crash-owner process to create its managed child')
    const crashChildPid = Number(fs.readFileSync(crashPidFile, 'utf8'))
    assert.equal(isProcessAlive(crashChildPid), true)
    crashOwner.kill('SIGKILL')
    await crashOwnerExit
    await waitFor(() => !isProcessAlive(crashChildPid), 5000, 'kill-on-close after abrupt owner termination')
    console.log('Native owner crash-containment test passed.')

    for (let index = 0; index < 5; index += 1) {
      const handle = addon.spawnManagedProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], directory, testEnvironment)
      handle.terminateJob()
      await waitFor(() => handle.isJobEmpty(), 5000, 'warm-up stress process to exit')
      handle.close()
    }
    const handleCountBaseline = addon.getCurrentProcessHandleCount()
    for (let index = 0; index < 100; index += 1) {
      const handle = addon.spawnManagedProcess(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], directory, testEnvironment)
      handle.terminateJob()
      await waitFor(() => handle.isJobEmpty(), 5000, 'stress process ' + index + ' to exit')
      handle.close()
      if ((index + 1) % 25 === 0) await sleep(20)
    }
    const handleCountAfterStress = addon.getCurrentProcessHandleCount()
    assert.ok(
      handleCountAfterStress <= handleCountBaseline + 3,
      'Native handle count grew from ' + handleCountBaseline + ' to ' + handleCountAfterStress + ' after 100 start/stop cycles.',
    )
    console.log('Native lifecycle stress passed: 100 start/stop cycles; process handles ' + handleCountBaseline + ' -> ' + handleCountAfterStress + '.')

    const compatibleNestedJobTest = await verifyNestedJob('compatible', directory)
    const constrainedNestedJobTest = compatibleNestedJobTest
      ? await verifyNestedJob('constrained', directory)
      : false
    if (!compatibleNestedJobTest || !constrainedNestedJobTest) {
      console.warn('Nested Job Object coverage is incomplete on this host.')
    }

    console.log('Native Windows process-control integration tests passed.')
  } finally {
    if (crashOwner && crashOwner.exitCode === null && crashOwner.signalCode === null) {
      crashOwner.kill('SIGKILL')
      await new Promise((resolve) => {
        if (crashOwner.exitCode !== null || crashOwner.signalCode !== null) return resolve()
        crashOwner.once('exit', resolve)
        crashOwner.once('error', resolve)
      })
    }
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
