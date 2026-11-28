import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { ensureSafeDirectory, resolveWorkspacePaths } from '../workspace.js'
import { OsSecretStore } from '../security/os-secret-store.js'
import type { SecretReference, SecretProviderRegistry } from '../secrets/secret-provider.js'
import type {
  KarakeepBookmarkContent,
  KarakeepBookmarkPage,
  KarakeepBookmarkSummary,
  KarakeepBookmarkType,
  KarakeepSourceSummary,
} from '../../shared/storage.js'

const STORE_SCHEMA_VERSION = 1
const MAX_STORE_BYTES = 64 * 1024
const MAX_PAGE_BYTES = 2 * 1024 * 1024
const MAX_DETAIL_BYTES = 1024 * 1024
const MAX_PAGE_SIZE = 50
const MAX_CONTENT_BYTES = 256 * 1024
const REQUEST_TIMEOUT_MS = 12_000
const STATUS_PROBE_TIMEOUT_MS = 2_500

interface StoredKarakeepConfig {
  schemaVersion: 1
  baseUrl: string
  encryptedToken?: string
  secretReference?: SecretReference
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown, maxLength = 8_192): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : undefined
}

function validateBaseUrl(value: unknown): string {
  if (typeof value !== 'string' || value.length > 2_048) throw new Error('Karakeep URL is invalid.')
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error('Enter a valid Karakeep base URL.')
  }
  if (url.username || url.password || url.search || url.hash || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Karakeep URL must not contain credentials, query parameters, or fragments.')
  }
  const hostname = url.hostname.toLowerCase()
  const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]'
  if (url.protocol === 'http:' && !loopback) {
    throw new Error('Remote Karakeep connections must use HTTPS. HTTP is allowed only for loopback.')
  }
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error('Karakeep base URL must point to the service root.')
  }
  return url.origin
}

function validateApiToken(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Karakeep API key is required.')
  const token = value.trim()
  if (token.length < 16 || token.length > 4_096 || /[\r\n\0]/.test(token)) {
    throw new Error('Karakeep API key is invalid.')
  }
  return token
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxBytes) {
    throw new Error('Karakeep API response exceeds the supported size limit.')
  }
  if (!response.body) throw new Error('Karakeep API returned an empty response.')

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new Error('Karakeep API response exceeds the supported size limit.')
      }
      chunks.push(value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
  } catch {
    throw new Error('Karakeep API returned invalid JSON.')
  }
}

function safeBookmarkUrl(value: unknown): string | undefined {
  const candidate = stringValue(value, 2_048)
  if (!candidate) return undefined
  try {
    const url = new URL(candidate)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}


function normalizeType(value: unknown): KarakeepBookmarkType {
  return value === 'link' || value === 'text' || value === 'asset' ? value : 'unknown'
}

function normalizeBookmark(value: unknown): KarakeepBookmarkSummary {
  if (!isRecord(value)) throw new Error('Karakeep returned an invalid bookmark.')
  const id = stringValue(value.id, 128)
  if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Karakeep returned a bookmark with an invalid identifier.')
  const content = isRecord(value.content) ? value.content : undefined
  const tags = Array.isArray(value.tags)
    ? value.tags.flatMap((tag) => isRecord(tag) && stringValue(tag.name, 120) ? [stringValue(tag.name, 120)!] : []).slice(0, 50)
    : []
  const url = safeBookmarkUrl(content?.url ?? value.url)
  const description = stringValue(content?.description, 4_000) ?? stringValue(value.summary, 4_000) ?? stringValue(value.note, 4_000)
  return {
    id,
    title: stringValue(value.title, 1_000) ?? stringValue(content?.title, 1_000) ?? url ?? 'Untitled bookmark',
    type: normalizeType(content?.type ?? value.type),
    ...(url ? { url } : {}),
    ...(description ? { description } : {}),
    createdAt: stringValue(value.createdAt, 80) ?? stringValue(value.modifiedAt, 80) ?? stringValue(value.created_at, 80) ?? new Date(0).toISOString(),
    archived: value.archived === true,
    favourited: value.favourited === true,
    tags,
  }
}

function normalizePage(value: unknown): KarakeepBookmarkPage {
  if (!isRecord(value) || !Array.isArray(value.bookmarks)) {
    throw new Error('Karakeep returned an invalid bookmarks page.')
  }
  const bookmarks = value.bookmarks.slice(0, MAX_PAGE_SIZE).map(normalizeBookmark)
  return {
    bookmarks,
    nextCursor: stringValue(value.nextCursor, 2_048) ?? null,
  }
}

function normalizeContent(value: unknown, requestedId: string): KarakeepBookmarkContent {
  const record = isRecord(value) && isRecord(value.bookmark) ? value.bookmark : value
  if (!isRecord(record)) throw new Error('Karakeep returned invalid bookmark details.')
  const summary = normalizeBookmark({ ...record, id: record.id ?? requestedId })
  const nestedContent = isRecord(record.content) ? record.content : undefined
  const topLevelText = stringValue(record.textContent, MAX_CONTENT_BYTES)
  const nestedText = stringValue(nestedContent?.text, MAX_CONTENT_BYTES)
  const legacyNestedText = stringValue(nestedContent?.textContent, MAX_CONTENT_BYTES)
  const topLevelHtml = stringValue(record.htmlContent, MAX_CONTENT_BYTES)
  const nestedHtml = stringValue(nestedContent?.htmlContent, MAX_CONTENT_BYTES)
  const note = stringValue(record.note, MAX_CONTENT_BYTES) ?? stringValue(record.summary, MAX_CONTENT_BYTES)
  const text = topLevelText ?? nestedText ?? legacyNestedText ?? note
  const html = topLevelHtml ?? nestedHtml
  const content = text ?? html ?? ''
  const contentType = text ? 'text' : html ? 'html' : 'none'
  return {
    id: summary.id,
    title: summary.title,
    type: summary.type,
    ...(summary.url ? { url: summary.url } : {}),
    content: content.slice(0, MAX_CONTENT_BYTES),
    contentType,
    modifiedAt: stringValue(record.modifiedAt, 80) ?? stringValue(record.updatedAt, 80) ?? summary.createdAt,
  }
}

function summary(baseUrl: string, state: KarakeepSourceSummary['state'], credentialProvider: KarakeepSourceSummary['credentialProvider'], error?: string): KarakeepSourceSummary {
  return {
    id: 'karakeep',
    name: 'Karakeep',
    provider: 'karakeep',
    baseUrl,
    credentialProvider,
    state,
    capabilities: { list: true, search: true, metadata: true, read: true, write: false, delete: false, sync: false },
    lastCheckedAt: new Date().toISOString(),
    ...(error ? { error } : {}),
  }
}

export class KarakeepStorageProvider {
  private readonly storePath: string
  private readonly secretStore = new OsSecretStore()
  private baseUrl: string | null = null
  private encryptedToken: string | null = null
  private secretReference: SecretReference | null = null
  private resolvedSecret: string | null = null
  private readonly secretProviders?: SecretProviderRegistry
  private initialized?: Promise<void>
  private mutationQueue: Promise<void> = Promise.resolve()

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation)
    this.mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  constructor(
    storePath = path.join(resolveWorkspacePaths().services, 'karakeep-storage.json'),
    secretProviders?: SecretProviderRegistry,
  ) {
    this.storePath = storePath
    this.secretProviders = secretProviders
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
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Karakeep settings must be a regular file.')
      if (stat.size > MAX_STORE_BYTES) throw new Error('Karakeep settings exceed 64 KiB.')
      raw = await fs.readFile(this.storePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }

    const document: unknown = JSON.parse(raw)
    if (!isRecord(document) || document.schemaVersion !== STORE_SCHEMA_VERSION
      || typeof document.baseUrl !== 'string'
      || (document.encryptedToken !== undefined && typeof document.encryptedToken !== 'string')
      || (document.secretReference !== undefined && !isRecord(document.secretReference))) {
      throw new Error('Karakeep settings are invalid or use an unsupported schema.')
    }
    if (typeof document.encryptedToken !== 'string' && document.secretReference === undefined) {
      throw new Error('Karakeep settings do not contain a secret reference.')
    }
    this.baseUrl = validateBaseUrl(document.baseUrl)
    this.encryptedToken = typeof document.encryptedToken === 'string' ? document.encryptedToken : null
    this.secretReference = document.secretReference as unknown as SecretReference | undefined ?? null
  }

  private async persist(): Promise<void> {
    await ensureSafeDirectory(path.dirname(this.storePath))
    try {
      const stat = await fs.lstat(this.storePath)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Karakeep settings destination must be a regular file.')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const tempPath = this.storePath + '.' + process.pid + '.' + randomUUID() + '.tmp'
    const document: StoredKarakeepConfig = {
      schemaVersion: STORE_SCHEMA_VERSION,
      baseUrl: this.baseUrl!,
      ...(this.encryptedToken ? { encryptedToken: this.encryptedToken } : {}),
      ...(this.secretReference ? { secretReference: this.secretReference } : {}),
    }
    try {
      await fs.writeFile(tempPath, JSON.stringify(document, null, 2), { encoding: 'utf8', flag: 'wx' })
      await fs.rename(tempPath, this.storePath)
    } catch (error) {
      await fs.unlink(tempPath).catch(() => undefined)
      throw error
    }
  }

  private async request(baseUrl: string, token: string, endpoint: string, maxBytes: number, timeoutMs = REQUEST_TIMEOUT_MS): Promise<unknown> {
    const url = new URL('/api/v1' + endpoint, baseUrl)
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + token },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (response.status === 401) throw new Error('Karakeep rejected the API key. The token was not matched to an active API key; permission scopes are not checked by this endpoint.')
    if (response.status === 403) throw new Error('Karakeep denied this operation. The API key is valid but does not have the permission required for this resource.')
    if (!response.ok) throw new Error('Karakeep API request failed with HTTP ' + response.status + '.')
    return readBoundedJson(response, maxBytes)
  }

  private async verifyConnection(baseUrl: string, token: string, timeoutMs = REQUEST_TIMEOUT_MS): Promise<void> {
    const url = new URL('/api/v1/users/me', baseUrl)
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + token },
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (response.status === 401) throw new Error('Karakeep rejected the API key. The token was not matched to an active API key; permission scopes are not checked by this endpoint.')
    // Karakeep uses 403 for an authenticated key that lacks User account read.
    // That is still a valid connection; individual features enforce their own scopes.
    if (response.status === 403) return
    if (!response.ok) throw new Error('Karakeep connection check failed with HTTP ' + response.status + '.')
    await readBoundedJson(response, 64 * 1024)
  }

  private async getToken(): Promise<string> {
    if (this.secretReference) {
      if (!this.secretProviders) throw new Error('The configured Karakeep secret provider is unavailable.')
      if (this.resolvedSecret) return this.resolvedSecret
      const token = validateApiToken(await this.secretProviders.resolve(this.secretReference))
      this.resolvedSecret = token
      return token
    }
    if (!this.encryptedToken) throw new Error('No Karakeep API key is configured.')
    return this.secretStore.decrypt(this.encryptedToken)
  }

  async connectWithSecretReference(baseUrlInput: unknown, referenceInput: unknown, unlockPassword?: string): Promise<KarakeepSourceSummary> {
    return this.enqueue(async () => {
      await this.initialize()
      const baseUrl = validateBaseUrl(baseUrlInput)
      if (!isRecord(referenceInput) || typeof referenceInput.providerId !== 'string' || !isRecord(referenceInput.reference)) {
        throw new Error('Karakeep secret reference is invalid.')
      }
      if (!this.secretProviders) throw new Error('No Secret Provider registry is configured.')
      const secretReference = referenceInput as unknown as SecretReference
      const token = validateApiToken(await this.secretProviders.resolve(secretReference, unlockPassword))
      await this.verifyConnection(baseUrl, token)
      this.resolvedSecret = token

      const previousUrl = this.baseUrl
      const previousToken = this.encryptedToken
      const previousReference = this.secretReference
      this.baseUrl = baseUrl
      this.encryptedToken = null
      this.secretReference = secretReference
      try {
        await this.persist()
      } catch (error) {
        this.baseUrl = previousUrl
        this.encryptedToken = previousToken
        this.secretReference = previousReference
        throw error
      }
      return summary(baseUrl, 'connected', secretReference.providerId === 'keepassxc' ? 'keepassxc' : 'local-encryption')
    })
  }

  async connect(baseUrlInput: unknown, apiTokenInput: unknown): Promise<KarakeepSourceSummary> {
    return this.enqueue(async () => {
    await this.initialize()
    const baseUrl = validateBaseUrl(baseUrlInput)
    const apiToken = validateApiToken(apiTokenInput)
    await this.verifyConnection(baseUrl, apiToken)

    const previousUrl = this.baseUrl
    const previousToken = this.encryptedToken
    const previousReference = this.secretReference
    this.baseUrl = baseUrl
    this.encryptedToken = this.secretStore.encrypt(apiToken)
    this.secretReference = null
    try {
      await this.persist()
    } catch (error) {
      this.baseUrl = previousUrl
      this.encryptedToken = previousToken
      this.secretReference = previousReference
      throw error
    }
    return summary(baseUrl, 'connected', 'local-encryption')
    })
  }

  async getStatus(): Promise<KarakeepSourceSummary | null> {
    await this.initialize()
    if (!this.baseUrl || (!this.encryptedToken && !this.secretReference)) return null
    if (this.secretReference && !this.resolvedSecret) {
      return summary(this.baseUrl, 'configured', this.secretReference.providerId === 'keepassxc' ? 'keepassxc' : 'local-encryption', 'Credentials are configured. Unlock and verify to establish a live connection.')
    }
    try {
      const token = await this.getToken()
      await this.verifyConnection(this.baseUrl, token, STATUS_PROBE_TIMEOUT_MS)
      return summary(this.baseUrl, 'connected', this.secretReference?.providerId === 'keepassxc' ? 'keepassxc' : 'local-encryption')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Karakeep is unavailable.'
      const state = /rejected the API key|encryption is unavailable/i.test(message) ? 'error' : 'unavailable'
      return summary(this.baseUrl, state, this.secretReference?.providerId === 'keepassxc' ? 'keepassxc' : 'local-encryption', message)
    }
  }

  async disconnect(): Promise<boolean> {
    return this.enqueue(async () => {
    await this.initialize()
    if (!this.baseUrl && !this.encryptedToken && !this.secretReference) return false
    const previousUrl = this.baseUrl
    const previousToken = this.encryptedToken
    const previousReference = this.secretReference
    this.baseUrl = null
    this.encryptedToken = null
    this.secretReference = null
    this.resolvedSecret = null
    try {
      await fs.unlink(this.storePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== 'ENOENT') throw error
      })
    } catch (error) {
      this.baseUrl = previousUrl
      this.encryptedToken = previousToken
      this.secretReference = previousReference
      throw error
    }
    return true
    })
  }

  async list(cursorInput?: string | null, requestedLimit = 50): Promise<KarakeepBookmarkPage> {
    await this.initialize()
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_PAGE_SIZE) {
      throw new Error('Karakeep page size must be between 1 and 50.')
    }
    if (cursorInput !== undefined && cursorInput !== null && (typeof cursorInput !== 'string' || cursorInput.length > 2_048)) {
      throw new Error('Karakeep pagination cursor is invalid.')
    }
    const token = await this.getToken()
    const params = new URLSearchParams({ limit: String(requestedLimit), includeContent: 'false', sortOrder: 'desc' })
    if (cursorInput) params.set('cursor', cursorInput)
    return normalizePage(await this.request(this.baseUrl!, token, '/bookmarks?' + params.toString(), MAX_PAGE_BYTES))
  }

  async search(queryInput: unknown, cursorInput?: string | null, requestedLimit = 50): Promise<KarakeepBookmarkPage> {
    await this.initialize()
    if (typeof queryInput !== 'string' || queryInput.trim().length < 2 || queryInput.length > 120) {
      throw new Error('Karakeep search query must contain between 2 and 120 characters.')
    }
    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > MAX_PAGE_SIZE) {
      throw new Error('Karakeep page size must be between 1 and 50.')
    }
    if (cursorInput !== undefined && cursorInput !== null && (typeof cursorInput !== 'string' || cursorInput.length > 2_048)) {
      throw new Error('Karakeep pagination cursor is invalid.')
    }
    const token = await this.getToken()
    const params = new URLSearchParams({
      q: queryInput.trim(),
      limit: String(requestedLimit),
      includeContent: 'false',
      sortOrder: 'relevance',
    })
    if (cursorInput) params.set('cursor', cursorInput)
    return normalizePage(await this.request(this.baseUrl!, token, '/bookmarks/search?' + params.toString(), MAX_PAGE_BYTES))
  }

  async readBookmark(idInput: unknown): Promise<KarakeepBookmarkContent> {
    await this.initialize()
    if (typeof idInput !== 'string' || idInput.length > 128 || !/^[a-zA-Z0-9_-]+$/.test(idInput)) {
      throw new Error('Karakeep bookmark identifier is invalid.')
    }
    const token = await this.getToken()
    const params = new URLSearchParams({ includeContent: 'true' })
    const payload = await this.request(this.baseUrl!, token, '/bookmarks/' + encodeURIComponent(idInput) + '?' + params.toString(), MAX_DETAIL_BYTES)
    return normalizeContent(payload, idInput)
  }
}
