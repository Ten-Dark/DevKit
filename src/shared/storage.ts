export type StorageEntryKind = 'file' | 'directory'

export interface StorageCapabilities {
  list: boolean
  search: boolean
  metadata: boolean
  read: boolean
  write: boolean
  delete: boolean
  sync: boolean
}

export interface StorageSourceSummary {
  id: string
  name: string
  rootPath: string
  provider: 'filesystem'
  ownership: 'connected'
  state: 'connected' | 'unavailable' | 'error'
  capabilities: StorageCapabilities
  lastCheckedAt: string
  error?: string
}

export interface StorageEntry {
  id: string
  name: string
  kind: StorageEntryKind
  sizeBytes?: number
  modifiedAt: string
}

export interface StorageListing {
  source: StorageSourceSummary
  relativePath: string
  entries: StorageEntry[]
  truncated: boolean
}

export interface StorageSearchResult {
  source: StorageSourceSummary
  query: string
  entries: StorageEntry[]
  truncated: boolean
}

export interface StorageEntryMetadata extends StorageEntry {
  sourceId: string
  relativePath: string
}

/**
 * Provider boundary for connected storage sources.
 * Implementations must enforce their own path, permission, and capability checks.
 */
export interface StorageProvider {
  getStatus(): Promise<StorageSourceSummary | null>
  list(relativePath?: string, limit?: number): Promise<StorageListing>
  search(query: string, limit?: number): Promise<StorageSearchResult>
  getMetadata(relativePath: string): Promise<StorageEntryMetadata>
}
