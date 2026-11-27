import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SecretReference, SecretProviderRegistry } from '../secrets/secret-provider.js'
import { OsSecretStore } from '../security/os-secret-store.js'

export type McpWorkersHealthStatus =
  | { state: 'reachable'; baseUrl: string; apiVersion: 1; detail: string }
  | { state: 'unavailable' | 'incompatible' | 'error'; baseUrl: string; detail: string }

export type McpWorkersConnectionStatus =
  | { state: 'connected'; baseUrl: string; detail: string }
  | { state: 'configured'; baseUrl: string; detail: string }
  | { state: 'disconnected' | 'unavailable' | 'error' | 'unauthorized' | 'insufficient-scope'; baseUrl: string; detail: string }

export interface McpWorkersDefinition {
  id: string
  name: string
  definitionVersion: string
  workerVersion?: string
  capabilities: string[]
  platforms: string[]
}

export interface McpWorkersInstance {
  instanceId: string
  definitionId: string
  installedVersion: string
  enabled: boolean
  runtimeState: string
  healthState: string
  role: string
  priority: number
  verifiedCapabilities: string[]
}

export interface McpWorkersSnapshot {
  definitions: McpWorkersDefinition[]
  instances: McpWorkersInstance[]
}

export interface McpWorkersClientOptions {
  baseUrl?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
  secretProviders: SecretProviderRegistry
  storePath: string
  secretStore?: OsSecretStore
}

interface StoredConnection {
  schemaVersion: 1
  baseUrl: string
  encryptedReference: string
}

const DEFAULT_BASE_URL = 'http://127.0.0.1:43127'
const DEFAULT_TIMEOUT_MS = 2_500
const TOKEN_PATTERN = /^[a-f0-9]{64}$/i

function validateBaseUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('MCPWorkers API URL is invalid.')
  }

  if (url.protocol !== 'http:' || !['127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('MCPWorkers API must use a plain HTTP loopback origin without credentials or URL decorations.')
  }

  return url.origin
}

function isHealthPayload(value: unknown): value is { ok: true; service: 'mcpworkers'; apiVersion: 1 } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  return record.ok === true && record.service === 'mcpworkers' && record.apiVersion === 1
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function readJsonBounded(response: Response, maxBytes = 2 * 1024 * 1024): Promise<unknown> {
  const declaredLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('MCPWorkers API response exceeds the configured size limit.')
  }
  if (!response.body) return response.json()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new Error('MCPWorkers API response exceeds the configured size limit.')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown
  } catch (error) {
    throw new Error('MCPWorkers returned an invalid JSON response.', { cause: error })
  }
}

function validateSecretReference(value: unknown): SecretReference {
  if (!isRecord(value) || typeof value.providerId !== 'string' || !isRecord(value.reference)) {
    throw new Error('MCPWorkers KeePassXC secret reference is invalid.')
  }
  if (value.providerId !== 'keepassxc') {
    throw new Error('MCPWorkers client credentials must be stored in KeePassXC.')
  }
  const reference = value.reference
  if (typeof reference.databasePath !== 'string' || !path.isAbsolute(reference.databasePath)
    || typeof reference.entryPath !== 'string' || !reference.entryPath.trim()
    || (reference.attribute !== undefined && typeof reference.attribute !== 'string')) {
    throw new Error('MCPWorkers KeePassXC database and entry paths are required.')
  }
  return {
    providerId: 'keepassxc',
    reference: {
      databasePath: reference.databasePath,
      entryPath: reference.entryPath,
      attribute: typeof reference.attribute === 'string' ? reference.attribute : 'Password',
    },
  }
}

export class McpWorkersApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message)
    this.name = 'McpWorkersApiError'
  }
}

export class McpWorkersClient {
  private readonly baseUrl: string
  private readonly timeoutMs: number
  private readonly fetchImpl: typeof fetch
  private readonly secretProviders: SecretProviderRegistry
  private readonly storePath: string
  private readonly secretStore: OsSecretStore
  private token: string | null = null
  private secretReference: SecretReference | null = null
  private initialized = false
  private initializationError: string | null = null

  constructor(options: McpWorkersClientOptions) {
    this.baseUrl = validateBaseUrl(options.baseUrl ?? DEFAULT_BASE_URL)
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    if (!Number.isInteger(this.timeoutMs) || this.timeoutMs < 250 || this.timeoutMs > 10_000) {
      throw new Error('MCPWorkers health timeout must be between 250 and 10000 milliseconds.')
    }
    if (!path.isAbsolute(options.storePath)) throw new Error('MCPWorkers connection store path must be absolute.')
    this.fetchImpl = options.fetchImpl ?? fetch
    this.secretProviders = options.secretProviders
    this.storePath = path.resolve(options.storePath)
    this.secretStore = options.secretStore ?? new OsSecretStore()
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    try {
      const details = await fs.lstat(this.storePath)
      if (!details.isFile() || details.isSymbolicLink() || details.size > 16 * 1024) {
        throw new Error('MCPWorkers connection settings are not a regular bounded file.')
      }
      const parsed: unknown = JSON.parse(await fs.readFile(this.storePath, 'utf8'))
      if (!isRecord(parsed) || parsed.schemaVersion !== 1 || typeof parsed.baseUrl !== 'string'
        || typeof parsed.encryptedReference !== 'string') {
        throw new Error('MCPWorkers connection settings are invalid.')
      }
      if (validateBaseUrl(parsed.baseUrl) !== this.baseUrl) {
        throw new Error('Saved MCPWorkers API URL does not match the configured endpoint.')
      }
      const decoded = JSON.parse(this.secretStore.decrypt(parsed.encryptedReference)) as unknown
      this.secretReference = validateSecretReference(decoded)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      this.secretReference = null
      this.initializationError = 'Saved MCPWorkers connection settings could not be decrypted or validated. Reconnect with a valid KeePassXC entry to replace them.'
    }
  }

  private async persistReference(reference: SecretReference): Promise<void> {
    const directory = path.dirname(this.storePath)
    await fs.mkdir(directory, { recursive: true })
    const payload: StoredConnection = {
      schemaVersion: 1,
      baseUrl: this.baseUrl,
      encryptedReference: this.secretStore.encrypt(JSON.stringify(reference)),
    }
    const temporaryPath = this.storePath + '.' + randomUUID() + '.tmp'
    const handle = await fs.open(temporaryPath, 'wx', 0o600)
    try {
      await handle.writeFile(JSON.stringify(payload), 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await fs.rename(temporaryPath, this.storePath)
    } finally {
      await fs.rm(temporaryPath, { force: true })
    }
  }

  private async request<T>(pathname: string, init: RequestInit = {}, timeoutMs = this.timeoutMs): Promise<T> {
    if (!this.token) throw new Error('MCPWorkers is configured but locked. Unlock the KeePassXC client credential first.')
    let response: Response
    try {
      response = await this.fetchImpl(new URL(pathname, this.baseUrl), {
        ...init,
        headers: {
          Accept: 'application/json',
          Authorization: 'Bearer ' + this.token,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new Error('MCPWorkers API request timed out.', { cause: error })
      }
      throw new Error('MCPWorkers API is unavailable on the configured loopback address.', { cause: error })
    }
    if (response.status >= 300 && response.status < 400) throw new Error('MCPWorkers API redirects are not accepted.')
    if (response.status === 401) throw new McpWorkersApiError('MCPWorkers rejected the saved client credential. Unlock or re-provision the KeePassXC entry.', 401, 'UNAUTHORIZED')
    if (response.status === 403) throw new McpWorkersApiError('The DevKit client does not have permission for this MCPWorkers operation.', 403, 'INSUFFICIENT_SCOPE')
    if (!response.ok) {
      let code: string | undefined
      try {
        const body: unknown = await readJsonBounded(response, 16 * 1024)
        if (isRecord(body) && isRecord(body.error) && typeof body.error.code === 'string') code = body.error.code
      } catch { /* Do not expose arbitrary response content. */ }
      if (response.status === 409) {
        throw new McpWorkersApiError(
          'The Worker state changed or the requested action is not currently allowed. Refresh the Worker list and review its current state before retrying.',
          409,
          code ?? 'CONFLICT',
        )
      }
      throw new McpWorkersApiError('MCPWorkers API request failed (HTTP ' + response.status + ').', response.status, code)
    }
    if (response.status === 204) return undefined as T
    try {
      return await readJsonBounded(response) as T
    } catch {
      throw new Error('MCPWorkers returned an invalid API response.')
    }
  }

  async getHealth(): Promise<McpWorkersHealthStatus> {
    try {
      const response = await this.fetchImpl(new URL('/v1/health', this.baseUrl), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      })

      if (response.status >= 300 && response.status < 400) {
        return { state: 'error', baseUrl: this.baseUrl, detail: 'MCPWorkers API redirects are not accepted.' }
      }
      if (response.status === 404) {
        return { state: 'incompatible', baseUrl: this.baseUrl, detail: 'MCPWorkers API v1 health endpoint was not found.' }
      }
      if (!response.ok) {
        return { state: 'error', baseUrl: this.baseUrl, detail: 'MCPWorkers API health request failed (HTTP ' + response.status + ').' }
      }

      let payload: unknown
      try {
        payload = await readJsonBounded(response, 16 * 1024)
      } catch {
        return { state: 'incompatible', baseUrl: this.baseUrl, detail: 'MCPWorkers returned an invalid health response.' }
      }
      if (!isHealthPayload(payload)) {
        return { state: 'incompatible', baseUrl: this.baseUrl, detail: 'MCPWorkers API health response is incompatible with API v1.' }
      }
      return {
        state: 'reachable',
        baseUrl: this.baseUrl,
        apiVersion: 1,
        detail: 'Manager API is reachable.',
      }
    } catch (error) {
      const timedOut = error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
      return {
        state: 'unavailable',
        baseUrl: this.baseUrl,
        detail: timedOut
          ? 'MCPWorkers API did not respond before the health-check timeout.'
          : 'MCPWorkers API is not reachable on the configured loopback address.',
      }
    }
  }

  async getConnectionStatus(): Promise<McpWorkersConnectionStatus> {
    await this.initialize()
    if (this.initializationError) return { state: 'error', baseUrl: this.baseUrl, detail: this.initializationError }
    if (!this.secretReference) return { state: 'disconnected', baseUrl: this.baseUrl, detail: 'No MCPWorkers client credential is configured.' }
    if (!this.token) return { state: 'configured', baseUrl: this.baseUrl, detail: 'KeePassXC client credential is configured. Unlock to authenticate.' }
    try {
      await this.request<{ definitions: unknown[] }>('/v1/definitions')
      return { state: 'connected', baseUrl: this.baseUrl, detail: 'Authenticated with MCPWorkers API v1.' }
    } catch (error) {
      if (error instanceof McpWorkersApiError && error.status === 401) return { state: 'unauthorized', baseUrl: this.baseUrl, detail: error.message }
      if (error instanceof McpWorkersApiError && error.status === 403) return { state: 'insufficient-scope', baseUrl: this.baseUrl, detail: error.message }
      return { state: 'error', baseUrl: this.baseUrl, detail: error instanceof Error ? error.message : 'MCPWorkers authentication failed.' }
    }
  }

  async connect(referenceInput: unknown, unlockPassword: string): Promise<McpWorkersConnectionStatus> {
    await this.initialize()
    if (typeof unlockPassword !== 'string' || !unlockPassword || unlockPassword.length > 4_096
      || /[\r\n\0]/.test(unlockPassword)) throw new Error('KeePassXC master password is required.')
    const reference = validateSecretReference(referenceInput)
    const token = await this.secretProviders.resolve(reference, unlockPassword)
    if (!TOKEN_PATTERN.test(token)) throw new Error('KeePassXC entry must contain a 64-character hexadecimal MCPWorkers client token.')
    const previousToken = this.token
    const previousReference = this.secretReference
    const previousInitializationError = this.initializationError
    this.initializationError = null
    this.token = token
    this.secretReference = reference
    try {
      await this.request<{ definitions: unknown[] }>('/v1/definitions')
      await this.persistReference(reference)
    } catch (error) {
      this.token = previousToken
      this.secretReference = previousReference
      this.initializationError = previousInitializationError
      throw error
    }
    return { state: 'connected', baseUrl: this.baseUrl, detail: 'Authenticated with MCPWorkers API v1.' }
  }

  async unlock(unlockPassword: string): Promise<McpWorkersConnectionStatus> {
    await this.initialize()
    if (this.initializationError) return { state: 'error', baseUrl: this.baseUrl, detail: this.initializationError }
    if (!this.secretReference) return { state: 'disconnected', baseUrl: this.baseUrl, detail: 'No MCPWorkers client credential is configured.' }
    if (typeof unlockPassword !== 'string' || !unlockPassword || unlockPassword.length > 4_096
      || /[\r\n\0]/.test(unlockPassword)) throw new Error('KeePassXC master password is required.')
    const token = await this.secretProviders.resolve(this.secretReference, unlockPassword)
    if (!TOKEN_PATTERN.test(token)) throw new Error('KeePassXC entry must contain a 64-character hexadecimal MCPWorkers client token.')
    this.token = token
    try {
      await this.request<{ definitions: unknown[] }>('/v1/definitions')
    } catch (error) {
      this.token = null
      throw error
    }
    return { state: 'connected', baseUrl: this.baseUrl, detail: 'Authenticated with MCPWorkers API v1.' }
  }

  dispose(): void {
    this.token = null
  }

  async disconnect(): Promise<boolean> {
    const hadConnection = Boolean(this.secretReference || this.token || this.initializationError)
    this.token = null
    this.secretReference = null
    this.initializationError = null
    this.initialized = true
    await fs.rm(this.storePath, { force: true })
    return hadConnection
  }

  async getSnapshot(): Promise<McpWorkersSnapshot> {
    await this.initialize()
    const [definitions, instances] = await Promise.all([
      this.request<{ definitions: unknown }>('/v1/definitions'),
      this.request<{ instances: unknown }>('/v1/instances'),
    ])
    if (!Array.isArray(definitions.definitions) || definitions.definitions.length > 500
      || !definitions.definitions.every((item) => isRecord(item)
        && typeof item.id === 'string' && typeof item.name === 'string'
        && typeof item.definitionVersion === 'string'
        && Array.isArray(item.capabilities) && item.capabilities.every((value) => typeof value === 'string')
        && Array.isArray(item.platforms) && item.platforms.every((value) => typeof value === 'string'))) {
      throw new Error('MCPWorkers returned an invalid or oversized Definition list.')
    }
    if (!Array.isArray(instances.instances) || instances.instances.length > 500
      || !instances.instances.every((item) => isRecord(item)
        && typeof item.instanceId === 'string' && /^[0-9a-f-]{36}$/i.test(item.instanceId)
        && typeof item.definitionId === 'string' && typeof item.installedVersion === 'string'
        && typeof item.enabled === 'boolean' && typeof item.runtimeState === 'string'
        && typeof item.healthState === 'string' && typeof item.role === 'string'
        && typeof item.priority === 'number'
        && Array.isArray(item.verifiedCapabilities) && item.verifiedCapabilities.every((value) => typeof value === 'string'))) {
      throw new Error('MCPWorkers returned an invalid or oversized Instance list.')
    }
    return {
      definitions: definitions.definitions.map((item) => ({
        id: item.id as string,
        name: item.name as string,
        definitionVersion: item.definitionVersion as string,
        ...(typeof item.workerVersion === 'string' ? { workerVersion: item.workerVersion } : {}),
        capabilities: [...item.capabilities as string[]],
        platforms: [...item.platforms as string[]],
      })),
      instances: instances.instances.map((item) => ({
        instanceId: item.instanceId as string,
        definitionId: item.definitionId as string,
        installedVersion: item.installedVersion as string,
        enabled: item.enabled as boolean,
        runtimeState: item.runtimeState as string,
        healthState: item.healthState as string,
        role: item.role as string,
        priority: item.priority as number,
        verifiedCapabilities: [...item.verifiedCapabilities as string[]],
      })),
    }
  }

  async checkInstanceHealth(instanceId: string): Promise<unknown> {
    if (!/^[0-9a-f-]{36}$/i.test(instanceId)) throw new Error('MCPWorkers Instance ID is invalid.')
    return this.request('/v1/instances/' + encodeURIComponent(instanceId) + '/health', {
      method: 'POST',
      body: JSON.stringify({}),
    }, 15_000)
  }

  async lifecycle(instanceId: string, action: 'start' | 'stop' | 'restart'): Promise<unknown> {
    if (!/^[0-9a-f-]{36}$/i.test(instanceId)) throw new Error('MCPWorkers Instance ID is invalid.')
    return this.request('/v1/instances/' + encodeURIComponent(instanceId) + '/lifecycle', {
      method: 'POST',
      body: JSON.stringify({ action }),
    }, 120_000)
  }
}
