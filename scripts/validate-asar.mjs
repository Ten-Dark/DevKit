#!/usr/bin/env node
/**
 * ASAR Validation Script
 * Validates that app.asar contains all required runtime modules
 * and that local imports can resolve within the package.
 *
 * Usage: node scripts/validate-asar.mjs [path/to/app.asar]
 */

import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'

const require = createRequire(import.meta.url)
const asar = require('@electron/asar')

const distDirectory = process.env.DEVKIT_DIST_DIR || 'dist-electron'
const asarPath = process.argv[2] || path.join(distDirectory, 'win-unpacked', 'resources', 'app.asar')

// Required files that must exist in app.asar (forward-slash paths)
const REQUIRED_FILES = [
  'dist-electron/main/main.js',
  'dist-electron/main/window.js',
  'dist-electron/main/settings.js',
  'dist-electron/main/security.js',
  'dist-electron/main/xmind.js',
  'dist-electron/main/project-markdown.js',
  'dist-electron/main/updater/updater.js',
  'dist-electron/main/updater/index.js',
  'dist-electron/main/updater/updater.types.js',
  'dist-electron/main/ipc-registry.js',
  'dist-electron/main/ipc-security.js',
  'dist-electron/preload/preload.cjs',
  'node_modules/yauzl/index.js',
  'node_modules/pend/index.js',
  'dist-electron/shared/types.js',
  'dist-electron/shared/utils/ignore.js',
  'dist-electron/shared/utils/markdown.js',
  'dist-electron/shared/utils/xmind.js',
  'dist-electron/renderer/index.html',
  'dist-electron/renderer/index.js',
]

// Normalize an ASAR path: strip leading backslash, convert backslashes to forward slashes
function normalizeAsarPath(asarPathEntry) {
  return asarPathEntry.replace(/^\\/, '').replace(/\\/g, '/')
}

function validateUpdaterConfig(resourcesDirectory) {
  const configPath = path.join(resourcesDirectory, 'app-update.yml')
  if (!fs.existsSync(configPath)) {
    console.error(`❌ ERROR: updater configuration not found at ${configPath}`)
    return false
  }

  let configText
  let packageJson
  try {
    configText = fs.readFileSync(configPath, 'utf8')
    packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'))
  } catch (error) {
    console.error(`❌ ERROR: updater configuration could not be read: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }

  const values = Object.fromEntries(
    configText.split(/\r?\n/).flatMap((line) => {
      const match = line.match(/^([A-Za-z][\w-]*):\s*(.*?)\s*$/)
      return match ? [[match[1], match[2].replace(/^['"]|['"]$/g, '')]] : []
    }),
  )
  const publish = Array.isArray(packageJson.build?.publish)
    ? packageJson.build.publish[0]
    : packageJson.build?.publish
  const expected = {
    provider: publish?.provider,
    owner: publish?.owner,
    repo: publish?.repo,
    channel: publish?.channel ?? 'latest',
  }
  for (const [key, value] of Object.entries(expected)) {
    if (key === 'channel' && value === 'latest' && values[key] === undefined) continue
    if (typeof value !== 'string' || values[key] !== value) {
      console.error(`❌ ERROR: updater configuration ${key} mismatch (expected ${String(value)}, got ${String(values[key])})`)
      return false
    }
  }
  console.log('✓ Packaged updater configuration matches package.json publish settings')
  return true
}

function main() {
  let exitCode = 0

  // Check ASAR file exists
  if (!fs.existsSync(asarPath)) {
    console.error(`❌ ERROR: app.asar not found at ${asarPath}`)
    console.error('   Run "npm run dist" to build the production package first.')
    process.exit(1)
  }

  console.log(`✓ app.asar found at ${asarPath}`)

  let fileList
  try {
    fileList = asar.listPackage(asarPath)
  } catch (err) {
    console.error(`❌ ERROR: Failed to parse app.asar: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }

  // Normalize all paths: strip leading backslash, convert \ to /
  const normalizedFileNames = fileList.map((f) => normalizeAsarPath(f))
  console.log(`✓ app.asar contains ${normalizedFileNames.length} files`)

  // Check required files
  const missing = []
  for (const required of REQUIRED_FILES) {
    const found = normalizedFileNames.some((f) => f === required || f.endsWith(`/${required}`))
    if (found) {
      console.log(`  ✓ ${required}`)
    } else {
      console.log(`  ✗ MISSING: ${required}`)
      missing.push(required)
      exitCode = 1
    }
  }

  if (missing.length > 0) {
    console.error(`\n❌ ${missing.length} required file(s) missing from app.asar`)
    exitCode = 1
  } else {
    console.log(`\n✓ All ${REQUIRED_FILES.length} required files present in app.asar`)
  }

  // electron-updater reads app-update.yml from resources, outside app.asar.
  if (!validateUpdaterConfig(path.dirname(asarPath))) {
    exitCode = 1
  }

  // Native Node-API modules must be unpacked from ASAR and loadable by Electron.
  const nativeAddonPath = path.join(
    path.dirname(asarPath),
    'app.asar.unpacked',
    'dist-electron',
    'main',
    'native',
    'windows_process_control.node',
  )
  if (!fs.existsSync(nativeAddonPath) || !fs.statSync(nativeAddonPath).isFile()) {
    console.error(`❌ ERROR: Native Windows process-control addon missing from ASAR unpacked resources: ${nativeAddonPath}`)
    exitCode = 1
  } else {
    console.log('✓ Native Windows process-control addon present in ASAR unpacked resources')
  }

  // Check that app.asar is not empty
  if (normalizedFileNames.length === 0) {
    console.error('❌ ERROR: app.asar appears to be empty')
    exitCode = 1
  }

  // Check for main entry point
  const hasMainEntry = normalizedFileNames.some(
    (f) => f === 'dist-electron/main/main.js' || f.endsWith(`/dist-electron/main/main.js`)
  )
  if (!hasMainEntry) {
    console.error('❌ ERROR: Main entry point (main.js) not found in app.asar')
    exitCode = 1
  } else {
    console.log('✓ Main entry point present')
  }

  // Check for preload
  const hasPreload = normalizedFileNames.some(
    (f) => f === 'dist-electron/preload/preload.cjs' || f.endsWith(`/dist-electron/preload/preload.cjs`)
  )
  if (!hasPreload) {
    console.error('❌ ERROR: Preload not found in app.asar')
    exitCode = 1
  } else {
    console.log('✓ Preload present')
  }

  // Check for renderer
  const hasRenderer = normalizedFileNames.some((f) => f.startsWith('dist-electron/renderer/'))
  if (!hasRenderer) {
    console.error('❌ ERROR: Renderer files not found in app.asar')
    exitCode = 1
  } else {
    console.log('✓ Renderer files present')
  }

  // Check for updater
  const hasUpdater = normalizedFileNames.some((f) => f.startsWith('dist-electron/main/updater/'))
  if (!hasUpdater) {
    console.error('❌ ERROR: Updater modules not found in app.asar')
    exitCode = 1
  } else {
    console.log('✓ Updater modules present')
  }

  if (exitCode === 0) {
    console.log('\n✅ ASAR validation passed')
  } else {
    console.log('\n❌ ASAR validation failed')
  }

  process.exit(exitCode)
}

main()
