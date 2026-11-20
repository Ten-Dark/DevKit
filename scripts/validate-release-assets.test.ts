import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { generateUpdateMetadata } from './generate-update-metadata.mjs'
import { validateReleaseAssets } from './validate-release-assets.mjs'

describe('validateReleaseAssets', () => {
  it('accepts matching version, installer hash, size, blockmap and tag', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'devkit-release-assets-'))
    const outputDir = path.join(root, 'dist-electron')
    await mkdir(outputDir, { recursive: true })
    const installerName = 'Dev Toolbox Setup 1.0.1.exe'
    await writeFile(path.join(outputDir, installerName), Buffer.from('installer-data'))
    await writeFile(path.join(outputDir, `${installerName}.blockmap`), Buffer.from('blockmap-data'))
    try {
      await generateUpdateMetadata({ outputDir, version: '1.0.1', releaseDate: '2026-11-19T00:00:00.000Z' })
      const result = await validateReleaseAssets({ outputDir, tagName: 'v1.0.1' })
      expect(result.version).toBe('1.0.1')
      expect(result.installerSize).toBe(Buffer.byteLength('installer-data'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a mismatched tag or changed installer', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'devkit-release-assets-invalid-'))
    const outputDir = path.join(root, 'dist-electron')
    await mkdir(outputDir, { recursive: true })
    const installerName = 'Dev Toolbox Setup 1.0.1.exe'
    const installerPath = path.join(outputDir, installerName)
    await writeFile(installerPath, Buffer.from('installer-data'))
    await writeFile(`${installerPath}.blockmap`, Buffer.from('blockmap-data'))
    try {
      await generateUpdateMetadata({ outputDir, version: '1.0.1' })
      await expect(validateReleaseAssets({ outputDir, tagName: 'v1.0.2' })).rejects.toThrow(/does not match/)
      await writeFile(installerPath, Buffer.from('changed-installer'))
      await expect(validateReleaseAssets({ outputDir, tagName: 'v1.0.1' })).rejects.toThrow(/SHA-512/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
