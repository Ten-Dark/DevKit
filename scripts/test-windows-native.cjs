const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const addonPath = path.resolve(__dirname, '..', 'dist-electron', 'main', 'native', 'windows_process_control.node')
if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('Native process-control integration tests require Windows x64.')
}
const addon = require(addonPath)
const testEnvironment = Object.fromEntries(
  ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP'].flatMap((key) =>
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
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'devkit-job-object-'))
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
    console.log('Native Windows process-control integration tests passed.')
  } finally {
    fs.rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
