import type {
  McpRegistryPackage,
  McpRegistryPage,
  McpRegistryRemote,
  McpRegistryServer,
} from '../../shared/mcp.js'

const REGISTRY_BASE_URL = 'https://registry.modelcontextprotocol.io'
const REGISTRY_PAGE_LIMIT = 24
const MAX_REGISTRY_RESPONSE_BYTES = 2 * 1024 * 1024
const MAX_SERVER_DETAIL_BYTES = 1024 * 1024
const CACHE_TTL_MS = 5 * 60_000

interface RegistryRawRecord {
  server?: Record<string, unknown>
  _meta?: Record<string, unknown>
}

interface RegistryRawResponse {
  servers?: RegistryRawRecord[]
  metadata?: { nextCursor?: string; count?: number }
}

interface RegistryOfficialMetadata {
  status?: string
  publishedAt?: string
  updatedAt?: string
  isLatest?: boolean
}

interface RegistryRawParameter {
  name?: unknown
  description?: unknown
  type?: unknown
  value?: unknown
  default?: unknown
  format?: unknown
  isRequired?: unknown
  isSecret?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown, maxLength = 4_000): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : undefined
}

function safeWebUrl(value: unknown): string | undefined {
  const candidate = asString(value, 2_048)
  if (!candidate) return undefined
  try {
    const url = new URL(candidate)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return undefined
    return url.toString()
  } catch {
    return undefined
  }
}

function safeEndpointUrl(value: unknown): string | undefined {
  const candidate = safeWebUrl(value)
  if (!candidate) return undefined
  try {
    const url = new URL(candidate)
    if (url.search || url.hash || url.username || url.password) return undefined
    if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname.toLowerCase())) {
      return undefined
    }
    return url.toString()
  } catch {
    return undefined
  }
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength && /^\d+$/.test(declaredLength) && Number(declaredLength) > maxBytes) {
    throw new Error('Official MCP Registry response exceeds the supported size limit.')
  }
  if (!response.body) throw new Error('Official MCP Registry returned an empty response.')

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
        throw new Error('Official MCP Registry response exceeds the supported size limit.')
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
    throw new Error('Official MCP Registry returned invalid JSON.')
  }
}

function readOfficialMetadata(raw: RegistryRawRecord): RegistryOfficialMetadata {
  const meta = raw._meta
  if (!isRecord(meta)) return {}
  const official = meta['io.modelcontextprotocol.registry/official']
  return isRecord(official) ? official as RegistryOfficialMetadata : {}
}


function normalizeParameter(value: unknown): McpRegistryPackage['packageArguments'][number] | null {
  if (!isRecord(value)) return null
  const item = value as RegistryRawParameter
  const type = asString(item.type, 32)
  if (!type) return null
  return {
    ...(asString(item.name, 128) ? { name: asString(item.name, 128) } : {}),
    ...(asString(item.description, 1_000) ? { description: asString(item.description, 1_000) } : {}),
    type,
    required: item.isRequired === true,
    ...(asString(item.value, 1_000) ? { value: asString(item.value, 1_000) } : {}),
    ...(asString(item.default, 1_000) ? { defaultValue: asString(item.default, 1_000) } : {}),
    ...(asString(item.format, 64) ? { format: asString(item.format, 64) } : {}),
  }
}

function normalizePackage(value: unknown): McpRegistryPackage | null {
  if (!isRecord(value)) return null
  const identifier = asString(value.identifier, 512)
  const version = asString(value.version, 128)
  const registryType = asString(value.registryType, 32)
  const transport = isRecord(value.transport) ? value.transport : {}
  const transportType = asString(transport.type, 64)
  if (!identifier || !version || !registryType || !transportType) return null

  const environmentVariables = Array.isArray(value.environmentVariables)
    ? value.environmentVariables.flatMap((entry) => {
        if (!isRecord(entry)) return []
        const name = asString(entry.name, 128)
        if (!name || !/^[A-Z_][A-Z0-9_]{0,63}$/.test(name)) return []
        return [{
          name,
          ...(asString(entry.description, 1_000) ? { description: asString(entry.description, 1_000) } : {}),
          required: entry.isRequired === true,
          secret: entry.isSecret === true,
          ...(asString(entry.default, 1_000) ? { defaultValue: asString(entry.default, 1_000) } : {}),
        }]
      })
    : []

  const packageArguments = Array.isArray(value.packageArguments)
    ? value.packageArguments.map(normalizeParameter).filter((item): item is NonNullable<typeof item> => Boolean(item))
    : []
  const runtimeArguments = Array.isArray(value.runtimeArguments)
    ? value.runtimeArguments.map((entry) => {
        if (!isRecord(entry)) return null
        const type = asString(entry.type, 32)
        if (!type) return null
        return {
          type,
          ...(asString(entry.value, 1_000) ? { value: asString(entry.value, 1_000) } : {}),
          ...(asString(entry.name, 128) ? { name: asString(entry.name, 128) } : {}),
          required: entry.isRequired === true,
        }
      }).filter((item): item is NonNullable<typeof item> => Boolean(item))
    : []

  const installBlockers: string[] = []
  if (registryType !== 'npm') installBlockers.push('Only npm packages are currently supported for local installation.')
  if (value.runtimeHint !== 'npx') installBlockers.push('The registry entry does not declare the npx runtime.')
  if (transportType !== 'stdio') installBlockers.push('The package does not declare stdio transport.')
  if (environmentVariables.some((item) => item.required)) installBlockers.push('This server requires environment variables to be configured.')
  if (packageArguments.length > 0) installBlockers.push('This server declares package arguments that need to be configured manually.')
  if (runtimeArguments.some((item) => !['-y', '--yes'].includes(item.value ?? ''))) installBlockers.push('This server declares custom runtime arguments that need to be reviewed manually.')

  return {
    registryType,
    identifier,
    version,
    ...(asString(value.runtimeHint, 64) ? { runtimeHint: asString(value.runtimeHint, 64) } : {}),
    transportType,
    environmentVariables,
    packageArguments,
    runtimeArguments,
    canInstallWithNpx: installBlockers.length === 0,
    installBlockers,
  }
}

function normalizeRemote(value: unknown): McpRegistryRemote | null {
  if (!isRecord(value)) return null
  const type = asString(value.type, 64)
  const url = safeEndpointUrl(value.url)
  if (!type || !url) return null
  const headers = Array.isArray(value.headers)
    ? value.headers.flatMap((item) => {
        if (!isRecord(item)) return []
        const name = asString(item.name, 128)
        if (!name || !/^[!#$%&'*+.^_0-9A-Za-z-]+$/.test(name)) return []
        return [{
          name,
          ...(asString(item.description, 1_000) ? { description: asString(item.description, 1_000) } : {}),
          required: item.isRequired === true,
          secret: item.isSecret === true,
        }]
      })
    : []
  return { type, url, requiresAuth: headers.some((header) => header.required), headers }
}

function normalizeServer(raw: RegistryRawRecord): McpRegistryServer | null {
  if (!isRecord(raw.server)) return null
  const server = raw.server
  const name = asString(server.name, 512)
  const version = asString(server.version, 128)
  if (!name || !version) return null
  const metadata = readOfficialMetadata(raw)
  const statusValue = asString(metadata.status, 32)
  const status = statusValue === 'active' || statusValue === 'deprecated' || statusValue === 'deleted'
    ? statusValue
    : 'unknown'

  return {
    name,
    ...(asString(server.title, 160) ? { title: asString(server.title, 160) } : {}),
    description: asString(server.description, 4_000) ?? 'No description provided by the publisher.',
    version,
    status,
    ...(asString(metadata.publishedAt, 64) ? { publishedAt: asString(metadata.publishedAt, 64) } : {}),
    ...(asString(metadata.updatedAt, 64) ? { updatedAt: asString(metadata.updatedAt, 64) } : {}),
    ...(isRecord(server.repository) && safeWebUrl(server.repository.url) ? { repositoryUrl: safeWebUrl(server.repository.url) } : {}),
    ...(safeWebUrl(server.websiteUrl) ? { websiteUrl: safeWebUrl(server.websiteUrl) } : {}),
    packages: Array.isArray(server.packages)
      ? server.packages.map(normalizePackage).filter((item): item is McpRegistryPackage => Boolean(item))
      : [],
    remotes: Array.isArray(server.remotes)
      ? server.remotes.map(normalizeRemote).filter((item): item is McpRegistryRemote => Boolean(item))
      : [],
  }
}

export class McpRegistryClient {
  private readonly cache = new Map<string, { expiresAt: number; value: McpRegistryPage }>()

  async search(query: string, cursor?: string): Promise<McpRegistryPage> {
    const normalizedQuery = query.trim()
    if (normalizedQuery.length > 120) throw new Error('Registry search query is too long.')
    if (normalizedQuery.length > 0 && [...normalizedQuery].length < 3) {
      throw new Error('Enter at least three characters to search the official registry.')
    }
    if (cursor !== undefined && (cursor.length > 1_024 || /[\r\n]/.test(cursor))) {
      throw new Error('Registry cursor is invalid.')
    }

    const cacheKey = normalizedQuery.toLowerCase() + '|' + (cursor ?? '')
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) return cached.value

    const url = new URL('/v0.1/servers', REGISTRY_BASE_URL)
    url.searchParams.set('limit', String(REGISTRY_PAGE_LIMIT))
    url.searchParams.set('version', 'latest')
    if (normalizedQuery) url.searchParams.set('search', normalizedQuery)
    if (cursor) url.searchParams.set('cursor', cursor)

    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
      redirect: 'error',
    })
    if (!response.ok) throw new Error('Official MCP Registry request failed with HTTP ' + response.status + '.')
    const payload: unknown = await readBoundedJson(response, MAX_REGISTRY_RESPONSE_BYTES)
    if (!isRecord(payload)) throw new Error('Official MCP Registry returned an invalid response.')
    const raw = payload as RegistryRawResponse
    const records = Array.isArray(raw.servers) ? raw.servers : []
    const servers = records
      .map(normalizeServer)
      .filter((item): item is McpRegistryServer => Boolean(item))
      .filter((server) => server.status !== 'deleted')
    const page: McpRegistryPage = {
      servers,
      ...(asString(raw.metadata?.nextCursor, 1_024) ? { nextCursor: asString(raw.metadata?.nextCursor, 1_024) } : {}),
      count: typeof raw.metadata?.count === 'number' && Number.isInteger(raw.metadata.count)
        ? raw.metadata.count
        : servers.length,
    }
    this.cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, value: page })
    if (this.cache.size > 100) this.cache.delete(this.cache.keys().next().value!)
    return page
  }

  async getServer(name: string, version = 'latest'): Promise<McpRegistryServer> {
    if (!name || name.length > 512 || /[\r\n]/.test(name)) throw new Error('Registry server name is invalid.')
    if (!/^[A-Za-z0-9.+_-]+$/.test(version) && version !== 'latest') {
      throw new Error('Registry server version is invalid.')
    }
    const url = new URL(
      '/v0.1/servers/' + encodeURIComponent(name) + '/versions/' + encodeURIComponent(version),
      REGISTRY_BASE_URL,
    )
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(12_000),
      redirect: 'error',
    })
    if (!response.ok) throw new Error('Official MCP Registry detail request failed with HTTP ' + response.status + '.')
    const payload: unknown = await readBoundedJson(response, MAX_SERVER_DETAIL_BYTES)
    if (!isRecord(payload)) throw new Error('Official MCP Registry returned an invalid server record.')
    const raw: RegistryRawRecord = isRecord(payload.server)
      ? { server: payload.server, _meta: isRecord(payload._meta) ? payload._meta : undefined }
      : payload as RegistryRawRecord
    const server = normalizeServer(raw)
    if (!server) throw new Error('Official MCP Registry returned an unsupported server record.')
    return server
  }
}
