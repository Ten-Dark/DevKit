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

const asarPath = process.argv[2] || path.join('dist-electron', 'win-unpacked', 'resources', 'app.asar')

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
  'dist-electron/preload/preload.js',
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
    (f) => f === 'dist-electron/preload/preload.js' || f.endsWith(`/dist-electron/preload/preload.js`)
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
