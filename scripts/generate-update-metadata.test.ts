import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { generateUpdateMetadata } from './generate-update-metadata.mjs'

async function getPackageVersion(): Promise<string> {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }
  return pkg.version
}

describe('generateUpdateMetadata', () => {
  it('writes electron-updater metadata for the exact installer and blockmap', async () => {
    const version = await getPackageVersion()
    const root = await mkdtemp(path.join(os.tmpdir(), 'devkit-update-metadata-'))
    const outputDir = path.join(root, 'dist-electron')
    await mkdir(outputDir, { recursive: true })
    const installerName = 'Dev Toolbox Setup ' + version + '.exe'
    const releaseAssetName = installerName.replace(/ /g, '.')
    const installer = Buffer.from('fixture-installer-binary')
    const blockmap = Buffer.from('fixture-blockmap')
    await writeFile(path.join(outputDir, installerName), installer)
    await writeFile(path.join(outputDir, `${installerName}.blockmap`), blockmap)
    try {
      const result = await generateUpdateMetadata({
        outputDir,
        version,
        releaseDate: '2026-11-19T00:00:00.000Z',
      })
      const expectedHash = createHash('sha512').update(installer).digest('base64')
      const yaml = await readFile(path.join(outputDir, 'latest.yml'), 'utf8')
      expect(result.sha512).toBe(expectedHash)
      expect(yaml).toContain('version: ' + JSON.stringify(version))
      expect(yaml).toContain(`url: "${releaseAssetName}"`)
      expect(yaml).toContain(`path: "${releaseAssetName}"`)
      expect(yaml).toContain(`sha512: "${expectedHash}"`)
      expect(yaml).toContain(`size: ${installer.byteLength}`)
      expect(yaml).toContain(`blockMapSize: ${blockmap.byteLength}`)
      expect(yaml).toContain('releaseDate: "2026-11-19T00:00:00.000Z"')
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('refuses to generate metadata when the installer or blockmap is absent', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'devkit-update-metadata-missing-'))
    try {
      await expect(generateUpdateMetadata({ outputDir: root, version: await getPackageVersion() })).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects a version that differs from package.json', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'devkit-update-metadata-version-'))
    try {
      await expect(generateUpdateMetadata({ outputDir: root, version: '9.9.9' })).rejects.toThrow(/does not match package.json/)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
