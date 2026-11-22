#!/usr/bin/env node
/**
 * Validate packaged ASAR contents, updater configuration, and native resources.
 */

import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)
const asar = require('@electron/asar')
const distDirectory = process.env.DEVKIT_DIST_DIR || 'dist-electron'
const asarPath = process.argv[2] || path.join(distDirectory, 'win-unpacked', 'resources', 'app.asar')

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

function normalizeAsarPath(entry) {
  const normalized = entry.split(String.fromCharCode(92)).join('/')
  return normalized.startsWith('/') ? normalized.slice(1) : normalized
}

function unquote(value) {
  const trimmed = value.trim()
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

function validateUpdaterConfig(resourcesDirectory) {
  const configPath = path.join(resourcesDirectory, 'app-update.yml')
  if (!fs.existsSync(configPath)) {
    console.error(`Updater configuration not found: ${configPath}`)
    return false
  }

  let configText
  let packageJson
  try {
    configText = fs.readFileSync(configPath, 'utf8')
    packageJson = JSON.parse(fs.readFileSync(path.resolve('package.json'), 'utf8'))
  } catch (error) {
    console.error(`Updater configuration could not be read: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }

  const lines = configText.split(String.fromCharCode(10))
  const values = {}
  let publisherNames = []
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim()
    const separator = line.indexOf(':')
    if (separator <= 0) continue
    const key = line.slice(0, separator).trim()
    const raw = line.slice(separator + 1).trim()
    if (key !== 'publisherName') {
      values[key] = unquote(raw)
      continue
    }

    if (raw) {
      publisherNames = [unquote(raw)]
      continue
    }

    for (let next = index + 1; next < lines.length; next += 1) {
      const item = lines[next].trim()
      if (!item) continue
      if (!item.startsWith('- ')) break
      publisherNames.push(unquote(item.slice(2)))
    }
  }

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
      console.error(`Updater configuration ${key} mismatch (expected ${String(value)}, got ${String(values[key])})`)
      return false
    }
  }

  const signingRequired = process.env.REQUIRE_WINDOWS_CODE_SIGNING === '1'
  const expectedPublisher = process.env.REQUIRE_WINDOWS_CODE_SIGNING === '1'
    ? process.env.WINDOWS_PUBLISHER_NAME?.trim()
    : undefined
  if (signingRequired && (!expectedPublisher || publisherNames.length !== 1 || publisherNames[0] !== expectedPublisher)) {
    console.error(`Updater publisher mismatch (expected ${String(expectedPublisher)}, got ${publisherNames.join(', ') || 'missing'})`)
    return false
  }

  if (!signingRequired && publisherNames.length !== 0) {
    console.error(`Unsigned updater config must omit publisherName, got ${publisherNames.join(', ')}`)
    return false
  }
  console.log(signingRequired
    ? `✓ Updater publisher verified: ${publisherNames[0]}`
    : '✓ Unsigned updater enabled; electron-updater verifies the published SHA-512 checksum')
  return true
}

function main() {
  let exitCode = 0
  if (!fs.existsSync(asarPath)) {
    console.error(`app.asar not found: ${asarPath}`)
    process.exit(1)
  }

  console.log(`✓ app.asar found at ${asarPath}`)
  let fileList
  try {
    fileList = asar.listPackage(asarPath)
  } catch (error) {
    console.error(`Failed to parse app.asar: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }

  const normalizedFileNames = fileList.map(normalizeAsarPath)
  console.log(`✓ app.asar contains ${normalizedFileNames.length} files`)
  const missing = []
  for (const required of REQUIRED_FILES) {
    const found = normalizedFileNames.some((entry) => entry === required || entry.endsWith(`/${required}`))
    if (found) console.log(`  ✓ ${required}`)
    else {
      console.log(`  ✗ MISSING: ${required}`)
      missing.push(required)
      exitCode = 1
    }
  }
  if (missing.length > 0) console.error(`${missing.length} required file(s) missing from app.asar`)
  else console.log(`✓ All ${REQUIRED_FILES.length} required files present in app.asar`)

  if (!validateUpdaterConfig(path.dirname(asarPath))) exitCode = 1

  const nativeAddonPath = path.join(
    path.dirname(asarPath),
    'app.asar.unpacked',
    'dist-electron',
    'main',
    'native',
    'windows_process_control.node',
  )
  if (!fs.existsSync(nativeAddonPath) || !fs.statSync(nativeAddonPath).isFile()) {
    console.error(`Native Windows process-control addon missing from ASAR unpacked resources: ${nativeAddonPath}`)
    exitCode = 1
  } else console.log('✓ Native Windows process-control addon present in ASAR unpacked resources')

  if (normalizedFileNames.length === 0) {
    console.error('app.asar appears to be empty')
    exitCode = 1
  }
  const hasMainEntry = normalizedFileNames.some(
    (entry) => entry === 'dist-electron/main/main.js' || entry.endsWith('/dist-electron/main/main.js'),
  )
  if (!hasMainEntry) {
    console.error('Main entry point not found in app.asar')
    exitCode = 1
  } else console.log('✓ Main entry point present')

  const hasPreload = normalizedFileNames.some(
    (entry) => entry === 'dist-electron/preload/preload.cjs' || entry.endsWith('/dist-electron/preload/preload.cjs'),
  )
  if (!hasPreload) {
    console.error('Preload not found in app.asar')
    exitCode = 1
  } else console.log('✓ Preload present')

  if (!normalizedFileNames.some((entry) => entry.startsWith('dist-electron/renderer/'))) {
    console.error('Renderer files not found in app.asar')
    exitCode = 1
  } else console.log('✓ Renderer files present')

  if (!normalizedFileNames.some((entry) => entry.startsWith('dist-electron/main/updater/'))) {
    console.error('Updater modules not found in app.asar')
    exitCode = 1
  } else console.log('✓ Updater modules present')

  console.log(exitCode === 0 ? 'ASAR validation passed' : 'ASAR validation failed')
  process.exit(exitCode)
}

main()
