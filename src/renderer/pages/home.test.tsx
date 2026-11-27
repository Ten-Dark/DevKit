// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import HomePage from './home'
const workspaceApi = {
  runtime: { listServices: vi.fn() },
  mcpWorkers: { getHealth: vi.fn() },

  mcp: { listConnections: vi.fn() },
  storage: { getStatus: vi.fn(), karakeep: { getStatus: vi.fn() } },
}


beforeEach(() => {
  vi.clearAllMocks()
  workspaceApi.runtime.listServices.mockResolvedValue([])
  workspaceApi.mcpWorkers.getHealth.mockResolvedValue({ state: 'unavailable', baseUrl: 'http://127.0.0.1:43127', detail: 'MCPWorkers API is not reachable on the configured loopback address.' })
  workspaceApi.storage.getStatus.mockResolvedValue(null)
  workspaceApi.storage.karakeep.getStatus.mockResolvedValue(null)
  workspaceApi.storage.getStatus.mockResolvedValue(null)
  Object.defineProperty(window, 'api', { configurable: true, value: workspaceApi })
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'api')
})




const defaultProps = {
  favorites: [] as ('project-to-markdown' | 'xmind-to-markdown')[],
  onToggleFavorite: vi.fn(),
  recents: [] as ('project-to-markdown' | 'xmind-to-markdown')[],
  onSelect: vi.fn(),
  onRemoveRecent: vi.fn(),
}

describe('Home workspace overview', () => {
  it('shows live Runtime, integration, MCP, and Storage state and navigates to the relevant hub', async () => {
    workspaceApi.runtime.listServices.mockResolvedValue([
      { service: { id: 'api', name: 'API' }, snapshot: { state: 'running' } },
      { service: { id: 'worker', name: 'Worker' }, snapshot: { state: 'degraded' } },
    ])
    workspaceApi.mcpWorkers.getHealth.mockResolvedValue({
      state: 'reachable',
      baseUrl: 'http://127.0.0.1:43127',
      apiVersion: 1,
      detail: 'Manager API is reachable.',
    })
    workspaceApi.mcp.listConnections.mockResolvedValue([
      { id: 'one', state: 'connected' },
      { id: 'two', state: 'error' },
    ])
    workspaceApi.storage.getStatus.mockResolvedValue({ name: 'Knowledge', state: 'connected' })
    const onSelect = vi.fn()

    render(<HomePage {...defaultProps} onSelect={onSelect} />)

    const servicesCard = await screen.findByRole('button', { name: 'Open Services' })
    const mcpWorkersCard = screen.getByRole('button', { name: 'Open MCPWorkers Manager' })
    const mcpCard = screen.getByRole('button', { name: 'Open MCP connections' })
    const storageCard = screen.getByRole('button', { name: 'Open Storage' })
    expect(servicesCard.textContent).toContain('2')
    expect(servicesCard.textContent).toContain('1 running · 1 degraded')
    expect(mcpWorkersCard.textContent).toContain('API v1')
    expect(mcpWorkersCard.textContent).toContain('Manager reachable')
    expect(mcpCard.textContent).toContain('1 connected · 1 errors')
    expect(storageCard.textContent).toContain('Knowledge · read-only')

    fireEvent.click(servicesCard)
    fireEvent.click(mcpWorkersCard)
    fireEvent.click(mcpCard)
    fireEvent.click(storageCard)
    expect(onSelect).toHaveBeenNthCalledWith(1, 'services')
    expect(onSelect).toHaveBeenNthCalledWith(2, 'services')
    expect(onSelect).toHaveBeenNthCalledWith(3, 'mcp-library')
    expect(onSelect).toHaveBeenNthCalledWith(4, 'storage')
  })

  it('shows unavailable state when one workspace source fails without hiding the others', async () => {
    workspaceApi.runtime.listServices.mockRejectedValue(new Error('Runtime unavailable'))
    workspaceApi.mcpWorkers.getHealth.mockResolvedValue({
      state: 'reachable',
      baseUrl: 'http://127.0.0.1:43127',
      apiVersion: 1,
      detail: 'Manager API is reachable.',
    })
    render(<HomePage {...defaultProps} />)

    expect((await screen.findByRole('status')).textContent).toContain('Some workspace status could not be loaded')
    expect(screen.getByRole('button', { name: 'Open Services' }).textContent).toContain('Unavailable')
    expect(screen.getByRole('button', { name: 'Open MCPWorkers Manager' }).textContent).toContain('API v1')
  })
})
describe('Home favorites', () => {
  it('renders the supplied shared favorite state', () => {
    render(<HomePage {...defaultProps} favorites={['xmind-to-markdown']} />)
    expect(screen.getByRole('button', { name: 'Remove XMind to Markdown from favorites' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add Project to Markdown to favorites' })).toBeTruthy()
  })
  it('adds a tool to favorites through the shared callback', () => {
    const onToggleFavorite = vi.fn()
    render(<HomePage {...defaultProps} onToggleFavorite={onToggleFavorite} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add Project to Markdown to favorites' }))
    expect(onToggleFavorite).toHaveBeenCalledWith('project-to-markdown')
  })
  it('removes a favorite through the shared callback', () => {
    const onToggleFavorite = vi.fn()
    render(<HomePage {...defaultProps} favorites={['project-to-markdown']} onToggleFavorite={onToggleFavorite} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove Project to Markdown from favorites' }))
    expect(onToggleFavorite).toHaveBeenCalledWith('project-to-markdown')
  })
})


  it('opens a featured tool through the shared navigation callback', () => {
    const onSelect = vi.fn()
    render(<HomePage {...defaultProps} onSelect={onSelect} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open Project to Markdown' }))
    expect(onSelect).toHaveBeenCalledWith('project-to-markdown')
  })

describe('Home Recents', () => {
  it('shows an empty state when there are no recent tools', () => {
    render(<HomePage {...defaultProps} />)
    expect(screen.getByTestId('recents-empty')).toBeTruthy()
  })
  it('renders recents in supplied order and opens/removes the selected item', () => {
    const onSelect = vi.fn()
    const onRemoveRecent = vi.fn()
    render(<HomePage {...defaultProps} recents={['xmind-to-markdown', 'project-to-markdown']} onSelect={onSelect} onRemoveRecent={onRemoveRecent} />)
    const items = screen.getByTestId('recents-list').querySelectorAll('article')
    expect(items[0].textContent).toContain('XMind to Markdown')
    expect(items[1].textContent).toContain('Project to Markdown')
    fireEvent.click(within(items[0]).getByRole('button', { name: 'Open XMind to Markdown' }))
    expect(onSelect).toHaveBeenCalledWith('xmind-to-markdown')
    fireEvent.click(screen.getByRole('button', { name: 'Remove XMind to Markdown from recents' }))
    expect(onRemoveRecent).toHaveBeenCalledWith('xmind-to-markdown')
  })
})


describe('Home search', () => {
  it('filters the current catalog by title, description, and category', () => {
    render(<HomePage {...defaultProps} />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tools' }), { target: { value: 'files' } })

    const results = screen.getByTestId('home-search-results')
    expect(results.textContent).toContain('Project to Markdown')
    expect(results.textContent).toContain('XMind to Markdown')
    expect(screen.queryByText('Featured')).toBeNull()
    expect(screen.queryByText('Recent')).toBeNull()
  })

  it('normalizes repeated whitespace, surrounding whitespace, and letter case', () => {
    render(<HomePage {...defaultProps} />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tools' }), { target: { value: '  XMiNd   to   Markdown  ' } })

    expect(screen.getByTestId('home-search-results').textContent).toContain('XMind to Markdown')
    expect(screen.queryByText('Project to Markdown')).toBeNull()
  })

  it('shows a clear empty state when no catalog item matches', () => {
    render(<HomePage {...defaultProps} />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tools' }), { target: { value: 'nonexistent utility' } })

    expect(screen.getByTestId('home-search-empty').textContent).toContain('No tools found.')
    expect(screen.queryByTestId('home-search-results')).toBeNull()
  })

  it('restores Featured and Recents after clearing the query', () => {
    render(<HomePage {...defaultProps} recents={['xmind-to-markdown']} />)
    const search = screen.getByRole('searchbox', { name: 'Search tools' })
    fireEvent.change(search, { target: { value: 'no match' } })
    expect(screen.getByTestId('home-search-empty')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect((screen.getByRole('searchbox', { name: 'Search tools' }) as HTMLInputElement).value).toBe('')
    expect(screen.getByText('Featured')).toBeTruthy()
    expect(screen.getByText('Recent')).toBeTruthy()
    expect(screen.getByTestId('recents-list').textContent).toContain('XMind to Markdown')
  })

  it('opens a matching catalog tool through the shared navigation callback', () => {
    const onSelect = vi.fn()
    render(<HomePage {...defaultProps} onSelect={onSelect} />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tools' }), { target: { value: 'xmind' } })
    fireEvent.click(screen.getByRole('button', { name: 'Open XMind to Markdown' }))

    expect(onSelect).toHaveBeenCalledWith('xmind-to-markdown')
  })

  it('keeps Favorites and Recents callbacks available without mutating them during search', () => {
    const onToggleFavorite = vi.fn()
    const onRemoveRecent = vi.fn()
    render(<HomePage {...defaultProps} favorites={['xmind-to-markdown']} recents={['project-to-markdown']}
      onToggleFavorite={onToggleFavorite} onRemoveRecent={onRemoveRecent} />)
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tools' }), { target: { value: 'xmind' } })

    expect(screen.getByRole('button', { name: 'Remove XMind to Markdown from favorites' })).toBeTruthy()
    expect(onToggleFavorite).not.toHaveBeenCalled()
    expect(onRemoveRecent).not.toHaveBeenCalled()
    expect(screen.queryByTestId('recents-list')).toBeNull()
  })
})
