import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { app } from 'electron'
import { OsSecretStore } from '../security/os-secret-store.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { ManagedStdioClientTransport } from './managed-stdio-transport.js'
import type { WindowsProcessControlProvider } from '../core/windows-process-control-provider.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type {
  McpConnectionInput,
  McpConnectionSummary,
  McpToolSummary,
} from '../../shared/mcp.js'
import { ensureSafeDirectory, resolveWorkspacePaths } from '../workspace.js'

const STORE_SCHEMA_VERSION = 1
const MAX_CONNECTIONS = 100
const MAX_TOOLS = 500
const MAX_ARGS = 128
const MAX_ENV = 64
const MAX_HEADERS = 32

interface StoredConnection {
  id: string
  name: string
  description?: string
  source: McpConnectionInput['source']
  registryName?: string
  registryVersion?: string
  transportType: 'stdio' | 'streamable-http'
  command?: string
  argumentCount?: number
  cwd?: string
  endpointOrigin?: string
  envKeys: string[]
  headerKeys: string[]
  encryptedSecrets?: string
  createdAt: string
}

interface StoreDocument {
  schemaVersion: number
  connections: StoredConnection[]
}

interface ActiveConnection {
  client: Client
  transport: Transport
}

interface PendingConnection {
  client: Client
  promise?: Promise<McpConnectionSummary>
  cancelled: boolean
}

interface McpHubTimeouts {
  connectMs: number
  listToolsMs: number
  cleanupMs: number
}

const DEFAULT_TIMEOUTS: McpHubTimeouts = {
  connectMs: 20_000,
  listToolsMs: 15_000,
  cleanupMs: 5_000,
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + ' timed out after ' + timeoutMs + ' ms.')), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function validateId(value: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(value)
}

function safeText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > maxLength || value.includes('\0')) {
    throw new Error(label + ' is invalid.')
  }
  return value.trim()
}

function validateEnvironment(value: unknown): Record<string, string> {
  if (value === undefined) return {}
  if (!isRecord(value) || Object.keys(value).length > MAX_ENV) throw new Error('Environment must be an object with at most 64 entries.')
  const result: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (!/^[A-Z_][A-Z0-9_]{0,63}$/.test(key)) throw new Error('Invalid environment variable name: ' + key)
    if (typeof raw !== 'string' || raw.length > 4_096 || raw.includes('\0')) throw new Error('Invalid environment value for ' + key + '.')
    result[key] = raw
  }
  return result
}

function validateHeaders(value: unknown): Record<string, string> {
  if (value === undefined) return {}
  if (!isRecord(value) || Object.keys(value).length > MAX_HEADERS) throw new Error('Headers must be an object with at most 32 entries.')
  const result: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (!/^[!#$%&'*+.^_0-9A-Za-z-]{1,128}$/.test(key)) throw new Error('Invalid HTTP header name.')
    if (typeof raw !== 'string' || raw.length > 4_096 || /[\r\n]/.test(raw)) throw new Error('Invalid HTTP header value for ' + key + '.')
    result[key] = raw
  }
  return result
}

function validateRemoteUrl(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('MCP endpoint must be a valid URL.')
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash || url.search) {
    throw new Error('MCP endpoint must use HTTPS (or HTTP on loopback) and cannot contain credentials, query parameters or a fragment. Put tokens in encrypted HTTP headers.')
  }
  const localHosts = new Set(['localhost', '127.0.0.1', '[::1]'])
  if (url.protocol === 'http:' && !localHosts.has(url.hostname.toLowerCase())) {
    throw new Error('Remote MCP endpoints must use HTTPS. HTTP is allowed only for loopback addresses.')
  }
  return url.toString()
}

function isSafeNpmPackageReference(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 256) return false
  const separator = value.lastIndexOf('@')
  if (separator < 1) return false
  const packageName = value.slice(0, separator)
  const packageVersion = value.slice(separator + 1)
  const safePart = (part: string) => /^[a-z0-9][a-z0-9._~-]*$/i.test(part)
  const packageParts = packageName.split('/')
  const safeName = packageName.startsWith('@')
    ? packageParts.length === 2 && safePart(packageParts[0].slice(1)) && safePart(packageParts[1])
    : packageParts.length === 1 && safePart(packageParts[0])
  const safeVersion = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,127}$/.test(packageVersion)
  return safeName && safeVersion
}
export interface McpStdioLaunch {
  command: string
  args: string[]
}

export function resolveStdioLaunch(
  command: string,
  args: string[],
  source: McpConnectionInput['source'],
  platform = process.platform,
  windowsCommandProcessor = process.env.ComSpec || 'cmd.exe',
): McpStdioLaunch {
  if (source !== 'registry') return { command, args: [...args] }
  if (command !== 'npx' || args.length !== 2 || args[0] !== '--yes' || !isSafeNpmPackageReference(args[1])) {
    throw new Error('Stored Registry package command failed validation.')
  }
  if (platform === 'win32') {
    return { command: windowsCommandProcessor, args: ['/d', '/s', '/c', 'npx --yes ' + args[1]] }
  }
  return { command: 'npx', args: [...args] }
}
function sanitizeError(error: unknown, secrets: string[]): string {
  let message = error instanceof Error ? error.message : 'Unknown MCP connection error.'
  for (const secret of secrets.filter(Boolean)) message = message.split(secret).join('[redacted]')
  return message.slice(0, 2_000)
}

function isStoredConnection(value: unknown): value is StoredConnection {
  if (!isRecord(value)) return false
  return typeof value.id === 'string'
    && validateId(value.id)
    && typeof value.name === 'string'
    && value.name.length > 0
    && ['stdio', 'streamable-http'].includes(String(value.transportType))
    && Array.isArray(value.envKeys)
    && value.envKeys.every((key) => typeof key === 'string' && /^[A-Z_][A-Z0-9_]{0,63}$/.test(key))
    && Array.isArray(value.headerKeys)
    && value.headerKeys.every((key) => typeof key === 'string' && /^[!#$%&'*+.^_0-9A-Za-z-]{1,128}$/.test(key))
    && typeof value.createdAt === 'string'
    && (value.encryptedSecrets === undefined || typeof value.encryptedSecrets === 'string')
    && (value.transportType !== 'stdio' || (
      typeof value.command === 'string'
      && typeof value.argumentCount === 'number'
      && Number.isInteger(value.argumentCount)
      && value.argumentCount >= 0
      && value.argumentCount <= MAX_ARGS
      && typeof value.cwd === 'string'
    ))
    && (value.transportType !== 'streamable-http' || typeof value.endpointOrigin === 'string')
}

export class McpHubManager {
  private readonly storePath: string
  private readonly connections = new Map<string, StoredConnection>()
  private readonly active = new Map<string, ActiveConnection>()
  private readonly connecting = new Map<string, PendingConnection>()
  private readonly runtimeState = new Map<string, Pick<McpConnectionSummary, 'state' | 'pid' | 'serverInfo' | 'tools' | 'error' | 'connectedAt'>>()
  private readonly timeouts: McpHubTimeouts
  private readonly secretStore = new OsSecretStore()
  private initialized?: Promise<void>
  private mutationQueue: Promise<void> = Promise.resolve()
  private shuttingDown = false
  private readonly processControlProvider?: WindowsProcessControlProvider

  constructor(
    storePath = path.join(resolveWorkspacePaths().registry, 'mcp-connections.json'),
    timeouts: Partial<McpHubTimeouts> = {},
    processControlProvider?: WindowsProcessControlProvider,
  ) {
    this.storePath = storePath
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...timeouts }
    this.processControlProvider = processControlProvider
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
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('MCP connection store must be a regular file.')
      if (stat.size > 2 * 1024 * 1024) throw new Error('MCP connection store exceeds 2 MiB.')
      raw = await fs.readFile(this.storePath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    const document: unknown = JSON.parse(raw)
    if (!isRecord(document) || document.schemaVersion !== STORE_SCHEMA_VERSION || !Array.isArray(document.connections)
      || document.connections.length > MAX_CONNECTIONS || !document.connections.every(isStoredConnection)) {
      throw new Error('MCP connection store is invalid or uses an unsupported schema.')
    }
    for (const item of document.connections) {
      if (this.connections.has(item.id)) throw new Error('MCP connection store contains duplicate identifiers.')
      this.connections.set(item.id, item)
      this.runtimeState.set(item.id, { state: 'disconnected', tools: [] })
    }
  }

  private async persist(): Promise<void> {
    await ensureSafeDirectory(path.dirname(this.storePath))
    try {
      const stat = await fs.lstat(this.storePath)
      if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('MCP connection store destination must be a regular file.')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const tempPath = this.storePath + '.' + process.pid + '.' + randomUUID() + '.tmp'
    const document: StoreDocument = { schemaVersion: STORE_SCHEMA_VERSION, connections: [...this.connections.values()] }
    try {
      await fs.writeFile(tempPath, JSON.stringify(document, null, 2), { encoding: 'utf8', flag: 'wx' })
      await fs.rename(tempPath, this.storePath)
    } catch (error) {
      await fs.unlink(tempPath).catch(() => undefined)
      throw error
    }
  }

  private encryptSecrets(secrets: Record<string, unknown>): string | undefined {
    const hasSecretValues = Object.values(secrets).some((value) => Array.isArray(value) ? value.length > 0 : isRecord(value) ? Object.keys(value).length > 0 : typeof value === 'string' && value.length > 0)
    if (!hasSecretValues) return undefined
    return this.secretStore.encrypt(JSON.stringify(secrets))
  }

  private decryptSecrets(connection: StoredConnection): { env: Record<string, string>; headers: Record<string, string>; args: string[]; url?: string } {
    if (!connection.encryptedSecrets) return { env: {}, headers: {}, args: [] }
    const parsed: unknown = JSON.parse(this.secretStore.decrypt(connection.encryptedSecrets))
    if (!isRecord(parsed)) throw new Error('Stored MCP credential payload is invalid.')
    const args = Array.isArray(parsed.args) ? parsed.args : []
    if (args.length > MAX_ARGS || args.some((arg) => typeof arg !== 'string' || arg.length > 4_096 || arg.includes('\0'))) {
      throw new Error('Stored MCP process arguments are invalid.')
    }
    const url = typeof parsed.url === 'string' ? validateRemoteUrl(parsed.url) : undefined
    if (connection.transportType === 'streamable-http' && !url) throw new Error('Stored MCP endpoint is missing its encrypted URL.')
    return {
      env: validateEnvironment(parsed.env),
      headers: validateHeaders(parsed.headers),
      args: args as string[],
      ...(url ? { url } : {}),
    }
  }

  private summary(connection: StoredConnection): McpConnectionSummary {
    const state = this.runtimeState.get(connection.id) ?? { state: 'disconnected' as const, tools: [] }
    return {
      id: connection.id,
      name: connection.name,
      ...(connection.description ? { description: connection.description } : {}),
      source: connection.source ?? 'manual',
      ...(connection.registryName ? { registryName: connection.registryName } : {}),
      ...(connection.registryVersion ? { registryVersion: connection.registryVersion } : {}),
      transportType: connection.transportType,
      ...(connection.command ? { command: connection.command } : {}),
      ...(connection.argumentCount !== undefined ? { argumentCount: connection.argumentCount } : {}),
      ...(connection.cwd ? { cwd: connection.cwd } : {}),
      ...(connection.endpointOrigin ? { endpointOrigin: connection.endpointOrigin } : {}),
      envKeys: [...connection.envKeys],
      headerKeys: [...connection.headerKeys],
      createdAt: connection.createdAt,
      ...state,
    }
  }

  async listConnections(): Promise<McpConnectionSummary[]> {
    await this.initialize()
    return [...this.connections.values()].map((connection) => this.summary(connection))
  }

  async addConnection(input: unknown): Promise<McpConnectionSummary> {
    return this.enqueue(async () => {
      await this.initialize()
      if (!isRecord(input)) throw new Error('MCP connection input must be an object.')
      const name = safeText(input.name, 'Connection name', 120)
      const description = input.description === undefined ? undefined : safeText(input.description, 'Description', 2_000)
      const id = input.id === undefined ? randomUUID().replaceAll('-', '').slice(0, 12) : safeText(input.id, 'Connection ID', 64)
      if (!validateId(id)) throw new Error('Connection ID must contain lowercase letters, digits and hyphens.')
      if (this.connections.has(id)) throw new Error('An MCP connection with this ID already exists.')
      if (this.connections.size >= MAX_CONNECTIONS) throw new Error('The MCP connection limit has been reached.')
      const source = input.source === 'registry' || input.source === 'builtin' ? input.source : 'manual'
      const registryName = input.registryName === undefined ? undefined : safeText(input.registryName, 'Registry server name', 512)
      const registryVersion = input.registryVersion === undefined ? undefined : safeText(input.registryVersion, 'Registry version', 128)
      if (!isRecord(input.transport)) throw new Error('MCP transport configuration is required.')

      let stored: StoredConnection
      let secrets: Record<string, unknown>
      if (input.transport.type === 'stdio') {
        const command = safeText(input.transport.command, 'Executable command', 1_024)
        if (/[\r\n]/.test(command)) throw new Error('Executable command contains invalid characters.')
        if (!Array.isArray(input.transport.args) || input.transport.args.length > MAX_ARGS
          || input.transport.args.some((arg) => typeof arg !== 'string' || arg.length > 4_096 || arg.includes('\0'))) {
          throw new Error('Arguments must be an array of at most 128 valid strings.')
        }
        const args = input.transport.args as string[]
        if (source === 'registry') {
          if (!registryName || !registryVersion) throw new Error('Registry server metadata is required for Registry packages.')
          resolveStdioLaunch(command, args, source)
        }
        const cwd = input.transport.cwd === undefined ? process.cwd() : safeText(input.transport.cwd, 'Working directory', 4_096)
        if (!path.isAbsolute(cwd)) throw new Error('Working directory must be an absolute path.')
        const env = validateEnvironment(input.transport.env)
        secrets = { env, args: [...args], headers: {} }
        stored = {
          id, name, ...(description ? { description } : {}), source,
          ...(registryName ? { registryName } : {}), ...(registryVersion ? { registryVersion } : {}),
          transportType: 'stdio', command, argumentCount: args.length, cwd,
          envKeys: Object.keys(env), headerKeys: [], createdAt: new Date().toISOString(),
        }
      } else if (input.transport.type === 'streamable-http') {
        const url = validateRemoteUrl(safeText(input.transport.url, 'MCP endpoint', 2_048))
        const headers = validateHeaders(input.transport.headers)
        secrets = { env: {}, args: [], headers, url }
        stored = {
          id, name, ...(description ? { description } : {}), source,
          ...(registryName ? { registryName } : {}), ...(registryVersion ? { registryVersion } : {}),
          transportType: 'streamable-http', endpointOrigin: new URL(url).origin,
          envKeys: [], headerKeys: Object.keys(headers), createdAt: new Date().toISOString(),
        }
      } else {
        throw new Error('Unsupported MCP transport. Use stdio or streamable HTTP.')
      }

      stored.encryptedSecrets = this.encryptSecrets(secrets)
      this.connections.set(id, stored)
      this.runtimeState.set(id, { state: 'disconnected', tools: [] })
      try {
        await this.persist()
      } catch (error) {
        this.connections.delete(id)
        this.runtimeState.delete(id)
        throw error
      }
      return this.summary(stored)
    })
  }

  async connect(id: string): Promise<McpConnectionSummary> {
    await this.initialize()
    if (!validateId(id)) throw new Error('Invalid MCP connection identifier.')
    const stored = this.connections.get(id)
    if (!stored) throw new Error('MCP connection was not found.')
    if (this.shuttingDown) throw new Error('MCP hub is shutting down.')
    if (this.active.has(id)) return this.summary(stored)

    const existing = this.connecting.get(id)
    if (existing?.promise) return existing.promise

    const pending: PendingConnection = {
      client: new Client({ name: 'devkit', version: app.getVersion() }),
      cancelled: false,
    }
    this.connecting.set(id, pending)
    const operation = this.establishConnection(id, stored, pending)
    pending.promise = operation
    try {
      return await operation
    } finally {
      if (this.connecting.get(id) === pending) this.connecting.delete(id)
    }
  }

  private async establishConnection(
    id: string,
    stored: StoredConnection,
    pending: PendingConnection,
  ): Promise<McpConnectionSummary> {
    const credentials = this.decryptSecrets(stored)
    const secretValues = [...Object.values(credentials.env), ...Object.values(credentials.headers), ...credentials.args, ...(credentials.url ? [credentials.url] : [])]
    const { client } = pending
    let transport: Transport
    if (stored.transportType === 'stdio') {
      const launch = resolveStdioLaunch(stored.command!, credentials.args, stored.source)
      const serverParameters = {
        command: launch.command,
        args: launch.args,
        cwd: stored.cwd,
        env: credentials.env,
        stderr: 'pipe' as const,
      }
      transport = this.processControlProvider
        ? new ManagedStdioClientTransport({ ...launch, cwd: stored.cwd! }, serverParameters, this.processControlProvider, this.timeouts.cleanupMs)
        : new StdioClientTransport(serverParameters)
      const stderr = transport instanceof ManagedStdioClientTransport
        ? transport.stderr
        : (transport as StdioClientTransport).stderr
      // Drain untrusted server diagnostics without logging raw output; it may contain secrets or split them across chunks.
      stderr?.on('data', () => undefined)

    } else {
      transport = new StreamableHTTPClientTransport(new URL(credentials.url!), {
        requestInit: { headers: credentials.headers, redirect: 'error' },
      })
    }

    this.runtimeState.set(id, { state: 'error', tools: [], error: 'Connecting…' })
    try {
      await withTimeout(client.connect(transport), this.timeouts.connectMs, 'MCP connection')
      const result = await withTimeout(client.listTools(), this.timeouts.listToolsMs, 'MCP tool discovery')
      const tools: McpToolSummary[] = result.tools.slice(0, MAX_TOOLS).map((tool) => ({
        name: String(tool.name).slice(0, 256),
        ...(typeof tool.description === 'string' ? { description: tool.description.slice(0, 2_000) } : {}),
      }))
      if (pending.cancelled || this.shuttingDown) {
        await withTimeout(client.close(), this.timeouts.cleanupMs, 'MCP connection cleanup').catch(() => undefined)
        this.runtimeState.set(id, { state: 'disconnected', tools: [] })
        return this.summary(stored)
      }

      const serverInfo = client.getServerVersion()
      this.active.set(id, { client, transport })
      const state = {
        state: 'connected' as const,
        ...((transport instanceof StdioClientTransport || transport instanceof ManagedStdioClientTransport) && transport.pid
          ? { pid: transport.pid }
          : {}),
        ...(serverInfo ? { serverInfo: { name: serverInfo.name, version: serverInfo.version } } : {}),
        tools,
        connectedAt: new Date().toISOString(),
      }
      this.runtimeState.set(id, state)
      transport.onclose = () => {
        this.active.delete(id)
        this.runtimeState.set(id, { state: 'disconnected', tools })
      }
      transport.onerror = (error: Error) => {
        this.runtimeState.set(id, { state: 'error', tools, error: sanitizeError(error, secretValues) })
      }
      return this.summary(stored)
    } catch (error) {
      await withTimeout(client.close(), this.timeouts.cleanupMs, 'MCP connection cleanup').catch(() => undefined)
      const message = sanitizeError(error, secretValues)
      this.runtimeState.set(id, pending.cancelled || this.shuttingDown
        ? { state: 'disconnected', tools: [] }
        : { state: 'error', tools: [], error: message })
      return this.summary(stored)
    }
  }

  async disconnect(id: string): Promise<McpConnectionSummary> {
    await this.initialize()
    if (!validateId(id)) throw new Error('Invalid MCP connection identifier.')
    const stored = this.connections.get(id)
    if (!stored) throw new Error('MCP connection was not found.')

    const pending = this.connecting.get(id)
    if (pending) {
      pending.cancelled = true
      await withTimeout(pending.client.close(), this.timeouts.cleanupMs, 'MCP disconnect cleanup').catch(() => undefined)
      await pending.promise?.catch(() => undefined)
    }

    const active = this.active.get(id)
    if (active) {
      this.active.delete(id)
      await withTimeout(active.client.close(), this.timeouts.cleanupMs, 'MCP disconnect cleanup').catch(() => undefined)
    }
    this.runtimeState.set(id, { state: 'disconnected', tools: [] })
    return this.summary(stored)
  }

  async removeConnection(id: string): Promise<boolean> {
    return this.enqueue(async () => {
      await this.initialize()
      if (!validateId(id)) throw new Error('Invalid MCP connection identifier.')
      if (this.active.has(id) || this.connecting.has(id)) {
        throw new Error('Disconnect this MCP server before removing it.')
      }
      const existed = this.connections.delete(id)
      this.runtimeState.delete(id)
      if (existed) await this.persist()
      return existed
    })
  }

  async closeAll(): Promise<void> {
    await this.initialize()
    this.shuttingDown = true

    const pending = [...this.connecting.values()]
    for (const connection of pending) connection.cancelled = true
    await Promise.allSettled(pending.map(({ client }) =>
      withTimeout(client.close(), this.timeouts.cleanupMs, 'MCP shutdown cleanup'),
    ))
    await Promise.allSettled(pending.map(({ promise }) => promise ?? Promise.resolve()))

    const active = [...this.active.values()]
    this.active.clear()
    await Promise.allSettled(active.map(({ client }) =>
      withTimeout(client.close(), this.timeouts.cleanupMs, 'MCP shutdown cleanup'),
    ))
    for (const id of this.connections.keys()) this.runtimeState.set(id, { state: 'disconnected', tools: [] })
  }
}
