import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { constants as fsConstants } from 'node:fs'
import type { Stats } from 'node:fs'
import { dialog } from 'electron'
import { resolveWorkspacePaths, ensureSafeDirectory } from '../workspace.js'
import type {
  StorageCapabilities,
  StorageEntry,
  StorageEntryMetadata,
  StorageFileContent,
  StorageListing,
  StorageSearchResult,
  StorageSourceSummary,
  StorageProvider,
} from '../../shared/storage.js'

const STORE_SCHEMA_VERSION = 1
const MAX_PAGE_SIZE = 100
const MAX_DIRECTORY_VISITS = 2_500
const MAX_SEARCH_RESULTS = 100
const MAX_SEARCH_VISITS = 2_500
const MAX_SEARCH_DEPTH = 6
const SKIPPED_DIRECTORY_NAMES = new Set(['.obsidian', '.git', '.trash', 'node_modules', '.devkit'])

interface StoreDocument {
  schemaVersion: number
  rootPath: string | null
}

const READ_ONLY_CAPABILITIES: StorageCapabilities = {
  list: true,
  search: true,
  metadata: true,
  read: false,
  write: false,
  delete: false,
  sync: false,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizeRelativePath(value: unknown): string {
  if (value === undefined || value === '') return ''
  if (typeof value !== 'string' || value.length > 2_048 || value.includes('\0')) {
    throw new Error('Storage path is invalid.')
  }
  const normalized = value.replaceAll('\\', '/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:/.test(normalized)) {
    throw new Error('Absolute paths are not accepted by the Storage provider.')
  }
  const segments = normalized.split('/').filter(Boolean)
  if (segments.some((segment) => segment === '.' || segment === '..' || segment.startsWith('.'))) {
    throw new Error('Storage path contains a prohibited segment.')
  }
  return segments.join(path.sep)
}

function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))
}

function pathsEqual(left: string, right: string): boolean {
  const a = path.resolve(left)
  const b = path.resolve(right)
  return process.platform === 'win32' ? a.toLocaleLowerCase() === b.toLocaleLowerCase() : a === b
}

export class StorageManager implements StorageProvider {
  private readonly storePath: string
  private rootPath: string | null = null
  private initialized?: Promise<void>
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(storePath = path.join(resolveWorkspacePaths().config, 'storage-sources.json')) {
    this.storePath = storePath
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation)
    this.mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  async initialize(): Promise<void> {
    if (!this.initialized) this.initialized = this.load()
    return this.initialized
  }

  private async load(): Promise<void> {
    await ensureSafeDirectory(path.dirname(this.storePath))
    let raw: string
    try {
      const stat = await fs.lstat(this.storePath)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Storage source registry must be a regular file.')
      if (stat.size > 64 * 1024) throw new Error('Storage source registry exceeds 64 KiB.')
      raw = await fs.readFile(this.storePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }

    const document: unknown = JSON.parse(raw)
    if (!isRecord(document) || document.schemaVersion !== STORE_SCHEMA_VERSION
      || (document.rootPath !== null
        && (typeof document.rootPath !== 'string' || !path.isAbsolute(document.rootPath)))) {
      throw new Error('Storage source registry is invalid or uses an unsupported schema.')
    }
    this.rootPath = document.rootPath as string | null
  }

  private async persist(): Promise<void> {
    await ensureSafeDirectory(path.dirname(this.storePath))
    try {
      const stat = await fs.lstat(this.storePath)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Storage source registry destination must be a regular file.')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const tempPath = this.storePath + '.' + process.pid + '.' + randomUUID() + '.tmp'
    const document: StoreDocument = { schemaVersion: STORE_SCHEMA_VERSION, rootPath: this.rootPath }
    try {
      await fs.writeFile(tempPath, JSON.stringify(document, null, 2), { encoding: 'utf8', flag: 'wx' })
      await fs.rename(tempPath, this.storePath)
    } catch (error) {
      await fs.unlink(tempPath).catch(() => undefined)
      throw error
    }
  }

  private async getVerifiedRoot(): Promise<string> {
    await this.initialize()
    if (!this.rootPath) throw new Error('No Storage folder is connected.')
    const stat = await fs.lstat(this.rootPath)
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Connected Storage folder is unavailable or is not a real directory.')
    const realRoot = await fs.realpath(this.rootPath)
    if (!pathsEqual(this.rootPath, realRoot)) throw new Error('Connected Storage folder resolves through a symbolic link.')
    return realRoot
  }

  private summary(rootPath: string, state: StorageSourceSummary['state'], error?: string): StorageSourceSummary {
    return {
      id: 'local-folder',
      name: path.basename(rootPath) || 'Local folder',
      rootPath,
      provider: 'filesystem',
      ownership: 'connected',
      state,
      capabilities: { ...READ_ONLY_CAPABILITIES },
      lastCheckedAt: new Date().toISOString(),
      ...(error ? { error } : {}),
    }
  }

  async getStatus(): Promise<StorageSourceSummary | null> {
    await this.initialize()
    if (!this.rootPath) return null
    try {
      const root = await this.getVerifiedRoot()
      await fs.access(root)
      return this.summary(root, 'connected')
    } catch (error) {
      return this.summary(this.rootPath, 'unavailable', error instanceof Error ? error.message : 'Storage folder is unavailable.')
    }
  }

  async selectAndConnect(): Promise<StorageSourceSummary | null> {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Connect a read-only Storage folder',
    })
    if (result.canceled || !result.filePaths[0]) return null
    return this.connect(result.filePaths[0])
  }

  async connect(directory: string): Promise<StorageSourceSummary> {
    return this.enqueue(async () => {
      if (typeof directory !== 'string' || directory.length > 4_096 || !path.isAbsolute(directory)) {
        throw new Error('Storage directory must be an absolute path.')
      }
      const stat = await fs.lstat(directory)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Select a real directory, not a file or symbolic link.')
      const realRoot = await fs.realpath(directory)
      if (!pathsEqual(directory, realRoot)) throw new Error('Selected directory resolves through a symbolic link.')
      const previous = this.rootPath
      this.rootPath = realRoot
      try {
        await this.persist()
      } catch (error) {
        this.rootPath = previous
        throw error
      }
      return this.summary(realRoot, 'connected')
    })
  }

  async disconnect(): Promise<boolean> {
    return this.enqueue(async () => {
      await this.initialize()
      if (!this.rootPath) return false
      const previous = this.rootPath
      this.rootPath = null
      try {
        await this.persist()
      } catch (error) {
        this.rootPath = previous
        throw error
      }
      return true
    })
  }

  private async resolveEntry(relativePath: unknown): Promise<{ root: string; target: string; relative: string }> {
    const root = await this.getVerifiedRoot()
    const relative = normalizeRelativePath(relativePath)
    const target = path.resolve(root, relative)
    if (!isWithinRoot(root, target)) throw new Error('Storage path escapes the connected root.')
    let current = root
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment)
      const stat = await fs.lstat(current)
      if (stat.isSymbolicLink()) throw new Error('Symbolic links are not traversed by the Storage provider.')
    }
    return { root, target, relative }
  }

  private toEntry(relativePath: string, name: string, kind: StorageEntry['kind'], stat: Stats): StorageEntry {
    return {
      id: relativePath.replaceAll(path.sep, '/'),
      name,
      kind,
      ...(kind === 'file' ? { sizeBytes: stat.size } : {}),
      modifiedAt: stat.mtime.toISOString(),
    }
  }

  async list(relativePath?: string, requestedLimit = 100): Promise<StorageListing> {
    const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(MAX_PAGE_SIZE, requestedLimit)) : MAX_PAGE_SIZE
    const { root, target, relative } = await this.resolveEntry(relativePath)
    const directoryStat = await fs.lstat(target)
    if (!directoryStat.isDirectory()) throw new Error('Storage listing target is not a directory.')
    const entries: StorageEntry[] = []
    let scanned = 0
    let truncated = false
    const directory = await fs.opendir(target)
    for await (const child of directory) {
      scanned += 1
      if (scanned > MAX_DIRECTORY_VISITS) {
        truncated = true
        break
      }
      const name = child.name
      if (name.startsWith('.') || SKIPPED_DIRECTORY_NAMES.has(name) || child.isSymbolicLink()) continue
      const absolute = path.join(target, name)
      let stat: Stats
      try {
        stat = await fs.lstat(absolute)
      } catch {
        continue
      }
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) continue
      entries.push(this.toEntry(path.relative(root, absolute), name, stat.isDirectory() ? 'directory' : 'file', stat))
      if (entries.length >= limit) {
        truncated = true
        break
      }
    }
    entries.sort((left, right) => left.name.localeCompare(right.name))
    return { source: this.summary(root, 'connected'), relativePath: relative.replaceAll(path.sep, '/'), entries, truncated }
  }

  async search(query: string, requestedLimit = 50): Promise<StorageSearchResult> {
    if (typeof query !== 'string' || query.trim().length < 2 || query.length > 120) {
      throw new Error('Storage search query must contain between 2 and 120 characters.')
    }
    const limit = Number.isInteger(requestedLimit) ? Math.max(1, Math.min(MAX_SEARCH_RESULTS, requestedLimit)) : 50
    const root = await this.getVerifiedRoot()
    const needle = query.trim().toLocaleLowerCase()
    const entries: StorageEntry[] = []
    const queue: Array<{ directory: string; depth: number }> = [{ directory: root, depth: 0 }]
    let visited = 0
    let truncated = false

    while (queue.length > 0 && entries.length < limit && visited < MAX_SEARCH_VISITS) {
      const current = queue.shift()!
      if (current.depth > MAX_SEARCH_DEPTH) continue
      let directory
      try {
        directory = await fs.opendir(current.directory)
      } catch {
        continue
      }
      for await (const child of directory) {
        visited += 1
        if (visited > MAX_SEARCH_VISITS) {
          truncated = true
          break
        }
        if (child.name.startsWith('.') || SKIPPED_DIRECTORY_NAMES.has(child.name) || child.isSymbolicLink()) continue
        const absolute = path.join(current.directory, child.name)
        if (child.isDirectory()) {
          if (child.name.toLocaleLowerCase().includes(needle)) {
            try {
              const stat = await fs.lstat(absolute)
              if (stat.isDirectory() && !stat.isSymbolicLink()) {
                entries.push(this.toEntry(path.relative(root, absolute), child.name, 'directory', stat))
                if (entries.length >= limit) {
                  truncated = true
                  break
                }
              }
            } catch {
              // Entries can disappear while the user is browsing a changing folder.
            }
          }
          if (current.depth < MAX_SEARCH_DEPTH) queue.push({ directory: absolute, depth: current.depth + 1 })
        } else if (child.isFile() && child.name.toLocaleLowerCase().includes(needle)) {
          try {
            const stat = await fs.lstat(absolute)
            if (stat.isSymbolicLink() || !stat.isFile()) continue
            entries.push(this.toEntry(path.relative(root, absolute), child.name, 'file', stat))
            if (entries.length >= limit) {
              truncated = true
              break
            }
          } catch {
            // Entries can disappear while the user is browsing a changing folder.
          }
        }
      }
      if (truncated) break
    }
    if (queue.length > 0 && visited >= MAX_SEARCH_VISITS) truncated = true
    return { source: this.summary(root, 'connected'), query: query.trim(), entries, truncated }
  }

  async getMetadata(relativePath: string): Promise<StorageEntryMetadata> {
    const { target, relative } = await this.resolveEntry(relativePath)
    const stat = await fs.lstat(target)
    if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
      throw new Error('Storage metadata is available only for regular files and directories.')
    }
    return {
      ...this.toEntry(relative, path.basename(target), stat.isDirectory() ? 'directory' : 'file', stat),
      sourceId: 'local-folder',
      relativePath: relative.replaceAll(path.sep, '/'),
    }
  }

}

/**
 * Detects an Obsidian vault by its real .obsidian directory and exposes
 * bounded, read-only Markdown note access on top of the folder provider.
 */
export class ObsidianVaultStorageProvider extends StorageManager {
  override async getStatus(): Promise<StorageSourceSummary | null> {
    const source = await super.getStatus()
    if (!source || source.state !== 'connected') return source
    try {
      const marker = await fs.lstat(path.join(source.rootPath, '.obsidian'))
      if (!marker.isDirectory() || marker.isSymbolicLink()) return source
      return {
        ...source,
        id: 'obsidian-vault',
        name: 'Obsidian Vault',
        provider: 'obsidian',
        capabilities: { ...source.capabilities, read: true },
      }
    } catch {
      return source
    }
  }

  override async connect(directory: string): Promise<StorageSourceSummary> {
    await super.connect(directory)
    const source = await this.getStatus()
    if (!source) throw new Error('Connected Storage source could not be loaded.')
    return source
  }

  override async list(relativePath?: string, limit?: number): Promise<StorageListing> {
    const listing = await super.list(relativePath, limit)
    const source = await this.getStatus()
    return { ...listing, source: source ?? listing.source }
  }

  override async search(query: string, limit?: number): Promise<StorageSearchResult> {
    const result = await super.search(query, limit)
    const source = await this.getStatus()
    return { ...result, source: source ?? result.source }
  }

  override async getMetadata(relativePath: string): Promise<StorageEntryMetadata> {
    const metadata = await super.getMetadata(relativePath)
    const source = await this.getStatus()
    return { ...metadata, sourceId: source?.id ?? metadata.sourceId }
  }

  async read(relativePath: string): Promise<StorageFileContent> {
    const source = await this.getStatus()
    if (!source || source.provider !== 'obsidian') {
      throw new Error('File content is available only from a connected Obsidian vault.')
    }

    const root = await fs.realpath(source.rootPath)
    const relative = normalizeRelativePath(relativePath)
    const target = path.resolve(root, relative)
    if (!isWithinRoot(root, target)) throw new Error('Storage path escapes the connected vault.')
    if (path.extname(target).toLocaleLowerCase() !== '.md') {
      throw new Error('Only Markdown notes can be opened from an Obsidian vault.')
    }

    let current = root
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment)
      const stat = await fs.lstat(current)
      if (stat.isSymbolicLink()) throw new Error('Symbolic links are not traversed by the Obsidian provider.')
    }

    const before = await fs.lstat(target)
    if (!before.isFile() || before.size > 256 * 1024) {
      throw new Error('Markdown note exceeds the 256 KiB read limit or is not a regular file.')
    }

    const noFollow = process.platform === 'win32' ? 0 : (fsConstants.O_NOFOLLOW ?? 0)
    const handle = await fs.open(target, fsConstants.O_RDONLY | noFollow)
    try {
      const opened = await handle.stat()
      const after = await fs.lstat(target)
      if (!opened.isFile() || after.isSymbolicLink()
        || opened.dev !== before.dev || opened.ino !== before.ino
        || after.dev !== opened.dev || after.ino !== opened.ino) {
        throw new Error('Markdown note changed while it was being opened.')
      }
      const realPath = await fs.realpath(target)
      if (!isWithinRoot(root, realPath) || !pathsEqual(target, realPath)) {
        throw new Error('Markdown note resolves outside the connected vault.')
      }
      if (opened.size > 256 * 1024) throw new Error('Markdown note exceeds the 256 KiB read limit.')
      const content = await handle.readFile({ encoding: 'utf8' })
      const sizeBytes = Buffer.byteLength(content, 'utf8')
      if (sizeBytes > 256 * 1024) throw new Error('Markdown note exceeds the 256 KiB read limit.')
      return {
        sourceId: 'obsidian-vault',
        relativePath: relative.replaceAll(path.sep, '/'),
        content,
        sizeBytes,
        modifiedAt: opened.mtime.toISOString(),
      }
    } finally {
      await handle.close()
    }
  }
}