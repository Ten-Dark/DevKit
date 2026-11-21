import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ensureSafeDirectory, resolveWorkspacePaths } from '../workspace.js'
import { validateServiceDefinition, type ServiceDefinition } from './contracts.js'

export const SERVICE_REGISTRY_SCHEMA_VERSION = 1
const MAX_REGISTRY_BYTES = 5 * 1024 * 1024
const MAX_REGISTERED_SERVICES = 500

export interface ServiceRegistryDocument {
  schemaVersion: number
  revision: number
  updatedAt: string
  services: ServiceDefinition[]
}

export interface RegistryStoreOptions {
  filePath?: string
}

function isRegularFileStat(stat: Awaited<ReturnType<typeof fs.lstat>>): boolean {
  return !stat.isSymbolicLink() && stat.isFile()
}

function validateDocument(value: unknown): value is ServiceRegistryDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const document = value as Record<string, unknown>
  if (
    document.schemaVersion !== SERVICE_REGISTRY_SCHEMA_VERSION ||
    !Number.isSafeInteger(document.revision) ||
    (document.revision as number) < 0 ||
    typeof document.updatedAt !== 'string' ||
    Number.isNaN(Date.parse(document.updatedAt)) ||
    !Array.isArray(document.services) ||
    document.services.length > MAX_REGISTERED_SERVICES
  ) {
    return false
  }

  const ids = new Set<string>()
  for (const service of document.services) {
    const result = validateServiceDefinition(service)
    if (!result.valid || ids.has(result.value.id)) return false
    ids.add(result.value.id)
  }
  return true
}

function createEmptyDocument(): ServiceRegistryDocument {
  return {
    schemaVersion: SERVICE_REGISTRY_SCHEMA_VERSION,
    revision: 0,
    updatedAt: new Date().toISOString(),
    services: [],
  }
}

export class ServiceRegistryStore {
  readonly filePath: string
  readonly backupPath: string
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(options: RegistryStoreOptions = {}) {
    this.filePath = options.filePath ?? path.join(resolveWorkspacePaths().registry, 'services.json')
    this.backupPath = `${this.filePath}.bak`
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.writeQueue.then(operation)
    this.writeQueue = result.then(() => undefined, () => undefined)
    return result
  }

  private async readDocument(filePath: string): Promise<ServiceRegistryDocument> {
    await ensureSafeDirectory(path.dirname(filePath))
    const stat = await fs.lstat(filePath)
    if (!isRegularFileStat(stat)) {
      throw new Error(`Registry document is not a regular file: ${filePath}`)
    }
    if (stat.size > MAX_REGISTRY_BYTES) throw new Error('Registry document exceeds the 5 MiB safety limit.')
    const parsed: unknown = JSON.parse(await fs.readFile(filePath, 'utf8'))
    if (!validateDocument(parsed)) {
      throw new Error(`Registry document is invalid or uses an unsupported schema: ${filePath}`)
    }
    return parsed
  }

  private async writeAtomically(filePath: string, document: ServiceRegistryDocument): Promise<void> {
    await ensureSafeDirectory(path.dirname(filePath))
    const tempPath = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
    )
    try {
      await fs.writeFile(tempPath, JSON.stringify(document, null, 2), { encoding: 'utf8', flag: 'wx' })
      await fs.rename(tempPath, filePath)
    } catch (error) {
      await fs.unlink(tempPath).catch(() => undefined)
      throw error
    }
  }

  private async backupCurrentDocument(): Promise<void> {
    try {
      const current = await this.readDocument(this.filePath)
      await this.writeAtomically(this.backupPath, current)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
  }

  private async loadOrCreate(): Promise<ServiceRegistryDocument> {
    try {
      return await this.readDocument(this.filePath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        try {
          const backup = await this.readDocument(this.backupPath)
          await this.writeAtomically(this.filePath, backup)
          return backup
        } catch (backupError) {
          if ((backupError as NodeJS.ErrnoException).code !== 'ENOENT') {
            throw new Error('Service registry is missing and its backup is invalid.', { cause: backupError })
          }
        }
        const empty = createEmptyDocument()
        await this.writeAtomically(this.filePath, empty)
        return empty
      }

      // Recovery is allowed only from a validated previous snapshot. The
      // invalid source is quarantined rather than silently overwritten.
      let backup: ServiceRegistryDocument
      try {
        backup = await this.readDocument(this.backupPath)
      } catch {
        throw new Error('Service registry is invalid and no valid backup is available.', { cause: error })
      }

      const quarantinePath = `${this.filePath}.corrupt-${Date.now()}-${randomUUID()}`
      await fs.rename(this.filePath, quarantinePath)
      await this.writeAtomically(this.filePath, backup)
      return backup
    }
  }

  async list(): Promise<ServiceDefinition[]> {
    return this.enqueue(async () => (await this.loadOrCreate()).services)
  }

  async get(serviceId: string): Promise<ServiceDefinition | undefined> {
    return this.enqueue(async () => (await this.loadOrCreate()).services.find((service) => service.id === serviceId))
  }

  async register(input: unknown): Promise<ServiceDefinition> {
    return this.enqueue(async () => {
      const validation = validateServiceDefinition(input)
      if (validation.valid === false) {
        throw new Error(`Invalid service definition: ${validation.errors.join(' ')}`)
      }

      const current = await this.loadOrCreate()
      if (current.services.length >= MAX_REGISTERED_SERVICES) {
        throw new Error(`Service registry limit of ${MAX_REGISTERED_SERVICES} entries reached.`)
      }
      if (current.services.some((service) => service.id === validation.value.id)) {
        throw new Error(`Service '${validation.value.id}' is already registered.`)
      }

      const next: ServiceRegistryDocument = {
        schemaVersion: SERVICE_REGISTRY_SCHEMA_VERSION,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
        services: [...current.services, validation.value],
      }
      await this.backupCurrentDocument()
      await this.writeAtomically(this.filePath, next)
      return validation.value
    })
  }

  async replace(serviceId: string, input: unknown): Promise<ServiceDefinition> {
    return this.enqueue(async () => {
      const validation = validateServiceDefinition(input)
      if (validation.valid === false) {
        throw new Error(`Invalid service definition: ${validation.errors.join(' ')}`)
      }
      if (validation.value.id !== serviceId) {
        throw new Error('A service update cannot change its identifier.')
      }

      const current = await this.loadOrCreate()
      const index = current.services.findIndex((service) => service.id === serviceId)
      if (index < 0) throw new Error(`Service '${serviceId}' is not registered.`)

      const services = [...current.services]
      services[index] = validation.value
      const next: ServiceRegistryDocument = {
        schemaVersion: SERVICE_REGISTRY_SCHEMA_VERSION,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
        services,
      }
      await this.backupCurrentDocument()
      await this.writeAtomically(this.filePath, next)
      return validation.value
    })
  }

  async unregister(serviceId: string): Promise<boolean> {
    return this.enqueue(async () => {
      const current = await this.loadOrCreate()
      const services = current.services.filter((service) => service.id !== serviceId)
      if (services.length === current.services.length) return false

      const next: ServiceRegistryDocument = {
        schemaVersion: SERVICE_REGISTRY_SCHEMA_VERSION,
        revision: current.revision + 1,
        updatedAt: new Date().toISOString(),
        services,
      }
      await this.backupCurrentDocument()
      await this.writeAtomically(this.filePath, next)
      return true
    })
  }
}
