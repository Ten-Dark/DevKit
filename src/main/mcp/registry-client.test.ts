import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpRegistryClient } from './registry-client.js'

const activeMetadata = {
  'io.modelcontextprotocol.registry/official': {
    status: 'active',
    publishedAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-02T00:00:00.000Z',
  },
}

function registryResponse(servers: unknown[], nextCursor?: string) {
  return new Response(JSON.stringify({
    servers,
    metadata: { count: servers.length, ...(nextCursor ? { nextCursor } : {}) },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('official MCP Registry client', () => {
  it('normalizes official active records and only marks safe npx stdio packages installable', async () => {
    const fetchMock = vi.fn().mockResolvedValue(registryResponse([
      {
        server: {
          name: 'io.example/filesystem',
          title: 'Filesystem',
          description: 'Manage a local workspace.',
          version: '1.2.3',
          packages: [{
            registryType: 'npm',
            identifier: '@example/filesystem',
            version: '1.2.3',
            runtimeHint: 'npx',
            transport: { type: 'stdio' },
            runtimeArguments: [{ type: 'positional', value: '--yes' }],
          }],
        },
        _meta: activeMetadata,
      },
      {
        server: {
          name: 'io.example/private',
          description: 'Needs a secret.',
          version: '1.0.0',
          packages: [{
            registryType: 'npm',
            identifier: '@example/private',
            version: '1.0.0',
            runtimeHint: 'npx',
            transport: { type: 'stdio' },
            environmentVariables: [{ name: 'API_TOKEN', isRequired: true, isSecret: true }],
          }],
        },
        _meta: activeMetadata,
      },
    ]))
    vi.stubGlobal('fetch', fetchMock)
    const client = new McpRegistryClient()

    const result = await client.search('filesystem')

    expect(result.servers).toHaveLength(2)
    expect(result.servers[0]).toMatchObject({
      name: 'io.example/filesystem',
      title: 'Filesystem',
      status: 'active',
      packages: [{ identifier: '@example/filesystem', canInstallWithNpx: true }],
    })
    expect(result.servers[1].packages[0]).toMatchObject({
      canInstallWithNpx: false,
      installBlockers: ['This server requires environment variables to be configured.'],
      environmentVariables: [{ name: 'API_TOKEN', required: true, secret: true }],
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    const requestedUrl = new URL(fetchMock.mock.calls[0][0] as string | URL)
    expect(requestedUrl.origin).toBe('https://registry.modelcontextprotocol.io')
    expect(requestedUrl.searchParams.get('search')).toBe('filesystem')
    expect(requestedUrl.searchParams.get('version')).toBe('latest')
  })

  it('caches pages briefly and sends the pagination cursor', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(registryResponse([], 'next-page'))
      .mockResolvedValueOnce(registryResponse([]))
    vi.stubGlobal('fetch', fetchMock)
    const client = new McpRegistryClient()

    const first = await client.search('browser')
    const cached = await client.search('browser')
    const next = await client.search('browser', first.nextCursor)

    expect(cached).toEqual(first)
    expect(next).toEqual({ servers: [], count: 0 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const nextUrl = new URL(fetchMock.mock.calls[1][0] as string | URL)
    expect(nextUrl.searchParams.get('cursor')).toBe('next-page')
  })

  it('filters deleted entries and rejects queries shorter than three characters', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(registryResponse([
      {
        server: { name: 'io.example/gone', version: '1.0.0' },
        _meta: { 'io.modelcontextprotocol.registry/official': { status: 'deleted' } },
      },
    ])))
    const client = new McpRegistryClient()

    await expect(client.search('ab')).rejects.toThrow('at least three characters')
    await expect(client.search('gone')).resolves.toMatchObject({ servers: [] })
  })

  it('loads and normalizes a specific Registry server version', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      server: {
        name: 'io.example/filesystem',
        title: 'Filesystem MCP',
        description: 'A specific server version.',
        version: '1.2.3',
        websiteUrl: 'https://example.com/filesystem',
      },
      _meta: activeMetadata,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new McpRegistryClient()

    const result = await client.getServer('io.example/filesystem', '1.2.3')

    expect(result).toMatchObject({
      name: 'io.example/filesystem',
      title: 'Filesystem MCP',
      version: '1.2.3',
      status: 'active',
    })
    const requestedUrl = new URL(fetchMock.mock.calls[0][0] as string | URL)
    expect(requestedUrl.pathname).toBe('/v0.1/servers/io.example%2Ffilesystem/versions/1.2.3')
  })

  it('rejects invalid Registry detail identifiers before making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const client = new McpRegistryClient()

    await expect(client.getServer('', 'latest')).rejects.toThrow('name is invalid')
    await expect(client.getServer('io.example/server', '../latest')).rejects.toThrow('version is invalid')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects Registry responses that exceed the bounded body size', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('[]', {
        status: 200,
        headers: { 'Content-Length': String(2 * 1024 * 1024 + 1) },
      }))
      .mockResolvedValueOnce(new Response('x'.repeat(2 * 1024 * 1024 + 1), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const client = new McpRegistryClient()

    await expect(client.search('calendar')).rejects.toThrow('exceeds the supported size limit')
    await expect(client.search('calendar')).rejects.toThrow('exceeds the supported size limit')
  })

  it('rejects a failing registry response without returning stale data', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 })))
    const client = new McpRegistryClient()
    await expect(client.search('calendar')).rejects.toThrow('HTTP 503')
  })
})
