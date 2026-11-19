import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { exec } from 'child_process'
import { promisify } from 'util'
import { fileURLToPath } from 'url'

const execAsync = promisify(exec)
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const VALIDATOR_SOURCE = path.join(REPO_ROOT, 'scripts', 'pre-dist-validate.mjs')
const PACKAGE_SOURCE = path.join(REPO_ROOT, 'package.json')

let fixtureRoot: string

describe('pre-dist validation integration (npm run dist)', () => {
  beforeEach(async () => {
    fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pre-dist-validation-'))
    await fs.mkdir(path.join(fixtureRoot, 'scripts'), { recursive: true })
    await fs.mkdir(path.join(fixtureRoot, 'node_modules', '.bin'), { recursive: true })

    await fs.copyFile(VALIDATOR_SOURCE, path.join(fixtureRoot, 'scripts', 'pre-dist-validate.mjs'))

    const sourcePackage = JSON.parse(await fs.readFile(PACKAGE_SOURCE, 'utf-8'))
    const fixturePackage = {
      name: 'pre-dist-validation-fixture',
      version: '1.0.0',
      scripts: { dist: sourcePackage.scripts.dist },
      build: sourcePackage.build,
    }
    await fs.writeFile(
      path.join(fixtureRoot, 'package.json'),
      JSON.stringify(fixturePackage, null, 2),
    )

    // This stub proves the validator stops the npm lifecycle before the builder starts.
    await fs.writeFile(
      path.join(fixtureRoot, 'node_modules', '.bin', 'electron-builder.cmd'),
      '@echo off\r\necho invoked> "%CD%\\builder-invoked.txt"\r\nexit /b 0\r\n',
    )
  })

  afterEach(async () => {
    await fs.rm(fixtureRoot, { recursive: true, force: true }).catch(() => {})
  })

  it('stops before electron-builder when required artifacts are missing', async () => {
    let exitCode = 0
    let stderr = ''

    try {
      await execAsync('npm run dist', { cwd: fixtureRoot, windowsHide: true })
    } catch (err) {
      const processError = err as { exitCode?: number; stderr?: string }
      exitCode = processError.exitCode ?? 1
      stderr = String(processError.stderr ?? '')
    }

    expect(exitCode).not.toBe(0)
    expect(stderr.toLowerCase()).toContain('missing')
    expect(stderr).toContain('dist-electron/main/main.js')
    await expect(
      fs.access(path.join(fixtureRoot, 'builder-invoked.txt')),
    ).rejects.toThrow()
  })
})
