// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import McpLibraryPage from './mcp-library'

const registryServer = {
  name: 'io.example/filesystem',
  title: 'Filesystem MCP',
  description: 'Access files in a selected workspace.',
  version: '1.2.3',
  status: 'active' as const,
  repositoryUrl: 'https://github.com/example/filesystem-mcp',
  packages: [{
    registryType: 'npm',
    identifier: '@example/filesystem',
    version: '1.2.3',
    runtimeHint: 'npx',
    transportType: 'stdio',
    environmentVariables: [],
    packageArguments: [],
    runtimeArguments: [],
    canInstallWithNpx: true,
    installBlockers: [],
  }],
  remotes: [],
}

const savedConnection = {
  id: 'filesystem-01',
  name: 'Filesystem MCP',
  description: 'Access files in a selected workspace.',
  source: 'registry' as const,
  registryName: registryServer.name,
  registryVersion: registryServer.version,
  transportType: 'stdio' as const,
  command: 'npx',
  argumentCount: 2,
  cwd: 'C:\\Projects',
  envKeys: [],
  headerKeys: [],
  state: 'disconnected' as const,
  tools: [],
  createdAt: new Date().toISOString(),
}

let api: {
  mcp: Record<string, ReturnType<typeof vi.fn>>
  integrations: Record<string, ReturnType<typeof vi.fn>>
  openExternal: ReturnType<typeof vi.fn>
}

beforeEach(() => {
  api = {
    mcp: {
      listConnections: vi.fn().mockResolvedValue([]),
      searchRegistry: vi.fn().mockResolvedValue({ servers: [registryServer], count: 1 }),
      getRegistryServer: vi.fn().mockResolvedValue(registryServer),
      addConnection: vi.fn().mockResolvedValue(savedConnection),
      connect: vi.fn().mockResolvedValue({
        ...savedConnection,
        state: 'connected',
        tools: [{ name: 'list_files', description: 'List workspace files.' }],
      }),
      disconnect: vi.fn().mockResolvedValue(savedConnection),
      removeConnection: vi.fn().mockResolvedValue(true),
      selectWorkingDirectory: vi.fn().mockResolvedValue(null),
    },
    integrations: {
      getStatuses: vi.fn().mockResolvedValue({
        projectsRoot: 'C:\\Users\\Sondr\\Projects',
        integrations: [
          { id: 'localmcp', name: 'LocalMCP', state: 'running', description: 'Local MCP bridge.', pid: 20884, canStart: true, canStop: true },
          { id: 'localmcp-tunnel', name: 'LocalMCP Tunnel', state: 'stopped', description: 'Secure Tunnel runtime.', canStart: true, canStop: false },
          { id: 'chat2agent', name: 'Chat2Agent', state: 'running', description: 'DevSpace and ngrok.', pid: 2548, canStart: true, canStop: true },
        ],
      }),
      setProjectsRoot: vi.fn().mockResolvedValue('C:\\Users\\Sondr\\Projects'),
      selectProjectsRoot: vi.fn().mockResolvedValue(null),
      selectMultiAggregatorExecutable: vi.fn().mockResolvedValue('C:\\\\Apps\\\\Multi-AI Aggregator.exe'),
      clearMultiAggregatorExecutable: vi.fn().mockResolvedValue(true),
      start: vi.fn().mockResolvedValue({ id: 'localmcp-tunnel', name: 'LocalMCP Tunnel', state: 'starting', description: 'Tunnel', detail: 'Opened the Tunnel PowerShell window. Unlock KeePassXC there if requested; keep that window open.', canStart: true, canStop: false }),
      stop: vi.fn().mockResolvedValue({ id: 'chat2agent', name: 'Chat2Agent', state: 'stopped', description: 'DevSpace', canStart: true, canStop: false }),
    },
    openExternal: vi.fn(),
  }

  Object.defineProperty(window, 'api', { configurable: true, value: api })
  Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value: vi.fn(() => true) })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('MCP & Integrations page', () => {
  it('renders local service health cards and official Registry results', async () => {
    render(<McpLibraryPage />)

    expect(await screen.findByText('Filesystem MCP')).toBeTruthy()
    expect(screen.getByText('Official MCP Registry')).toBeTruthy()
    expect(screen.getByText('LocalMCP')).toBeTruthy()
    expect(screen.getByText('LocalMCP Tunnel')).toBeTruthy()
    expect(screen.getByText('Chat2Agent')).toBeTruthy()
    expect(screen.getAllByText('External integration')).toHaveLength(3)
    expect(screen.getAllByText('Running')).toHaveLength(2)
    expect(api.mcp.searchRegistry).toHaveBeenCalledWith('')
  })

  it('lets the user configure the Multi-AI Aggregator executable without starting it', async () => {
    api.integrations.getStatuses.mockResolvedValue({
      projectsRoot: 'C:\\\\Users\\\\Sondr\\\\Projects',
      integrations: [
        { id: 'localmcp', name: 'LocalMCP', state: 'running', description: 'Local MCP bridge.', canStart: true, canStop: true },
        { id: 'localmcp-tunnel', name: 'LocalMCP Tunnel', state: 'stopped', description: 'Secure Tunnel runtime.', canStart: true, canStop: false },
        { id: 'chat2agent', name: 'Chat2Agent', state: 'running', description: 'DevSpace and ngrok.', canStart: true, canStop: true },
        { id: 'multiaggregator', name: 'Multi-AI Aggregator', state: 'unavailable', description: 'Desktop AI workspace.', detail: 'Select executable.', canStart: false, canStop: false },
      ],
    })
    render(<McpLibraryPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Configure' }))

    await waitFor(() => expect(api.integrations.selectMultiAggregatorExecutable).toHaveBeenCalledOnce())
    expect(api.integrations.start).not.toHaveBeenCalled()
    expect(await screen.findByText('Multi-AI Aggregator executable configured.')).toBeTruthy()
  })

  it('saves a Registry npm package without starting it', async () => {
    api.mcp.listConnections
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([savedConnection])
    render(<McpLibraryPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Add' }))

    await waitFor(() => expect(api.mcp.addConnection).toHaveBeenCalledOnce())
    expect(api.mcp.addConnection).toHaveBeenCalledWith({
      name: 'Filesystem MCP',
      description: 'Access files in a selected workspace.',
      source: 'registry',
      registryName: 'io.example/filesystem',
      registryVersion: '1.2.3',
      transport: {
        type: 'stdio',
        command: 'npx',
        args: ['--yes', '@example/filesystem@1.2.3'],
        cwd: 'C:\\Users\\Sondr\\Projects',
      },
    })
    expect(api.mcp.connect).not.toHaveBeenCalled()
    expect(await screen.findByText('Saved MCP connections')).toBeTruthy()
    expect(screen.getByText('Filesystem MCP')).toBeTruthy()
  })

  it('connects a saved local MCP through the main-process trust gate and shows its discovered tools', async () => {
    api.mcp.listConnections
      .mockResolvedValueOnce([savedConnection])
      .mockResolvedValueOnce([{
        ...savedConnection,
        state: 'connected',
        tools: [{ name: 'list_files', description: 'List workspace files.' }],
      }])
    render(<McpLibraryPage />)

    fireEvent.click(await screen.findByRole('button', { name: /My MCPs/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Connect' }))

    await waitFor(() => expect(api.mcp.connect).toHaveBeenCalledWith('filesystem-01'))
    expect(window.confirm).not.toHaveBeenCalled()
    expect(await screen.findByText('Connected')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Tools (1)' }))
    expect(screen.getByText('list_files')).toBeTruthy()
    expect(screen.getByText('List workspace files.')).toBeTruthy()
  })

  it('starts a local integration through its lifecycle handler', async () => {
    render(<McpLibraryPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Start' }))

    await waitFor(() => expect(api.integrations.start).toHaveBeenCalledWith('localmcp-tunnel'))
    expect(await screen.findByText('Starting')).toBeTruthy()
  })

  it('searches the Registry, follows pagination, and appends the next page', async () => {
    const githubServer = { ...registryServer, name: 'io.example/github', title: 'GitHub MCP' }
    const databaseServer = { ...registryServer, name: 'io.example/database', title: 'Database MCP' }
    api.mcp.searchRegistry
      .mockResolvedValueOnce({ servers: [registryServer], count: 1, nextCursor: 'initial-cursor' })
      .mockResolvedValueOnce({ servers: [githubServer], count: 2, nextCursor: 'next-cursor' })
      .mockResolvedValueOnce({ servers: [databaseServer], count: 2 })

    render(<McpLibraryPage />)
    expect(await screen.findByText('Filesystem MCP')).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('Search servers — e.g. filesystem, github, database'), {
      target: { value: 'github' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))

    expect(await screen.findByText('GitHub MCP')).toBeTruthy()
    expect(api.mcp.searchRegistry).toHaveBeenNthCalledWith(2, 'github', undefined)

    fireEvent.click(await screen.findByRole('button', { name: 'Load more' }))
    expect(await screen.findByText('Database MCP')).toBeTruthy()
    expect(api.mcp.searchRegistry).toHaveBeenNthCalledWith(3, 'github', 'next-cursor')
    expect(screen.getAllByText('Access files in a selected workspace.')).toHaveLength(2)
    expect(screen.getAllByText('1.2.3')).toHaveLength(2)
  })

  it('surfaces official Registry request errors without hiding the page', async () => {
    api.mcp.searchRegistry.mockRejectedValueOnce(new Error('Registry service unavailable'))
    render(<McpLibraryPage />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Registry service unavailable')
    expect(screen.getByText('Official MCP Registry')).toBeTruthy()
  })

  it('keeps Registry controls usable while external service status is pending', async () => {
    api.integrations.getStatuses.mockReturnValue(new Promise(() => undefined))
    render(<McpLibraryPage />)

    expect(await screen.findByText('Filesystem MCP')).toBeTruthy()
    expect(screen.getByPlaceholderText('Search servers — e.g. filesystem, github, database')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Search' })).toBeTruthy()
  })
})
