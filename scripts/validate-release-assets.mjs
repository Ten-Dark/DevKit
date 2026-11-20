#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

async function sha512Base64(filePath) {
  const hash = createHash('sha512')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('base64')
}

function readYamlScalar(lines, key) {
  const line = lines.find((entry) => new RegExp(`^${key}:\\s*`).test(entry))
  if (!line) return undefined
  const raw = line.replace(new RegExp(`^${key}:\\s*`), '').trim()
  if (raw.startsWith('"')) return JSON.parse(raw)
  if (raw.startsWith("'")) return raw.slice(1, raw.lastIndexOf("'"))
  return raw
}

function parseFileEntry(lines) {
  const start = lines.findIndex((line) => /^\s*-\s+url:\s*/.test(line))
  if (start < 0) throw new Error('latest.yml does not contain a files entry.')
  const result = {}
  const first = lines[start].match(/^\s*-\s+url:\s*(.*)$/)
  if (first) result.url = first[1].trim().startsWith('"') ? JSON.parse(first[1].trim()) : first[1].trim()
  for (let index = start + 1; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s{4}([A-Za-z][\w]*):\s*(.*?)\s*$/)
    if (!match) break
    const raw = match[2]
    result[match[1]] = /^\d+$/.test(raw) ? Number(raw) : raw.startsWith('"') ? JSON.parse(raw) : raw
  }
  return result
}

export async function validateReleaseAssets({
  outputDir = 'dist-electron',
  tagName = process.env.GITHUB_REF_NAME,
} = {}) {
  const packageJson = JSON.parse(await readFile(path.resolve('package.json'), 'utf8'))
  const packageLock = JSON.parse(await readFile(path.resolve('package-lock.json'), 'utf8'))
  const version = packageJson.version
  if (packageLock.version !== version || packageLock.packages?.['']?.version !== version) {
    throw new Error('package-lock.json version does not match package.json.')
  }
  if (typeof tagName !== 'string' || !tagName.startsWith('v') || tagName.slice(1) !== version) {
    throw new Error(`Release tag ${String(tagName)} does not match package version ${version}.`)
  }

  const outputRoot = path.resolve(outputDir)
  const installerName = `Dev Toolbox Setup ${version}.exe`
  const releaseAssetName = installerName.replace(/ /g, '.')
  const installerPath = path.join(outputRoot, installerName)
  const blockMapPath = `${installerPath}.blockmap`
  const metadataPath = path.join(outputRoot, 'latest.yml')
  const [installerStat, blockMapStat] = await Promise.all([stat(installerPath), stat(blockMapPath)])
  if (!installerStat.isFile() || installerStat.size <= 0) throw new Error(`Installer missing or empty: ${installerPath}`)
  if (!blockMapStat.isFile() || blockMapStat.size <= 0) throw new Error(`Blockmap missing or empty: ${blockMapPath}`)

  const yaml = await readFile(metadataPath, 'utf8')
  const lines = yaml.split(/\r?\n/)
  const metadataVersion = readYamlScalar(lines, 'version')
  const metadataPathValue = readYamlScalar(lines, 'path')
  const metadataHash = readYamlScalar(lines, 'sha512')
  const releaseDate = readYamlScalar(lines, 'releaseDate')
  const file = parseFileEntry(lines)
  const expectedHash = await sha512Base64(installerPath)
  if (metadataVersion !== version) throw new Error(`latest.yml version mismatch: expected ${version}, got ${String(metadataVersion)}.`)
  if (metadataPathValue !== releaseAssetName || file.url !== releaseAssetName) throw new Error('latest.yml installer URL does not match the normalized GitHub release asset filename.')
  if (metadataHash !== expectedHash || file.sha512 !== expectedHash) throw new Error('latest.yml SHA-512 does not match the NSIS installer.')
  if (Number(file.size) !== installerStat.size) throw new Error('latest.yml installer size does not match the NSIS installer.')
  if (Number(file.blockMapSize) !== blockMapStat.size) throw new Error('latest.yml blockMapSize does not match the NSIS blockmap.')
  if (typeof releaseDate !== 'string' || Number.isNaN(Date.parse(releaseDate))) throw new Error('latest.yml releaseDate is missing or invalid.')

  return { version, installerPath, blockMapPath, metadataPath, installerSize: installerStat.size, blockMapSize: blockMapStat.size, sha512: expectedHash }
}

async function main() {
  const result = await validateReleaseAssets({ outputDir: process.argv[2] || 'dist-electron' })
  console.log(`Release assets validated for ${result.version}`)
  console.log(`Installer: ${result.installerPath} (${result.installerSize} bytes)`)
  console.log(`Blockmap: ${result.blockMapPath} (${result.blockMapSize} bytes)`)
  console.log(`Updater metadata: ${result.metadataPath}`)
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}
