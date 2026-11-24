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

let storageApi: Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  storageApi = {
    getStatus: vi.fn().mockResolvedValue(null),
    selectAndConnect: vi.fn().mockResolvedValue(source),
    disconnect: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockResolvedValue({ source, relativePath: '', entries: [fileEntry], truncated: false }),
    search: vi.fn().mockResolvedValue({ source, query: 'architecture', entries: [fileEntry], truncated: false }),
    getMetadata: vi.fn().mockResolvedValue({ ...fileEntry, sourceId: 'local-folder', relativePath: fileEntry.id }),
  }
  Object.defineProperty(window, 'api', { configurable: true, value: { storage: storageApi } })
  Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value: vi.fn(() => true) })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Storage page', () => {
  it('shows an empty state until a source is connected', async () => {
    render(<StoragePage />)
    expect(await screen.findByText('No storage source connected')).toBeTruthy()
    expect(screen.getByText(/Your files remain in their original location/)).toBeTruthy()
  })

  it('connects a folder and lists only read-only metadata', async () => {
    render(<StoragePage />)
    fireEvent.click(await screen.findByRole('button', { name: /Connect folder/ }))
    expect(await screen.findAllByText('Knowledge')).toHaveLength(2)
    expect(await screen.findByText('architecture.md')).toBeTruthy()
    expect(screen.getByText(/Read-only boundary/)).toBeTruthy()
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
  })

  it('disconnects the reference without touching source files', async () => {
    storageApi.getStatus.mockResolvedValue(source)
    render(<StoragePage />)
    fireEvent.click(await screen.findByRole('button', { name: /Disconnect/ }))
    await waitFor(() => expect(storageApi.disconnect).toHaveBeenCalledOnce())
    expect(window.confirm).toHaveBeenCalled()
    expect(await screen.findByText('Storage folder disconnected. No files were changed.')).toBeTruthy()
  })
})
