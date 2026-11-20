#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_OUTPUT_DIR = 'dist-electron'
const DEFAULT_PRODUCT_NAME = 'Dev Toolbox'

async function sha512Base64(filePath) {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('base64')
}

function yamlString(value) {
  return JSON.stringify(String(value))
}

export async function generateUpdateMetadata({
  outputDir = DEFAULT_OUTPUT_DIR,
  version,
  productName = DEFAULT_PRODUCT_NAME,
  releaseDate = new Date().toISOString(),
} = {}) {
  const packagePath = path.resolve('package.json')
  const packageJson = JSON.parse(await readFile(packagePath, 'utf8'))
  const releaseVersion = version ?? packageJson.version
  if (typeof releaseVersion !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(releaseVersion)) {
    throw new Error(`Invalid release version: ${String(releaseVersion)}`)
  }
  if (releaseVersion !== packageJson.version) {
    throw new Error(`Requested metadata version ${releaseVersion} does not match package.json version ${packageJson.version}.`)
  }

  const outputRoot = path.resolve(outputDir)
  const installerName = `${productName} Setup ${releaseVersion}.exe`
  const installerPath = path.join(outputRoot, installerName)
  const blockMapPath = `${installerPath}.blockmap`
  const [installerStat, blockMapStat] = await Promise.all([stat(installerPath), stat(blockMapPath)])
  if (!installerStat.isFile() || installerStat.size <= 0) {
    throw new Error(`NSIS installer is missing or empty: ${installerPath}`)
  }
  if (!blockMapStat.isFile() || blockMapStat.size <= 0) {
    throw new Error(`NSIS blockmap is missing or empty: ${blockMapPath}`)
  }

  const sha512 = await sha512Base64(installerPath)
  const safeReleaseDate = new Date(releaseDate)
  if (Number.isNaN(safeReleaseDate.getTime())) throw new Error('Invalid release date.')
  const normalizedReleaseDate = safeReleaseDate.toISOString()
  const yaml = [
    `version: ${yamlString(releaseVersion)}`,
    'files:',
    `  - url: ${yamlString(installerName)}`,
    `    sha512: ${yamlString(sha512)}`,
    `    size: ${installerStat.size}`,
    `    blockMapSize: ${blockMapStat.size}`,
    `path: ${yamlString(installerName)}`,
    `sha512: ${yamlString(sha512)}`,
    `releaseDate: ${yamlString(normalizedReleaseDate)}`,
    '',
  ].join('\n')

  const metadataPath = path.join(outputRoot, 'latest.yml')
  const temporaryPath = `${metadataPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, yaml, { encoding: 'utf8', flag: 'wx' })
    await rename(temporaryPath, metadataPath)
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined)
    throw error
  }

  return {
    metadataPath,
    version: releaseVersion,
    installerPath,
    blockMapPath,
    installerSize: installerStat.size,
    blockMapSize: blockMapStat.size,
    sha512,
    releaseDate: normalizedReleaseDate,
  }
}

async function main() {
  const outputDir = process.argv[2] || DEFAULT_OUTPUT_DIR
  const result = await generateUpdateMetadata({ outputDir })
  console.log(`Generated ${result.metadataPath}`)
  console.log(`Version: ${result.version}`)
  console.log(`Installer: ${result.installerSize} bytes`)
  console.log(`Blockmap: ${result.blockMapSize} bytes`)
  console.log(`SHA-512: ${result.sha512}`)
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
