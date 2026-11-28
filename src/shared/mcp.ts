export type McpTransportType = 'stdio' | 'streamable-http'
export type McpConnectionSource = 'manual' | 'registry' | 'builtin'
export type McpConnectionState = 'connected' | 'disconnected' | 'error'

export interface McpToolSummary {
  name: string
  description?: string
}

export interface McpConnectionInput {
  id?: string
  name: string
  description?: string
  source?: McpConnectionSource
  registryName?: string
  registryVersion?: string
  transport:
    | {
        type: 'stdio'
        command: string
        args: string[]
        cwd?: string
        env?: Record<string, string>
      }
    | {
        type: 'streamable-http'
        url: string
        headers?: Record<string, string>
      }
}

export interface McpConnectionSummary {
  id: string
  name: string
  description?: string
  source: McpConnectionSource
  registryName?: string
  registryVersion?: string
  transportType: McpTransportType
  command?: string
  argumentCount?: number
  cwd?: string
  endpointOrigin?: string
  envKeys: string[]
  headerKeys: string[]
  state: McpConnectionState
  pid?: number
  serverInfo?: { name: string; version: string }
  tools: McpToolSummary[]
  error?: string
  connectedAt?: string
  createdAt: string
}

export interface McpRegistryPackage {
  registryType: string
  identifier: string
  version: string
  runtimeHint?: string
  transportType: string
  environmentVariables: Array<{
    name: string
    description?: string
    required: boolean
    secret: boolean
    defaultValue?: string
  }>
  packageArguments: Array<{
    name?: string
    description?: string
    type: string
    required: boolean
    value?: string
    defaultValue?: string
    format?: string
  }>
  runtimeArguments: Array<{
    type: string
    value?: string
    name?: string
    required: boolean
  }>
  canInstallWithNpx: boolean
  installBlockers: string[]
}

export interface McpRegistryRemote {
  type: string
  url: string
  requiresAuth: boolean
  headers: Array<{ name: string; description?: string; required: boolean; secret: boolean }>
}

export interface McpRegistryServer {
  name: string
  title?: string
  description: string
  version: string
  status: 'active' | 'deprecated' | 'deleted' | 'unknown'
  publishedAt?: string
  updatedAt?: string
  repositoryUrl?: string
  websiteUrl?: string
  packages: McpRegistryPackage[]
  remotes: McpRegistryRemote[]
}

export interface McpRegistryPage {
  servers: McpRegistryServer[]
  nextCursor?: string
  count: number
}
