import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  dialog: { showOpenDialog: vi.fn() },
}))

import { ObsidianVaultStorageProvider } from './storage-manager.js'

describe('ObsidianVaultStorageProvider', () => {
  let tempDir: string
  let vaultDir: string
  let storePath: string
  let provider: ObsidianVaultStorageProvider

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devkit-obsidian-test-'))
    vaultDir = path.join(tempDir, 'vault')
    storePath = path.join(tempDir, 'workspace', 'config', 'storage-sources.json')
    await fs.mkdir(path.join(vaultDir, '.obsidian'), { recursive: true })
    await fs.mkdir(path.join(vaultDir, 'notes'), { recursive: true })
    await fs.writeFile(path.join(vaultDir, 'notes', 'architecture.md'), '# Architecture\n\nRead-only note.')
    await fs.writeFile(path.join(vaultDir, 'notes', 'diagram.canvas'), '{"nodes":[]}')
    provider = new ObsidianVaultStorageProvider(storePath)
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('detects an Obsidian vault and advertises Markdown read only', async () => {
    const connected = await provider.connect(vaultDir)
    expect(connected).toMatchObject({
      id: 'obsidian-vault',
      name: 'Obsidian Vault',
      provider: 'obsidian',
      state: 'connected',
      capabilities: {
        list: true,
        search: true,
        metadata: true,
        read: true,
        write: false,
        delete: false,
        sync: false,
      },
    })

    const listing = await provider.list('notes')
    expect(listing.source.provider).toBe('obsidian')
    expect(listing.entries.map((entry) => entry.name)).toEqual(['architecture.md', 'diagram.canvas'])
  })

  it('reads bounded Markdown note content without exposing vault settings', async () => {
    await provider.connect(vaultDir)
    const content = await provider.read('notes/architecture.md')

    expect(content).toMatchObject({
      sourceId: 'obsidian-vault',
      relativePath: 'notes/architecture.md',
      content: '# Architecture\n\nRead-only note.',
    })
    await expect(provider.read('.obsidian/app.json')).rejects.toThrow(/prohibited segment/)
    await expect(provider.read('notes/diagram.canvas')).rejects.toThrow(/Only Markdown/)
  })

  it('rejects notes above the 256 KiB read limit', async () => {
    await fs.writeFile(path.join(vaultDir, 'notes', 'large.md'), 'x'.repeat(256 * 1024 + 1))
    await provider.connect(vaultDir)

    await expect(provider.read('notes/large.md')).rejects.toThrow(/256 KiB/)
  })

  it('does not treat a plain folder as an Obsidian vault or allow content reads', async () => {
    const plainFolder = path.join(tempDir, 'plain')
    await fs.mkdir(plainFolder)
    await fs.writeFile(path.join(plainFolder, 'note.md'), '# Plain folder')
    const connected = await provider.connect(plainFolder)

    expect(connected.provider).toBe('filesystem')
    expect(connected.capabilities.read).toBe(false)
    await expect(provider.read('note.md')).rejects.toThrow(/only from a connected Obsidian vault/)
  })

  it('restores Obsidian provider identity from the real vault marker after restart', async () => {
    await provider.connect(vaultDir)
    const restored = new ObsidianVaultStorageProvider(storePath)

    expect((await restored.getStatus())?.provider).toBe('obsidian')
    expect((await restored.search('architecture')).source.id).toBe('obsidian-vault')
  })

  it('rejects symlinked note targets', async () => {
    await provider.connect(vaultDir)
    const outside = path.join(tempDir, 'outside.md')
    await fs.writeFile(outside, '# Outside')
    try {
      await fs.symlink(outside, path.join(vaultDir, 'notes', 'linked.md'), 'file')
    } catch {
      return
    }

    await expect(provider.read('notes/linked.md')).rejects.toThrow(/Symbolic links/)
  })
})
