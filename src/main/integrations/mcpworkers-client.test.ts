import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { SecretProviderRegistry } from '../secrets/secret-provider.js'
import { McpWorkersApiError, McpWorkersClient } from './mcpworkers-client.js'

const token = 'a'.repeat(64)
const reference = {
  providerId: 'keepassxc',
  reference: {
    databasePath: 'C:\\KeePass\\vault.kdbx',
    entryPath: 'Dev Secrets / MCPWorkers / DevKit',
    attribute: 'Password',
  },
}

function response(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: vi.fn().mockReturnValue(null) },
    body: null,
    json: vi.fn().mockResolvedValue(body),
  } as unknown as Response
}

const tempDirectories: string[] = []

async function createClient(fetchImpl: typeof fetch, resolveSecret = token) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'devkit-mcpworkers-'))
  tempDirectories.push(directory)
  const secretProviders = {
    resolve: vi.fn().mockResolvedValue(resolveSecret),
  } as unknown as SecretProviderRegistry
  const secretStore = {
    encrypt: (value: string) => 'encrypted:' + Buffer.from(value).toString('base64'),
    decrypt: (value: string) => Buffer.from(value.slice('encrypted:'.length), 'base64').toString('utf8'),
  }
  return new McpWorkersClient({
    fetchImpl,
    secretProviders,
    storePath: path.join(directory, 'mcpworkers-connection.json'),
    secretStore: secretStore as never,
  })
}

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })))
})

describe('McpWorkersClient', () => {
  it('recognizes the documented API v1 liveness response without authenticating', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, {
      ok: true,
      service: 'mcpworkers',
      apiVersion: 1,
    }))
    const client = await createClient(fetchImpl)

    await expect(client.getHealth()).resolves.toEqual({
      state: 'reachable',
      baseUrl: 'http://127.0.0.1:43127',
      apiVersion: 1,
      detail: 'Manager API is reachable.',
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:43127/v1/health'),
      expect.objectContaining({ method: 'GET', redirect: 'manual' }),
    )
  })

  it('recognizes an incompatible API response without exposing response content', async () => {
    const client = await createClient(vi.fn().mockResolvedValue(response(200, { ok: true, service: 'other', token: 'secret' })))
    await expect(client.getHealth()).resolves.toMatchObject({
      state: 'incompatible',
      detail: 'MCPWorkers API health response is incompatible with API v1.',
    })
  })

  it('classifies a missing health endpoint as incompatible', async () => {
    const client = await createClient(vi.fn().mockResolvedValue(response(404, {})))
    await expect(client.getHealth()).resolves.toMatchObject({ state: 'incompatible' })
  })

  it('rejects redirects and does not follow them', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(302, {}))
    const client = await createClient(fetchImpl)
    await expect(client.getHealth()).resolves.toMatchObject({ state: 'error' })
    expect(fetchImpl).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ redirect: 'manual' }))
  })

  it('returns a sanitized unavailable state for connection failures', async () => {
    const client = await createClient(vi.fn().mockRejectedValue(new Error('ECONNREFUSED secret-token')))
    await expect(client.getHealth()).resolves.toMatchObject({
      state: 'unavailable',
      detail: 'MCPWorkers API is not reachable on the configured loopback address.',
    })
  })

  it('accepts only plain HTTP loopback origins', async () => {
    for (const baseUrl of [
      'https://127.0.0.1:43127',
      'http://localhost:43127',
      'http://192.168.1.10:43127',
      'http://127.0.0.1:43127/path',
      'http://user:pass@127.0.0.1:43127',
    ]) {
      const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'devkit-mcpworkers-url-'))
      tempDirectories.push(directory)
      expect(() => new McpWorkersClient({
        baseUrl,
        secretProviders: {} as SecretProviderRegistry,
        storePath: path.join(directory, 'connection.json'),
      })).toThrow()
    }
  })

  it('authenticates through KeePassXC, persists only an encrypted reference and reads the Registry', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(200, { definitions: [{ id: 'localmcp' }] }))
    const client = await createClient(fetchImpl)

    await expect(client.connect(reference, 'master-password')).resolves.toMatchObject({ state: 'connected' })
    expect(fetchImpl).toHaveBeenCalledWith(
      new URL('http://127.0.0.1:43127/v1/definitions'),
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer ' + token }) }),
    )

    const file = await fs.readFile((client as unknown as { storePath: string }).storePath, 'utf8')
    expect(file).not.toContain(token)
    expect(file).not.toContain('master-password')
    expect(file).toContain('encryptedReference')
  })

  it('restores a saved KeePassXC reference as configured but locked after restart', async () => {
    const first = await createClient(vi.fn().mockResolvedValue(response(200, { definitions: [] })))
    await first.connect(reference, 'master-password')
    const storePath = (first as unknown as { storePath: string }).storePath
    const secretProviders = { resolve: vi.fn().mockResolvedValue(token) } as unknown as SecretProviderRegistry
    const second = new McpWorkersClient({
      secretProviders,
      fetchImpl: vi.fn().mockResolvedValue(response(200, { definitions: [] })),
      storePath,
      secretStore: {
        encrypt: (value: string) => 'encrypted:' + Buffer.from(value).toString('base64'),
        decrypt: (value: string) => Buffer.from(value.slice('encrypted:'.length), 'base64').toString('utf8'),
      } as never,
    })

    await expect(second.getConnectionStatus()).resolves.toMatchObject({ state: 'configured' })
    await expect(second.unlock('master-password')).resolves.toMatchObject({ state: 'connected' })
  })

  it('loads Worker Definitions and Instances only after authentication', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(200, { definitions: [] }))
      .mockResolvedValueOnce(response(200, { definitions: [{ id: 'localmcp', name: 'LocalMCP', definitionVersion: '1.0.0', capabilities: [], platforms: ['win32-x64'], repository: 'private/repo' }] }))
      .mockResolvedValueOnce(response(200, { instances: [{
        instanceId: '00000000-0000-4000-8000-000000000001', definitionId: 'localmcp', installedVersion: '1.0.0',
        enabled: true, runtimeState: 'stopped', healthState: 'unknown', role: 'none', priority: 0,
        verifiedCapabilities: [], lastError: 'secret-error', installRoot: 'C:\\\\Private\\\\Worker', configRef: 'private/config.json',
      }] }))
    const client = await createClient(fetchImpl)
    await expect(client.getSnapshot()).rejects.toThrow(/configured but locked/)
    await client.connect(reference, 'master-password')
    const snapshot = await client.getSnapshot()
    expect(snapshot).toMatchObject({
      definitions: [{ id: 'localmcp', name: 'LocalMCP' }],
      instances: [{ instanceId: '00000000-0000-4000-8000-000000000001' }],
    })
    const serialized = JSON.stringify(snapshot)
    expect(serialized).not.toContain('private/repo')
    expect(serialized).not.toContain('secret-error')
    expect(serialized).not.toContain('C:\\\\Private')
    expect(serialized).not.toContain('private/config.json')
  })

  it('does not expose raw API response content on authorization failures', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(response(403, { error: { code: 'INSUFFICIENT_SCOPE', message: 'raw secret text' } }))
    const client = await createClient(fetchImpl)
    await expect(client.connect(reference, 'master-password')).rejects.toThrow('The DevKit client does not have permission for this MCPWorkers operation.')
  })

  it('rejects malformed or non-KeePassXC secret references before resolving a secret', async () => {
    const client = await createClient(vi.fn())
    await expect(client.connect({ providerId: 'manual', reference: {} }, 'password')).rejects.toThrow(/must be stored in KeePassXC/)
    await expect(client.connect({ providerId: 'keepassxc', reference: { databasePath: 'relative', entryPath: 'x' } }, 'password')).rejects.toThrow(/database and entry paths/)
  })

  it('performs an explicit on-demand Instance health check through API v1', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(200, { definitions: [] }))
      .mockResolvedValueOnce(response(200, { state: 'healthy' }))
    const client = await createClient(fetchImpl)
    await client.connect(reference, 'master-password')
    await expect(client.checkInstanceHealth('00000000-0000-4000-8000-000000000001')).resolves.toEqual({ state: 'healthy' })
    expect(fetchImpl).toHaveBeenLastCalledWith(
      new URL('http://127.0.0.1:43127/v1/instances/00000000-0000-4000-8000-000000000001/health'),
      expect.objectContaining({ method: 'POST', redirect: 'manual' }),
    )
  })

  it('sends explicit lifecycle actions only to the Manager API', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(200, { definitions: [] }))
      .mockResolvedValueOnce(response(200, { action: 'start' }))
    const client = await createClient(fetchImpl)
    await client.connect(reference, 'master-password')
    await expect(client.lifecycle('00000000-0000-4000-8000-000000000001', 'start')).resolves.toEqual({ action: 'start' })
    expect(fetchImpl).toHaveBeenLastCalledWith(
      new URL('http://127.0.0.1:43127/v1/instances/00000000-0000-4000-8000-000000000001/lifecycle'),
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ action: 'start' }) }),
    )
  })

  it('surfaces lifecycle conflicts without exposing the raw Manager response', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(response(200, { definitions: [] }))
      .mockResolvedValueOnce(response(409, { error: { code: 'CONFLICT', message: 'raw manager detail', retryable: false } }))
    const client = await createClient(fetchImpl)
    await client.connect(reference, 'master-password')

    await expect(client.lifecycle('00000000-0000-4000-8000-000000000001', 'start'))
      .rejects.toMatchObject({
        name: 'McpWorkersApiError',
        status: 409,
        code: 'CONFLICT',
        message: 'The Worker state changed or the requested action is not currently allowed. Refresh the Worker list and review its current state before retrying.',
      })
  })

  it('rejects invalid Instance IDs and unsupported lifecycle actions', async () => {
    const client = await createClient(vi.fn())
    await expect(client.checkInstanceHealth('invalid')).rejects.toThrow(/Instance ID is invalid/)
    await expect(client.lifecycle('invalid', 'start')).rejects.toThrow(/Instance ID is invalid/)
  })

  it('keeps startup resilient when saved settings are corrupt and allows explicit replacement', async () => {
    const client = await createClient(vi.fn().mockResolvedValue(response(200, { definitions: [] })))
    const storePath = (client as unknown as { storePath: string }).storePath
    await fs.writeFile(storePath, '{invalid json')
    await expect(client.getConnectionStatus()).resolves.toMatchObject({ state: 'error' })
    await expect(client.connect(reference, 'master-password')).resolves.toMatchObject({ state: 'connected' })
    await expect(client.getConnectionStatus()).resolves.toMatchObject({ state: 'connected' })
  })

  it('disconnects by clearing the in-memory token and saved encrypted reference', async () => {
    const client = await createClient(vi.fn().mockResolvedValue(response(200, { definitions: [] })))
    await client.connect(reference, 'master-password')
    await expect(client.disconnect()).resolves.toBe(true)
    await expect(client.getConnectionStatus()).resolves.toMatchObject({ state: 'disconnected' })
  })
})
