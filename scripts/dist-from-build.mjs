#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packagePath = path.join(projectRoot, 'package.json')
const updaterConfigPath = path.join(projectRoot, 'src', 'main', 'updater', 'app-update.yml')
const electronBuilderCli = path.join(projectRoot, 'node_modules', 'electron-builder', 'cli.js')
const originalPackage = await readFile(packagePath)
const originalUpdaterConfig = await readFile(updaterConfigPath).catch(() => null)

function runNodeScript(scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const error = new Error(`Command failed: ${path.basename(scriptPath)} (exit ${result.status ?? result.signal})`)
    error.exitCode = result.status ?? 1
    throw error
  }
}

try {
  runNodeScript(path.join(projectRoot, 'scripts', 'pre-dist-validate.mjs'))
  runNodeScript(electronBuilderCli, ['--publish', 'never'])
  runNodeScript(path.join(projectRoot, 'scripts', 'generate-update-metadata.mjs'))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = typeof error === 'object' && error !== null && 'exitCode' in error
    ? Number(error.exitCode) || 1
    : 1
} finally {
  await writeFile(packagePath, originalPackage)
  if (originalUpdaterConfig) await writeFile(updaterConfigPath, originalUpdaterConfig)
  else await rm(updaterConfigPath, { force: true })
}
