import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { bootstrapWorkspace, ensureSafeDirectory, WORKSPACE_MANIFEST_FILE_NAME, WORKSPACE_SCHEMA_VERSION } from './workspace.js'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(),
    getVersion: vi.fn(() => '1.0.0'),
  },
}))

let tempDir: string

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devkit-workspace-'))
})

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true })
})

describe('workspace bootstrap', () => {
  it('creates a workspace root and ownership manifest', async () => {
    const result = await bootstrapWorkspace({ userDataPath: tempDir, appVersion: '2.0.0' })

    expect(result.paths.root).toBe(path.join(await fs.realpath(tempDir), 'workspace'))
    expect(result.manifest).toMatchObject({
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      owner: 'devkit',
      appVersion: '2.0.0',
    })
    expect(JSON.parse(await fs.readFile(result.paths.manifest, 'utf8'))).toEqual(result.manifest)
    expect(await fs.readdir(result.paths.root)).toEqual([WORKSPACE_MANIFEST_FILE_NAME])
  })

  it('reuses a valid manifest without changing its identity or creation time', async () => {
    const first = await bootstrapWorkspace({ userDataPath: tempDir })
    const second = await bootstrapWorkspace({ userDataPath: tempDir })

    expect(second.manifest.id).toBe(first.manifest.id)
    expect(second.manifest.createdAt).toBe(first.manifest.createdAt)
  })

  it('fails closed when an existing manifest is malformed', async () => {
    const root = path.join(tempDir, 'workspace')
    await fs.mkdir(root)
    const manifestPath = path.join(root, WORKSPACE_MANIFEST_FILE_NAME)
    await fs.writeFile(manifestPath, '{broken')

    await expect(bootstrapWorkspace({ userDataPath: tempDir })).rejects.toThrow()
    expect(await fs.readFile(manifestPath, 'utf8')).toBe('{broken')
  })

  it('rejects an unsupported manifest schema without replacing it', async () => {
    const root = path.join(tempDir, 'workspace')
    await fs.mkdir(root)
    const manifestPath = path.join(root, WORKSPACE_MANIFEST_FILE_NAME)
    const unsupported = {
      id: 'd4d5e9d0-89aa-4c10-83d5-97f2a8c98d30',
      schemaVersion: WORKSPACE_SCHEMA_VERSION + 1,
      owner: 'devkit',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      appVersion: '1.0.0',
    }
    await fs.writeFile(manifestPath, JSON.stringify(unsupported))

    await expect(bootstrapWorkspace({ userDataPath: tempDir })).rejects.toThrow(/unsupported schema/)
    expect(JSON.parse(await fs.readFile(manifestPath, 'utf8'))).toEqual(unsupported)
  })

  it('creates nested managed directories without following symbolic links', async () => {
    const nested = path.join(tempDir, 'workspace', 'registry')
    await ensureSafeDirectory(nested)
    expect((await fs.stat(nested)).isDirectory()).toBe(true)

    const external = path.join(tempDir, 'external')
    await fs.mkdir(external)
    const linkedParent = path.join(tempDir, 'workspace', 'linked')
    await fs.symlink(external, linkedParent, 'junction')
    await expect(ensureSafeDirectory(path.join(linkedParent, 'child'))).rejects.toThrow(/symbolic link/)
    await expect(fs.access(path.join(external, 'child'))).rejects.toThrow()
  })

  it('rejects a workspace root that is a symbolic link', async () => {
    const target = path.join(tempDir, 'external')
    await fs.mkdir(target)
    await fs.symlink(target, path.join(tempDir, 'workspace'), 'junction')

    await expect(bootstrapWorkspace({ userDataPath: tempDir })).rejects.toThrow(/symbolic link/)
  })

  it('rejects a manifest symbolic link', async () => {
    const root = path.join(tempDir, 'workspace')
    const externalManifest = path.join(tempDir, 'external.json')
    await fs.mkdir(root)
    await fs.writeFile(externalManifest, JSON.stringify({
      id: 'd4d5e9d0-89aa-4c10-83d5-97f2a8c98d30',
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      owner: 'devkit',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      appVersion: '1.0.0',
    }))
    await fs.symlink(externalManifest, path.join(root, WORKSPACE_MANIFEST_FILE_NAME), 'file')

    await expect(bootstrapWorkspace({ userDataPath: tempDir })).rejects.toThrow(/regular file/)
  })
})
