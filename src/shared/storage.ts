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
  provider: 'filesystem' | 'obsidian'
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

export interface StorageFileContent {
  sourceId: string
  relativePath: string
  content: string
  contentType?: 'text' | 'html' | 'markdown'
  sizeBytes: number
  modifiedAt: string
}

/**
 * Provider boundary for connected local storage sources.
 * Implementations must enforce their own path, permission, and capability checks.
 */
export interface StorageProvider {
  getStatus(): Promise<StorageSourceSummary | null>
  list(relativePath?: string, limit?: number): Promise<StorageListing>
  search(query: string, limit?: number): Promise<StorageSearchResult>
  getMetadata(relativePath: string): Promise<StorageEntryMetadata>
  read?(relativePath: string): Promise<StorageFileContent>
}

export interface KarakeepSourceSummary {
  id: 'karakeep'
  name: 'Karakeep'
  provider: 'karakeep'
  baseUrl: string
  credentialProvider: 'keepassxc' | 'local-encryption'
  state: 'connected' | 'configured' | 'unavailable' | 'error'
  capabilities: StorageCapabilities
  lastCheckedAt: string
  error?: string
}

export type KarakeepBookmarkType = 'link' | 'text' | 'asset' | 'unknown'

export interface KarakeepBookmarkSummary {
  id: string
  title: string
  type: KarakeepBookmarkType
  url?: string
  description?: string
  createdAt: string
  archived: boolean
  favourited: boolean
  tags: string[]
}

export interface KarakeepBookmarkPage {
  bookmarks: KarakeepBookmarkSummary[]
  nextCursor: string | null
}

export interface KarakeepBookmarkContent {
  id: string
  title: string
  type: KarakeepBookmarkType
  url?: string
  content: string
  contentType: 'text' | 'html' | 'none'
  modifiedAt: string
}
