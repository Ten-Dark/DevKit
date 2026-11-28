import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
}))

import { StorageManager } from './storage-manager.js'

describe('StorageManager', () => {
  let tempDir: string
  let vaultDir: string
  let storePath: string
  let manager: StorageManager

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devkit-storage-test-'))
    vaultDir = path.join(tempDir, 'vault')
    storePath = path.join(tempDir, 'workspace', 'config', 'storage-sources.json')
    await fs.mkdir(path.join(vaultDir, 'notes'), { recursive: true })
    await fs.mkdir(path.join(vaultDir, '.obsidian'), { recursive: true })
    await fs.writeFile(path.join(vaultDir, 'README.md'), '# Vault')
    await fs.writeFile(path.join(vaultDir, 'notes', 'architecture.md'), '# Architecture')
    await fs.writeFile(path.join(vaultDir, '.obsidian', 'app.json'), '{}')
    manager = new StorageManager(storePath)
    await manager.initialize()
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('connects a folder and persists only its reference', async () => {
    const result = await manager.connect(vaultDir)
    expect(result.state).toBe('connected')
    expect(result.ownership).toBe('connected')
    expect(result.capabilities).toEqual({
      list: true, search: true, metadata: true, read: false, write: false, delete: false, sync: false,
    })
    const persisted = JSON.parse(await fs.readFile(storePath, 'utf8')) as { rootPath: string }
    expect(persisted.rootPath).toBe(await fs.realpath(vaultDir))
  })

  it('rejects a selected directory reached through a symbolic-link parent', async () => {
    const linkedParent = path.join(tempDir, 'linked-parent')
    try {
      await fs.symlink(tempDir, linkedParent, 'junction')
    } catch {
      return
    }

    await expect(manager.connect(path.join(linkedParent, 'vault'))).rejects.toThrow(/symbolic link/i)
  })

  it('lists bounded directory metadata and skips hidden application data', async () => {
    await manager.connect(vaultDir)
    const listing = await manager.list('', 1)
    expect(listing.entries).toHaveLength(1)
    expect(listing.entries[0].name).toBe('notes')
    expect(listing.entries[0].kind).toBe('directory')
    expect(listing.truncated).toBe(true)
    const notes = await manager.list('notes')
    expect(notes.entries.map((entry) => entry.name)).toEqual(['architecture.md'])
    expect(notes.entries[0].sizeBytes).toBeGreaterThan(0)
  })

  it('bounds directory enumeration even when entries are hidden or irrelevant', async () => {
    await manager.connect(vaultDir)
    await Promise.all(Array.from({ length: 2_501 }, (_, index) =>
      fs.writeFile(path.join(vaultDir, '.hidden-' + String(index).padStart(4, '0')), ''),
    ))

    const listing = await manager.list('')
    expect(listing.entries).toHaveLength(0)
    expect(listing.truncated).toBe(true)

    const search = await manager.search('not-present')
    expect(search.entries).toHaveLength(0)
    expect(search.truncated).toBe(true)
  })

  it('searches names only and returns bounded metadata', async () => {
    await manager.connect(vaultDir)
    const result = await manager.search('arch')
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].id).toBe('notes/architecture.md')
    expect(result.entries[0].name).toBe('architecture.md')
  })

  it('rejects traversal and absolute paths', async () => {
    await manager.connect(vaultDir)
    await expect(manager.list('../')).rejects.toThrow(/prohibited segment/)
    await expect(manager.list(path.join(tempDir, 'outside'))).rejects.toThrow(/Absolute paths/)
    await expect(manager.getMetadata('../../outside.txt')).rejects.toThrow(/prohibited segment/)
  })

  it('does not follow a symlinked entry', async () => {
    await manager.connect(vaultDir)
    const outside = path.join(tempDir, 'outside')
    await fs.mkdir(outside)
    await fs.writeFile(path.join(outside, 'secret.txt'), 'not in the vault')
    const link = path.join(vaultDir, 'linked')
    try {
      await fs.symlink(outside, link, 'junction')
    } catch {
      return
    }
    const listing = await manager.list('')
    expect(listing.entries.some((entry) => entry.name === 'linked')).toBe(false)
    await expect(manager.list('linked')).rejects.toThrow()
  })

  it('restores the source reference on restart and disconnects without touching user files', async () => {
    await manager.connect(vaultDir)
    const restored = new StorageManager(storePath)
    expect((await restored.getStatus())?.state).toBe('connected')
    expect(await restored.disconnect()).toBe(true)
    expect(await fs.readFile(path.join(vaultDir, 'README.md'), 'utf8')).toBe('# Vault')
    expect(await restored.getStatus()).toBeNull()
  })

  it('reports an unavailable source without deleting its reference', async () => {
    await manager.connect(vaultDir)
    const canonicalVaultPath = await fs.realpath(vaultDir)
    await fs.rm(vaultDir, { recursive: true, force: true })
    const status = await manager.getStatus()
    expect(status?.state).toBe('unavailable')
    const persisted = JSON.parse(await fs.readFile(storePath, 'utf8')) as { rootPath: string }
    expect(persisted.rootPath).toBe(canonicalVaultPath)
  })
})
