#!/usr/bin/env node
/**
 * Pre-dist Artifact Validation Script
 * Verifies that all required compiled application files exist
 * before electron-builder is invoked.
 *
 * Usage: node scripts/pre-dist-validate.mjs [projectRoot]
 */

import { pathToFileURL } from 'url'
import fs from 'fs'
import path from 'path'

const outDir = 'dist-electron'

// Normalize paths to forward slashes for cross-platform determinism.
function normalizePath(...segments) {
  return path.join(...segments).replace(/\\/g, '/')
}

// Critical runtime entrypoints derived from source configuration.
const REQUIRED_FILES = [
  normalizePath(outDir, 'main', 'main.js'),
  normalizePath(outDir, 'preload', 'preload.cjs'),
  normalizePath(outDir, 'renderer', 'index.html'),
  normalizePath(outDir, 'main', 'native', 'windows_process_control.node'),
  normalizePath('src', 'main', 'updater', 'app-update.yml'),
]

// Required directories that must contain compiled output.
const REQUIRED_DIRS = [
  outDir,
  normalizePath(outDir, 'main'),
  normalizePath(outDir, 'preload'),
  normalizePath(outDir, 'renderer'),
  normalizePath(outDir, 'shared'),
]

function checkExists(projectRoot, relativePath, isDir = false) {
  const fullPath = path.join(projectRoot, relativePath)
  if (!fs.existsSync(fullPath)) return false
  const stat = fs.statSync(fullPath)
  return isDir ? stat.isDirectory() : stat.isFile()
}

function configureWindowsUpdatePublisher(projectRoot) {
  if (process.env.REQUIRE_WINDOWS_CODE_SIGNING !== '1') return

  const publisherName = process.env.WINDOWS_PUBLISHER_NAME?.trim()
  const certificatePath = process.env.WIN_CSC_LINK || process.env.CSC_LINK
  const certificatePassword = process.env.WIN_CSC_KEY_PASSWORD || process.env.CSC_KEY_PASSWORD
  if (!publisherName || publisherName.includes(String.fromCharCode(10)) || publisherName.includes(String.fromCharCode(13)) || publisherName === 'UNSIGNED_BUILD_UPDATES_DISABLED') {
    throw new Error('A valid WINDOWS_PUBLISHER_NAME is required for a production release.')
  }
  if (!certificatePath || !certificatePassword) {
    throw new Error('Windows code signing requires WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD.')
  }

  const resolvedCertificatePath = path.resolve(projectRoot, certificatePath)
  if (!fs.existsSync(resolvedCertificatePath) || !fs.statSync(resolvedCertificatePath).isFile()) {
    throw new Error('The configured Windows signing certificate file does not exist.')
  }

  const updateConfigPath = path.join(projectRoot, 'src', 'main', 'updater', 'app-update.yml')
  const updateConfig = fs.readFileSync(updateConfigPath, 'utf8')
  const publisherLine = `publisherName: ${JSON.stringify(publisherName)}`
  const updatedConfig = /^publisherName:.*$/m.test(updateConfig)
    ? updateConfig.replace(/^publisherName:.*$/m, publisherLine)
    : `${updateConfig.trimEnd()}${String.fromCharCode(10)}${publisherLine}${String.fromCharCode(10)}`
  fs.writeFileSync(updateConfigPath, updatedConfig)
}

function validate(projectRoot) {
  let exitCode = 0
  const missing = []

  let packageJson
  try {
    packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
  } catch {
    return {
      valid: false,
      missing: [`package.json (unreadable at ${projectRoot})`],
    }
  }

  configureWindowsUpdatePublisher(projectRoot)

  const buildConfig = packageJson.build || {}
  const buildFiles = buildConfig.files || []
  const updaterResourceConfigured = (buildConfig.extraResources || []).some((resource) =>
    typeof resource === 'object' &&
    resource.from === 'src/main/updater/app-update.yml' &&
    resource.to === 'app-update.yml',
  )
  if (!updaterResourceConfigured) {
    missing.push('build.extraResources must copy src/main/updater/app-update.yml to app-update.yml')
    exitCode = 1
  }

  const nativeAddonUnpackConfigured = Array.isArray(buildConfig.asarUnpack) &&
    buildConfig.asarUnpack.includes('**/*.node')
  if (!nativeAddonUnpackConfigured) {
    missing.push('build.asarUnpack must include **/*.node for the native process-control addon')
    exitCode = 1
  }

  for (const dir of REQUIRED_DIRS) {
    if (!checkExists(projectRoot, dir, true)) {
      missing.push(dir)
      exitCode = 1
    }
  }

  for (const file of REQUIRED_FILES) {
    if (!checkExists(projectRoot, file)) {
      missing.push(file)
      exitCode = 1
    }
  }

  for (const globPattern of buildFiles) {
    const stripped = normalizePath(
      globPattern.replace(/\/\*\/\*/, '').replace(/\/\*\*\/\*/, ''),
    )
    const resolved = path.join(projectRoot, stripped)
    if (!fs.existsSync(resolved)) {
      missing.push(stripped)
      exitCode = 1
      continue
    }
    const stat = fs.statSync(resolved)
    if (stat.isDirectory()) {
      try {
        if (fs.readdirSync(resolved).length === 0) {
          missing.push(stripped)
          exitCode = 1
        }
      } catch {
        missing.push(stripped)
        exitCode = 1
      }
    }
  }

  return { valid: exitCode === 0, missing }
}

function main() {
  const projectRoot = process.argv[2] || process.cwd()
  const result = validate(projectRoot)

  console.log(`🔍 Pre-dist artifact validation (root: ${projectRoot})`)
  for (const dir of REQUIRED_DIRS) {
    const fullPath = path.join(projectRoot, dir)
    const exists = fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()
    console.log(exists ? `  ✓ ${dir}` : `  ✗ MISSING DIRECTORY: ${dir}`)
  }
  for (const file of REQUIRED_FILES) {
    const fullPath = path.join(projectRoot, file)
    const exists = fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()
    console.log(exists ? `  ✓ ${file}` : `  ✗ MISSING FILE: ${file}`)
  }

  if (result.missing.length > 0) {
    console.error(`\n❌ Pre-dist validation failed: ${result.missing.length} missing item(s)`)
    for (const missing of result.missing) console.error(`   - ${missing}`)
    console.error('   Run "npm run build" to generate required artifacts before "npm run dist".')
    process.exit(1)
  }

  console.log('\n✅ Pre-dist validation passed')
  process.exit(0)
}

if (pathToFileURL(process.argv[1] || '').href === import.meta.url) {
  main()
}

export { validate }
