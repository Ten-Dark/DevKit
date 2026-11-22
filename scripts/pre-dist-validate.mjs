#!/usr/bin/env node
import { pathToFileURL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

const outDir = 'dist-electron'
const UNSIGNED_PUBLISHER = 'UNSIGNED_BUILD_UPDATES_DISABLED'

function normalizePath(...segments) {
  return path.join(...segments).replace(/\\/g, '/')
}

const REQUIRED_FILES = [
  normalizePath(outDir, 'main', 'main.js'),
  normalizePath(outDir, 'preload', 'preload.cjs'),
  normalizePath(outDir, 'renderer', 'index.html'),
  normalizePath(outDir, 'main', 'native', 'windows_process_control.node'),
  normalizePath('src', 'main', 'updater', 'app-update.yml'),
]

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

function configureWindowsUpdatePublisher(projectRoot, packageJson) {
  const requireSigning = process.env.REQUIRE_WINDOWS_CODE_SIGNING === '1'
  const publisherName = requireSigning
    ? process.env.WINDOWS_PUBLISHER_NAME?.trim()
    : UNSIGNED_PUBLISHER

  if (requireSigning) {
    const certificatePath = process.env.WIN_CSC_LINK || process.env.CSC_LINK
    const certificatePassword = process.env.WIN_CSC_KEY_PASSWORD || process.env.CSC_KEY_PASSWORD
    if (!publisherName || publisherName.includes(String.fromCharCode(10)) ||
      publisherName.includes(String.fromCharCode(13)) || publisherName === UNSIGNED_PUBLISHER) {
      throw new Error('A valid WINDOWS_PUBLISHER_NAME is required for a production release.')
    }
    if (!certificatePath || !certificatePassword) {
      throw new Error('Windows code signing requires WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD.')
    }

    const resolvedCertificatePath = path.resolve(projectRoot, certificatePath)
    if (!fs.existsSync(resolvedCertificatePath) || !fs.statSync(resolvedCertificatePath).isFile()) {
      throw new Error('The configured Windows signing certificate file does not exist.')
    }
  }

  packageJson.build ??= {}
  packageJson.build.win ??= {}
  packageJson.build.win.signtoolOptions ??= {}
  packageJson.build.win.signtoolOptions.publisherName = publisherName
  fs.writeFileSync(
    path.join(projectRoot, 'package.json'),
    JSON.stringify(packageJson, null, 2) + String.fromCharCode(10),
    'utf8',
  )

  const updaterConfigPath = path.join(projectRoot, 'src', 'main', 'updater', 'app-update.yml')
  fs.mkdirSync(path.dirname(updaterConfigPath), { recursive: true })
  fs.writeFileSync(updaterConfigPath, [
    '# Updater metadata is bundled into resources/app-update.yml.',
    'provider: github',
    'owner: Ten-Dark',
    'repo: DevKit',
    'channel: latest',
    `publisherName: ${JSON.stringify(publisherName)}`,
    '',
  ].join(String.fromCharCode(10)), 'utf8')
}

function validate(projectRoot) {
  const missing = []
  let packageJson
  try {
    packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))
  } catch {
    return { valid: false, missing: [`package.json (unreadable at ${projectRoot})`] }
  }

  try {
    configureWindowsUpdatePublisher(projectRoot, packageJson)
  } catch (error) {
    return { valid: false, missing: [error instanceof Error ? error.message : String(error)] }
  }

  const buildConfig = packageJson.build || {}
  const buildFiles = buildConfig.files || []
  const updaterResourceConfigured = (buildConfig.extraResources || []).some((resource) =>
    typeof resource === 'object' &&
    resource.from === 'src/main/updater/app-update.yml' &&
    resource.to === 'app-update.yml',
  )
  if (!updaterResourceConfigured) {
    missing.push('build.extraResources must bundle src/main/updater/app-update.yml as app-update.yml')
  }
  if (!buildConfig.win?.signtoolOptions?.publisherName) {
    missing.push('build.win.signtoolOptions.publisherName must be configured for updater signature verification.')
  }
  if (!Array.isArray(buildConfig.asarUnpack) || !buildConfig.asarUnpack.includes('**/*.node')) {
    missing.push('build.asarUnpack must include **/*.node for the native process-control addon')
  }

  for (const dir of REQUIRED_DIRS) {
    if (!checkExists(projectRoot, dir, true)) missing.push(dir)
  }
  for (const file of REQUIRED_FILES) {
    if (!checkExists(projectRoot, file)) missing.push(file)
  }

  for (const globPattern of buildFiles) {
    const stripped = normalizePath(
      globPattern.replace(/\/\*\*\/\*/g, '').replace(/\/\*\*/g, ''),
    )
    const resolved = path.join(projectRoot, stripped)
    if (!fs.existsSync(resolved)) {
      missing.push(stripped)
      continue
    }
    const stat = fs.statSync(resolved)
    if (stat.isDirectory()) {
      try {
        if (fs.readdirSync(resolved).length === 0) missing.push(stripped)
      } catch {
        missing.push(stripped)
      }
    }
  }

  return { valid: missing.length === 0, missing }
}

function main() {
  const projectRoot = process.argv[2] || process.cwd()
  const result = validate(projectRoot)

  console.log(`Pre-dist artifact validation (root: ${projectRoot})`)
  for (const dir of REQUIRED_DIRS) {
    const exists = checkExists(projectRoot, dir, true)
    console.log(exists ? `  ✓ ${dir}` : `  ✗ MISSING DIRECTORY: ${dir}`)
  }
  for (const file of REQUIRED_FILES) {
    const exists = checkExists(projectRoot, file)
    console.log(exists ? `  ✓ ${file}` : `  ✗ MISSING FILE: ${file}`)
  }

  if (!result.valid) {
    console.error(`Pre-dist validation failed: ${result.missing.length} missing item(s)`)
    for (const missing of result.missing) console.error(`  - ${missing}`)
    process.exitCode = 1
    return
  }
  console.log('Pre-dist validation passed')
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) main()

export { validate }
