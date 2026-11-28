import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { randomUUID } from 'node:crypto'
import { ensureSafeDirectory, resolveWorkspacePaths } from '../workspace.js'

export type LocalIntegrationId = 'multiaggregator'

export interface LocalIntegrationStatus {
  id: LocalIntegrationId
  name: string
  state: 'running' | 'stopped' | 'starting' | 'unavailable' | 'error'
  description: string
  detail?: string
  pid?: number
  canStart: boolean
  canStop: boolean
  stopHint?: string
}

/**
 * Stores the default Projects directory used by MCP connection setup.
 * MCP server and Worker lifecycle is exclusively managed through MCPWorkers.
 */
export class LocalIntegrationsManager {
  private readonly settingsPath: string
  private projectsRoot = path.join(os.homedir(), 'Projects')
  private initialized?: Promise<void>
  private operationQueue: Promise<void> = Promise.resolve()

  constructor(settingsPath = path.join(resolveWorkspacePaths().services, 'local-integrations.json')) {
    this.settingsPath = settingsPath
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation)
    this.operationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  async initialize(): Promise<void> {
    if (!this.initialized) this.initialized = this.loadSettings()
    return this.initialized
  }

  private async loadSettings(): Promise<void> {
    await ensureSafeDirectory(path.dirname(this.settingsPath))
    try {
      const stat = await fs.lstat(this.settingsPath)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Local integrations settings must be a regular file.')
      if (stat.size > 64 * 1024) throw new Error('Local integrations settings are too large.')
      const parsed: unknown = JSON.parse(await fs.readFile(this.settingsPath, 'utf8'))
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid local integrations settings.')
      const record = parsed as Record<string, unknown>
      if (record.schemaVersion !== 1 || typeof record.projectsRoot !== 'string' || !path.isAbsolute(record.projectsRoot)) {
        throw new Error('Local integrations settings use an unsupported schema.')
      }
      this.projectsRoot = path.resolve(record.projectsRoot)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  private async persistSettings(): Promise<void> {
    await ensureSafeDirectory(path.dirname(this.settingsPath))
    try {
      const stat = await fs.lstat(this.settingsPath)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Local integrations settings destination must be a regular file.')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const tempPath = this.settingsPath + '.' + process.pid + '.' + randomUUID() + '.tmp'
    try {
      await fs.writeFile(tempPath, JSON.stringify({ schemaVersion: 1, projectsRoot: this.projectsRoot }, null, 2), { encoding: 'utf8', flag: 'wx' })
      await fs.rename(tempPath, this.settingsPath)
    } catch (error) {
      await fs.unlink(tempPath).catch(() => undefined)
      throw error
    }
  }

  async setProjectsRoot(directory: unknown): Promise<string> {
    return this.enqueue(async () => {
      await this.initialize()
      if (typeof directory !== 'string' || directory.length > 4_096 || !path.isAbsolute(directory)) {
        throw new Error('Projects directory must be an absolute path.')
      }
      const stat = await fs.lstat(directory)
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Projects path must be a real directory.')
      const previous = this.projectsRoot
      this.projectsRoot = path.resolve(directory)
      try {
        await this.persistSettings()
      } catch (error) {
        this.projectsRoot = previous
        throw error
      }
      return this.projectsRoot
    })
  }

  async getProjectsRoot(): Promise<string> {
    await this.initialize()
    return this.projectsRoot
  }

  async getStatuses(): Promise<{ projectsRoot: string; integrations: LocalIntegrationStatus[] }> {
    await this.initialize()
    return { projectsRoot: this.projectsRoot, integrations: [] }
  }
}
