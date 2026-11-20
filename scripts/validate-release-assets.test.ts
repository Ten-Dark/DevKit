import { describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { generateUpdateMetadata } from './generate-update-metadata.mjs'
import { validateReleaseAssets } from './validate-release-assets.mjs'

async function getPackageVersion(): Promise<string> {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  return pkg.version
}

describe('validateReleaseAssets', () => {
  it('accepts matching version, installer hash, size, blockmap and tag', async () => {
    const version = await getPackageVersion()
    const root = await mkdtemp(path.join(os.tmpdir(), 'devkit-release-assets-'))
    const outputDir = path.join(root, 'dist-electron')
    await mkdir(outputDir, { recursive: true })
    const installerName = 'Dev Toolbox Setup ' + version + '.exe'
    await writeFile(path.join(outputDir, installerName), Buffer.from('installer-data'))
    await writeFile(path.join(outputDir, `${installerName}.blockmap`), Buffer.from('blockmap-data'))
    try {
      await generateUpdateMetadata({ outputDir, version, releaseDate: '2026-11-19T00:00:00.000Z' })
      const metadata = await readFile(path.join(outputDir, 'latest.yml'), 'utf8')
      expect(metadata).toContain('url: "Dev.Toolbox.Setup.' + version + '.exe"')
      const result = await validateReleaseAssets({ outputDir, tagName: 'v' + version })
      expect(result.version).toBe(version)
      expect(result.installerSize).toBe(Buffer.byteLength('installer-data'))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a mismatched tag or changed installer', async () => {
    const version = await getPackageVersion()
    const root = await mkdtemp(path.join(os.tmpdir(), 'devkit-release-assets-invalid-'))
    const outputDir = path.join(root, 'dist-electron')
    await mkdir(outputDir, { recursive: true })
    const installerName = 'Dev Toolbox Setup ' + version + '.exe'
    const installerPath = path.join(outputDir, installerName)
    await writeFile(installerPath, Buffer.from('installer-data'))
    await writeFile(`${installerPath}.blockmap`, Buffer.from('blockmap-data'))
    try {
      await generateUpdateMetadata({ outputDir, version })
      await expect(validateReleaseAssets({ outputDir, tagName: 'v0.0.0' })).rejects.toThrow(/does not match/)
      await writeFile(installerPath, Buffer.from('changed-installer'))
      await expect(validateReleaseAssets({ outputDir, tagName: 'v' + version })).rejects.toThrow(/SHA-512/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
