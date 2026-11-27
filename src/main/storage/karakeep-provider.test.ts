import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const safeStorageMock = vi.hoisted(() => ({
  isEncryptionAvailable: vi.fn(),
  encryptString: vi.fn(),
  decryptString: vi.fn(),
}))

vi.mock('electron', () => ({ safeStorage: safeStorageMock }))

import { KarakeepStorageProvider } from './karakeep-provider.js'
import { SecretProviderRegistry } from '../secrets/secret-provider.js'

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const testApiKey = 'ak2_' + 'a'.repeat(20) + '_' + 'b'.repeat(32)

const bookmarksPage = {
  bookmarks: [{
    id: 'bookmark_01',
    title: 'DevKit architecture',
    content: { type: 'link', url: 'https://example.com/architecture', description: 'Architecture notes' },
    createdAt: '2026-11-24T10:00:00.000Z',
    modifiedAt: '2026-11-24T10:00:00.000Z',
    archived: false,
    favourited: true,
    tags: [{ name: 'devkit' }, { name: 'architecture' }],
  }],
  nextCursor: 'cursor-page-2',
}


describe('KarakeepStorageProvider', () => {
  let tempDir: string
  let storePath: string
  let provider: KarakeepStorageProvider

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'devkit-karakeep-test-'))
    storePath = path.join(tempDir, 'workspace', 'services', 'karakeep-storage.json')
    provider = new KarakeepStorageProvider(storePath)
    safeStorageMock.isEncryptionAvailable.mockReturnValue(true)
    safeStorageMock.encryptString.mockImplementation((value: string) => Buffer.from('encrypted:' + value))
    safeStorageMock.decryptString.mockImplementation((value: Buffer) => value.toString().replace('encrypted:', ''))
  })

  afterEach(async () => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  it('validates the API key before persisting it with OS-backed encryption', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ bookmarks: [], nextCursor: null }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await provider.connect('http://localhost:3001', 'ak2_' + 'a'.repeat(20) + '_' + 'b'.repeat(32))

    expect(result).toMatchObject({
      id: 'karakeep',
      provider: 'karakeep',
      baseUrl: 'http://localhost:3001',
      state: 'connected',
      capabilities: { list: true, search: true, read: true, write: false, delete: false, sync: false },
    })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, options] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect(String(url)).toBe('http://localhost:3001/api/v1/users/me')
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer ' + testApiKey)

    const persisted = await fs.readFile(storePath, 'utf8')
    expect(persisted).not.toContain(testApiKey)
    expect(persisted).toContain(Buffer.from('encrypted:' + testApiKey).toString('base64'))
  })

  it('lists bookmarks with cursor pagination and normalizes metadata', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ bookmarks: [], nextCursor: null }))
      .mockResolvedValueOnce(jsonResponse(bookmarksPage))
    vi.stubGlobal('fetch', fetchMock)
    await provider.connect('http://localhost:3001', testApiKey)

    const page = await provider.list('cursor-page-1', 25)

    expect(page.nextCursor).toBe('cursor-page-2')
    expect(page.bookmarks[0]).toMatchObject({
      id: 'bookmark_01',
      title: 'DevKit architecture',
      type: 'link',
      url: 'https://example.com/architecture',
      favourited: true,
      tags: ['devkit', 'architecture'],
    })
    const [url] = fetchMock.mock.calls[1] as [URL]
    expect(String(url)).toContain('cursor=cursor-page-1')
    expect(String(url)).toContain('limit=25')
  })

  it('omits bookmark URLs containing embedded credentials', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ bookmarks: [], nextCursor: null }))
      .mockResolvedValueOnce(jsonResponse({
        bookmarks: [{
          id: 'bookmark_credential_url',
          title: 'Credential-bearing link',
          content: { type: 'link', url: 'https://user:password@example.com/private' },
          tags: [],
        }],
        nextCursor: null,
      }))
    vi.stubGlobal('fetch', fetchMock)
    await provider.connect('http://localhost:3001', testApiKey)

    const page = await provider.list()

    expect(page.bookmarks[0].url).toBeUndefined()
  })

  it('searches bookmarks using the official search endpoint and cursor', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ bookmarks: [], nextCursor: null }))
      .mockResolvedValueOnce(jsonResponse(bookmarksPage))
    vi.stubGlobal('fetch', fetchMock)
    await provider.connect('http://localhost:3001', testApiKey)

    const page = await provider.search('architecture', 'cursor-2', 20)

    expect(page.bookmarks).toHaveLength(1)
    const [url] = fetchMock.mock.calls[1] as [URL]
    expect(url.pathname).toBe('/api/v1/bookmarks/search')
    expect(url.searchParams.get('q')).toBe('architecture')
    expect(url.searchParams.get('cursor')).toBe('cursor-2')
    expect(url.searchParams.get('includeContent')).toBe('false')
  })

  it('reads a bookmark content payload without exposing HTML as executable markup', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ bookmarks: [], nextCursor: null }))
      .mockResolvedValueOnce(jsonResponse({
        id: 'bookmark_01',
        title: 'A text note',
        content: { type: 'text', text: 'This is the note body.' },
        createdAt: '2026-11-24T10:00:00.000Z',
        modifiedAt: '2026-11-24T10:00:00.000Z',
        archived: false,
        favourited: false,
        tags: [],
      }))
    vi.stubGlobal('fetch', fetchMock)
    await provider.connect('http://localhost:3001', testApiKey)

    const detail = await provider.readBookmark('bookmark_01')

    expect(detail).toMatchObject({
      id: 'bookmark_01',
      title: 'A text note',
      content: 'This is the note body.',
      contentType: 'text',
    })
    const [url] = fetchMock.mock.calls[1] as [URL]
    expect(url.pathname).toBe('/api/v1/bookmarks/bookmark_01')
    expect(url.searchParams.get('includeContent')).toBe('true')
  })

  it('fails closed for rejected API keys and does not persist invalid credentials', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401))
    vi.stubGlobal('fetch', fetchMock)

    await expect(provider.connect('http://localhost:3001', testApiKey)).rejects.toThrow(/rejected the API key/)
    await expect(fs.access(storePath)).rejects.toThrow()
  })

  it('identifies ak2 authentication failures without exposing the API key', async () => {
    const apiKey = 'ak2_' + 'a'.repeat(20) + '_' + 'b'.repeat(32)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'unauthorized' }, 401))
    vi.stubGlobal('fetch', fetchMock)

    await expect(provider.connect('http://localhost:3001', apiKey)).rejects.toThrow(
      /token was not matched to an active API key/i,
    )
    await expect(fs.access(storePath)).rejects.toThrow()
  })

  it('accepts an authenticated key without User account read or bookmark read permissions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: 'insufficient_scope' }, 403))
    vi.stubGlobal('fetch', fetchMock)

    const result = await provider.connect('http://localhost:3001', testApiKey)

    expect(result.state).toBe('connected')
    const [url] = fetchMock.mock.calls[0] as [URL]
    expect(url.pathname).toBe('/api/v1/users/me')
    expect(await fs.readFile(storePath, 'utf8')).toContain(Buffer.from('encrypted:' + testApiKey).toString('base64'))
  })

  it('reports missing bookmark permission separately from invalid authentication', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ id: 'user_01' }))
      .mockResolvedValueOnce(jsonResponse({ error: 'insufficient_scope' }, 403))
    vi.stubGlobal('fetch', fetchMock)
    await provider.connect('http://localhost:3001', testApiKey)

    await expect(provider.list()).rejects.toThrow(/API key is valid but does not have the permission required/)
  })

  it('rejects insecure remote URLs and malformed credentials before making a request', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(provider.connect('http://example.com', testApiKey)).rejects.toThrow(/must use HTTPS/)
    await expect(provider.connect('http://localhost:3001', 'short')).rejects.toThrow(/API key is invalid/)
    await expect(provider.connect('http://user:pass@localhost:3001', testApiKey)).rejects.toThrow(/must not contain credentials/)
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('restores encrypted configuration and disconnects without deleting remote data', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ bookmarks: [], nextCursor: null }))
    vi.stubGlobal('fetch', fetchMock)
    await provider.connect('http://localhost:3001', testApiKey)

    const restored = new KarakeepStorageProvider(storePath)
    const restoredStatus = await restored.getStatus()
    expect(restoredStatus?.state, restoredStatus?.error).toBe('connected')
    expect(await restored.disconnect()).toBe(true)
    expect(await restored.getStatus()).toBeNull()
  })

  it('rejects oversized API responses', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ bookmarks: [], nextCursor: null }))
      .mockResolvedValueOnce(new Response('x'.repeat(2 * 1024 * 1024 + 1), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await provider.connect('http://localhost:3001', testApiKey)

    await expect(provider.list()).rejects.toThrow(/exceeds the supported size limit/)
  })

  it('trims surrounding whitespace from a KeePassXC secret before sending the Bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 'user_01' }))
    vi.stubGlobal('fetch', fetchMock)
    const registry = new SecretProviderRegistry()
    registry.register({
      id: 'keepassxc',
      getAvailability: async () => ({ available: true }),
      validateReference: async () => undefined,
      resolveSecret: async () => '  ' + testApiKey + '  ',
      getCapabilities: () => ({ availability: true, validation: true, resolve: true }),
    })
    const referencedProvider = new KarakeepStorageProvider(storePath, registry)

    await referencedProvider.connectWithSecretReference('http://localhost:3001', {
      providerId: 'keepassxc',
      reference: { recordId: 'karakeep-entry' },
    })

    const [, options] = fetchMock.mock.calls[0] as [URL, RequestInit]
    expect((options.headers as Record<string, string>).Authorization).toBe('Bearer ' + testApiKey)
  })

  it('persists only a provider reference and resolves the API key through the registry', async () => {
    const fetchMock = vi.fn().mockImplementation(() => jsonResponse({ bookmarks: [], nextCursor: null }))
    vi.stubGlobal('fetch', fetchMock)
    const registry = new SecretProviderRegistry()
    registry.register({
      id: 'keepassxc',
      getAvailability: async () => ({ available: true }),
      validateReference: async () => undefined,
      resolveSecret: async () => testApiKey,
      getCapabilities: () => ({ availability: true, validation: true, resolve: true }),
    })
    const referencedProvider = new KarakeepStorageProvider(storePath, registry)
    const reference = { providerId: 'keepassxc', reference: { recordId: 'karakeep-entry' } }

    await referencedProvider.connectWithSecretReference('http://localhost:3001', reference)

    const persisted = await fs.readFile(storePath, 'utf8')
    expect(persisted).toContain('karakeep-entry')
    expect(persisted).not.toContain(testApiKey)
    expect(JSON.parse(persisted)).not.toHaveProperty('encryptedToken')
    const restored = new KarakeepStorageProvider(storePath, registry)
    const restoredStatus = await restored.getStatus()
    expect(restoredStatus?.state, restoredStatus?.error).toBe('configured')
    expect(restoredStatus?.credentialProvider).toBe('keepassxc')
    await restored.list()
    const verifiedStatus = await restored.getStatus()
    expect(verifiedStatus?.state, verifiedStatus?.error).toBe('connected')
  })
})
