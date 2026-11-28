// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import StoragePage from './storage'

const source = {
  id: 'local-folder' as const,
  name: 'Knowledge',
  rootPath: 'C:\\Users\\Developer\\Knowledge',
  provider: 'filesystem' as const,
  ownership: 'connected' as const,
  state: 'connected' as const,
  capabilities: { list: true, search: true, metadata: true, read: false, write: false, delete: false, sync: false },
  lastCheckedAt: new Date().toISOString(),
}

const fileEntry = {
  id: 'notes/architecture.md',
  name: 'architecture.md',
  kind: 'file' as const,
  sizeBytes: 2048,
  modifiedAt: new Date().toISOString(),
}

const karakeepSource = {
  id: 'karakeep' as const,
  name: 'Karakeep',
  provider: 'karakeep' as const,
  baseUrl: 'http://localhost:3001',
  credentialProvider: 'keepassxc' as const,
  state: 'connected' as const,
  capabilities: { list: true, search: true, metadata: true, read: true, write: false, delete: false, sync: false },
  lastCheckedAt: new Date().toISOString(),
}

const bookmark = {
  id: 'bookmark_01',
  title: 'DevKit architecture',
  type: 'link' as const,
  url: 'https://example.com/architecture',
  description: 'Architecture notes',
  createdAt: new Date().toISOString(),
  archived: false,
  favourited: true,
  tags: ['devkit', 'architecture'],
}

let storageApi: Record<string, any>
let karakeepApi: Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  karakeepApi = {
    getStatus: vi.fn().mockResolvedValue(null),
    connectWithSecretReference: vi.fn().mockResolvedValue(karakeepSource),
    disconnect: vi.fn().mockResolvedValue(true),
  }
  storageApi = {
    getStatus: vi.fn().mockResolvedValue(null),
    selectAndConnect: vi.fn().mockResolvedValue(source),
    disconnect: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockResolvedValue({ source, relativePath: '', entries: [fileEntry], truncated: false }),
    search: vi.fn().mockResolvedValue({ source, query: 'architecture', entries: [fileEntry], truncated: false }),
    getMetadata: vi.fn().mockResolvedValue({ ...fileEntry, sourceId: 'local-folder', relativePath: fileEntry.id }),
    read: vi.fn().mockResolvedValue({
      sourceId: 'obsidian-vault',
      relativePath: fileEntry.id,
      content: '# Architecture preview',
      sizeBytes: 23,
      modifiedAt: new Date().toISOString(),
    }),
    karakeep: karakeepApi,
  }
  Object.defineProperty(window, 'api', { configurable: true, value: { storage: storageApi } })
  Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value: vi.fn(() => true) })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Storage page', () => {
  it('shows disconnected local folder and Karakeep connection options', async () => {
    render(<StoragePage />)
    expect(await screen.findByText('No local folder connected')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Connect with KeePassXC' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Connect with local encryption' })).toBeNull()
    expect(screen.queryByLabelText('Karakeep API key')).toBeNull()
    expect(screen.queryByLabelText('KeePassXC master password')).toBeNull()
    expect(screen.getByText(/separate secure PowerShell prompt/)).toBeTruthy()
  })

  it('checks Karakeep connectivity without requesting or displaying bookmarks', async () => {
    karakeepApi.getStatus.mockResolvedValue(karakeepSource)

    render(<StoragePage />)

    expect(await screen.findAllByText('Connected')).toHaveLength(2)
    expect(screen.getByText(/Connection status only/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Refresh connection' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeTruthy()
    expect(screen.queryByPlaceholderText('Search bookmarks…')).toBeNull()
    expect(screen.queryByText(bookmark.title)).toBeNull()
    expect(karakeepApi).not.toHaveProperty('list')
    expect(karakeepApi).not.toHaveProperty('search')
    expect(karakeepApi).not.toHaveProperty('readBookmark')
  })

  it('does not expose the legacy manual API-key connection flow', () => {
    render(<StoragePage />)
    expect(screen.queryByLabelText('Karakeep API key')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Connect with local encryption' })).toBeNull()
  })

  it('connects Karakeep through KeePassXC without collecting the master password in Renderer', async () => {
    render(<StoragePage />)
    fireEvent.click(screen.getByRole('button', { name: 'Connect with KeePassXC' }))

    await waitFor(() => expect(karakeepApi.connectWithSecretReference).toHaveBeenCalledWith(
      'http://localhost:3001',
      {
        providerId: 'keepassxc',
        reference: {
          databasePath: 'Y:' + String.fromCharCode(92) + 'data' + String.fromCharCode(92) + 'system_cache.dll',
          entryPath: 'Dev Secrets/SSH & APIes/Karakeep',
          attribute: 'Password',
        },
      },
    ))
    expect(karakeepApi).not.toHaveProperty('list')
    expect(karakeepApi).not.toHaveProperty('search')
    expect(karakeepApi).not.toHaveProperty('readBookmark')
  })


  it('refreshes Karakeep connection status without accessing bookmark data', async () => {
    karakeepApi.getStatus.mockResolvedValue(karakeepSource)
    render(<StoragePage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Refresh connection' }))

    await waitFor(() => expect(karakeepApi.getStatus).toHaveBeenCalledTimes(2))
    expect(karakeepApi).not.toHaveProperty('list')
    expect(karakeepApi).not.toHaveProperty('search')
    expect(karakeepApi).not.toHaveProperty('readBookmark')
    expect(screen.queryByText(bookmark.title)).toBeNull()
  })

  it('shows an empty local folder state until a source is connected', async () => {
    render(<StoragePage />)
    expect(await screen.findByText('No local folder connected')).toBeTruthy()
    expect(screen.getByText(/Your files remain in their original location/)).toBeTruthy()
  })

  it('connects a folder and lists only read-only metadata', async () => {
    render(<StoragePage />)
    fireEvent.click(await screen.findByRole('button', { name: /Connect folder/ }))
    expect(await screen.findAllByText('Knowledge')).toHaveLength(2)
    expect(await screen.findByText('architecture.md')).toBeTruthy()
    expect(screen.getByText(/Local folders are metadata-only/)).toBeTruthy()
    expect(storageApi.selectAndConnect).toHaveBeenCalledOnce()
    expect(storageApi.list).toHaveBeenCalledWith('')
  })

  it('searches file names and displays metadata without reading content', async () => {
    storageApi.getStatus.mockResolvedValue(source)
    render(<StoragePage />)
    const searchInput = await screen.findByPlaceholderText('Search file and folder names…')
    fireEvent.change(searchInput, { target: { value: 'architecture' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(await screen.findByText('architecture.md')).toBeTruthy()
    await waitFor(() => expect(storageApi.search).toHaveBeenCalledWith('architecture'))
    fireEvent.click(screen.getByRole('button', { name: /architecture.md/ }))
    expect(await screen.findAllByText('notes/architecture.md')).toHaveLength(2)
    expect(storageApi.getMetadata).toHaveBeenCalledWith('notes/architecture.md')
    expect(storageApi.read).not.toHaveBeenCalled()
  })

  it('previews Markdown notes only when an Obsidian vault advertises read capability', async () => {
    const obsidianSource = {
      ...source,
      id: 'obsidian-vault',
      name: 'Obsidian Vault',
      provider: 'obsidian' as const,
      capabilities: { ...source.capabilities, read: true },
    }
    storageApi.getStatus.mockResolvedValue(obsidianSource)
    storageApi.list.mockResolvedValue({ source: obsidianSource, relativePath: '', entries: [fileEntry], truncated: false })
    storageApi.getMetadata.mockResolvedValue({ ...fileEntry, sourceId: 'obsidian-vault', relativePath: fileEntry.id })

    render(<StoragePage />)
    fireEvent.click(await screen.findByRole('button', { name: /architecture.md/ }))

    expect(await screen.findByText('# Architecture preview')).toBeTruthy()
    expect(storageApi.read).toHaveBeenCalledWith('notes/architecture.md')
    expect(screen.getByText(/Markdown notes up to 256 KiB can be previewed/)).toBeTruthy()
  })

  it('disconnects the local folder reference without touching source files', async () => {
    storageApi.getStatus.mockResolvedValue(source)
    render(<StoragePage />)
    fireEvent.click(await screen.findByRole('button', { name: /Disconnect/ }))
    await waitFor(() => expect(storageApi.disconnect).toHaveBeenCalledOnce())
    expect(window.confirm).toHaveBeenCalled()
    expect(await screen.findByText('Storage folder disconnected. No files were changed.')).toBeTruthy()
  })
})
