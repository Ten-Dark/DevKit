// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ServicesPage from './services'

const service = {
  id: 'local-api',
  name: 'Local API',
  version: '1.0.0',
  adapterId: 'process.local',
  owner: { kind: 'managed', resourceId: 'local-api' },
  capabilities: ['status', 'health', 'start', 'stop', 'restart', 'logs'],
  platforms: ['win32'],
  dependencies: [],
  config: {
    executablePath: 'C:\\Tools\\node.exe',
    workingDirectory: 'C:\\Projects\\api',
    args: ['server.js'],
  },
}

const stoppedItem = {
  service,
  snapshot: {
    serviceId: service.id,
    state: 'stopped',
    process: { state: 'absent', observedAt: new Date().toISOString(), identityVerified: false },
    healthChecks: [],
    observedAt: new Date().toISOString(),
  },
}

const runningItem = {
  service,
  snapshot: {
    ...stoppedItem.snapshot,
    state: 'running',
    process: { state: 'present', pid: 1234, observedAt: new Date().toISOString(), identityVerified: true },
  },
}

let runtimeApi: Record<string, ReturnType<typeof vi.fn>>
let mcpWorkersApi: Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  runtimeApi = {
    listServices: vi.fn().mockResolvedValue([]),
    getServiceDetails: vi.fn().mockResolvedValue({
      service,
      snapshot: runningItem.snapshot,
      dependencies: [],
      dependents: [],
      recentEvents: [],
    }),
    getStartPlan: vi.fn().mockResolvedValue({
      targetServiceId: service.id,
      order: [service.id],
      toStart: [service.id],
      alreadyReady: [],
      shutdownOrder: [service.id],
      blockers: [],
      warnings: [],
      canExecute: true,
    }),
    registerService: vi.fn().mockResolvedValue(service),
    executeStartPlan: vi.fn().mockResolvedValue({
      startedServiceIds: [service.id],
      services: [runningItem],
    }),
    stopService: vi.fn().mockResolvedValue(stoppedItem.snapshot),
    restartService: vi.fn().mockResolvedValue(runningItem.snapshot),
    acknowledgeUnobservableStopped: vi.fn().mockResolvedValue(stoppedItem.snapshot),
    unregisterService: vi.fn().mockResolvedValue(true),
    getRecentEvents: vi.fn().mockResolvedValue([]),
    selectExecutable: vi.fn().mockResolvedValue(null),
    selectWorkingDirectory: vi.fn().mockResolvedValue(null),
  }
  mcpWorkersApi = {
    getConnectionStatus: vi.fn().mockResolvedValue({ state: 'disconnected', baseUrl: 'http://127.0.0.1:43127', detail: 'No MCPWorkers client credential is configured.' }),
    getSnapshot: vi.fn().mockResolvedValue({ definitions: [], instances: [] }),
    connect: vi.fn().mockResolvedValue({ state: 'connected', baseUrl: 'http://127.0.0.1:43127', clientId: 'devkit', detail: 'Authenticated with MCPWorkers API v1.' }),
    unlock: vi.fn().mockResolvedValue({ state: 'connected', baseUrl: 'http://127.0.0.1:43127', clientId: 'devkit', detail: 'Authenticated with MCPWorkers API v1.' }),
    disconnect: vi.fn().mockResolvedValue(true),
    checkHealth: vi.fn().mockResolvedValue({ state: 'healthy' }),
    lifecycle: vi.fn().mockResolvedValue({}),
    selectKeePassDatabase: vi.fn().mockResolvedValue('C:\\KeePass\\vault.kdbx'),
    getHealth: vi.fn().mockResolvedValue({
      state: 'reachable',
      baseUrl: 'http://127.0.0.1:43127',
      apiVersion: 1,
      detail: 'Manager API is reachable.',
    }),
    getManagerRuntimeStatus: vi.fn().mockResolvedValue({
      dataRoot: null,
      runtime: { state: 'external', ownership: 'external', detail: 'A compatible external Manager is attached.' },
    }),
    selectManagerDataRoot: vi.fn().mockResolvedValue(null),
    startManager: vi.fn().mockResolvedValue({
      state: 'external', ownership: 'external', detail: 'A compatible external Manager is attached.',
    }),
    stopManager: vi.fn().mockResolvedValue({
      state: 'external', ownership: 'external', detail: 'External Manager remains running.',
    }),
  }
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { runtime: runtimeApi, mcpWorkers: mcpWorkersApi },

  })
  Object.defineProperty(window, 'confirm', { configurable: true, writable: true, value: vi.fn(() => true) })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('Services page', () => {
  it('renders an empty state when no services are registered', async () => {
    render(<ServicesPage />)
    expect(await screen.findByText('No services registered yet.')).toBeTruthy()
    expect(screen.getByText(/Register a local executable/)).toBeTruthy()
  })

  it('shows MCPWorkers API liveness without claiming authenticated connection', async () => {
    render(<ServicesPage />)
    expect(await screen.findByText('API v1 reachable')).toBeTruthy()
    expect(screen.getByText(/No MCPWorkers client credential is configured/)).toBeTruthy()
    expect(mcpWorkersApi.getHealth).toHaveBeenCalledOnce()
  })

  it('shows external Manager ownership and never offers to stop an external process', async () => {
    render(<ServicesPage />)
    expect(await screen.findByText(/Runtime ownership: External — attached/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Shutdown DevKit-owned' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/DevKit never stops an externally owned Manager/)).toBeTruthy()
  })

  it('selects a KeePassXC database through the native picker and keeps the master password out of Renderer IPC', async () => {
    render(<ServicesPage />)
    const connect = await screen.findByRole('button', { name: 'Connect in secure prompt' })
    expect((connect as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByText('Browse'))
    await waitFor(() => expect(mcpWorkersApi.selectKeePassDatabase).toHaveBeenCalledOnce())
    fireEvent.change(screen.getByPlaceholderText('Group / Entry name'), { target: { value: 'Dev Secrets / MCPWorkers / DevKit' } })
    fireEvent.click(connect)
    await waitFor(() => expect(mcpWorkersApi.connect).toHaveBeenCalledWith({
      providerId: 'keepassxc',
      reference: {
        databasePath: 'C:\\KeePass\\vault.kdbx',
        entryPath: 'Dev Secrets / MCPWorkers / DevKit',
        attribute: 'Password',
      },
    }))
    expect(mcpWorkersApi.connect.mock.calls[0]).toHaveLength(1)
  })

  it('clears a saved MCPWorkers reference without stopping any Worker Instance', async () => {
    mcpWorkersApi.getConnectionStatus.mockResolvedValue({ state: 'configured', baseUrl: 'http://127.0.0.1:43127', detail: 'KeePassXC client credential is configured. Unlock to authenticate.' })
    render(<ServicesPage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Clear saved connection' }))
    await waitFor(() => expect(mcpWorkersApi.disconnect).toHaveBeenCalledOnce())
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('No workers will be stopped or changed'))
    expect(mcpWorkersApi.lifecycle).not.toHaveBeenCalled()
  })

  it('runs an explicit Worker health check and reports its result in the visible page status', async () => {
    const instance = {
      instanceId: '00000000-0000-4000-8000-000000000001',
      definitionId: 'localmcp',
      installedVersion: '1.0.0',
      enabled: true,
      runtimeState: 'stopped',
      healthState: 'unknown',
      role: 'none',
      priority: 0,
      verifiedCapabilities: [],
      lastError: null,
    }
    mcpWorkersApi.getConnectionStatus.mockResolvedValue({ state: 'connected', baseUrl: 'http://127.0.0.1:43127', clientId: 'devkit', detail: 'Authenticated with MCPWorkers API v1.' })
    mcpWorkersApi.getSnapshot.mockResolvedValue({ definitions: [{ id: 'localmcp', name: 'LocalMCP', definitionVersion: '1.0.0', capabilities: [], platforms: ['win32-x64'] }], instances: [instance] })
    mcpWorkersApi.checkHealth.mockResolvedValue({
      state: 'degraded',
      checkedAt: '2026-11-28T00:00:00.000Z',
      latencyMs: 42,
      checks: [
        { id: 'local-http-runtime', state: 'unhealthy', message: 'LocalMCP HTTP runtime is missing or unhealthy' },
        { id: 'http-port-ownership', state: 'healthy', message: 'HTTP port is available' },
      ],
    })
    render(<ServicesPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Check health' }))

    await waitFor(() => expect(mcpWorkersApi.checkHealth).toHaveBeenCalledWith(instance.instanceId))
    expect((await screen.findByRole('status')).textContent).toContain('Health check completed for LocalMCP: degraded.')
    expect(screen.getByLabelText('Health check details for LocalMCP').textContent).toContain('LocalMCP HTTP runtime is missing or unhealthy')
    expect(screen.getByLabelText('Health check details for LocalMCP').textContent).toContain('42 ms')
  })

  it('shows health-check API errors inside the affected Worker card', async () => {
    const instance = {
      instanceId: '00000000-0000-4000-8000-000000000001',
      definitionId: 'localmcp-tunnel',
      installedVersion: '1.0.0',
      enabled: true,
      runtimeState: 'stopped',
      healthState: 'unknown',
      role: 'none',
      priority: 0,
      verifiedCapabilities: [],
      lastError: null,
    }
    mcpWorkersApi.getConnectionStatus.mockResolvedValue({ state: 'connected', baseUrl: 'http://127.0.0.1:43127', clientId: 'devkit', detail: 'Authenticated with MCPWorkers API v1.' })
    mcpWorkersApi.getSnapshot.mockResolvedValue({ definitions: [{ id: 'localmcp-tunnel', name: 'LocalMCP Tunnel', definitionVersion: '1.0.0', capabilities: [], platforms: ['win32-x64'] }], instances: [instance] })
    mcpWorkersApi.checkHealth.mockRejectedValue(Object.assign(new Error('MCPWorkers API request failed (HTTP 502).'), { status: 502, code: 'HEALTH_CHECK_FAILED' }))
    render(<ServicesPage />)

    fireEvent.click(await screen.findByRole('button', { name: 'Check health' }))

    const report = await screen.findByLabelText('Health check details for LocalMCP Tunnel')
    expect(report.textContent).toContain('MCPWorkers API request failed (HTTP 502).')
    expect(report.textContent).toContain('HTTP 502 · HEALTH_CHECK_FAILED')
  })


  it('routes explicit Worker lifecycle actions through MCPWorkers after confirmation', async () => {
    const instance = {
      instanceId: '00000000-0000-4000-8000-000000000001',
      definitionId: 'localmcp',
      installedVersion: '1.0.0',
      enabled: true,
      runtimeState: 'stopped',
      healthState: 'unknown',
      role: 'none',
      priority: 0,
      verifiedCapabilities: [],
      lastError: null,
    }
    mcpWorkersApi.getConnectionStatus.mockResolvedValue({ state: 'connected', baseUrl: 'http://127.0.0.1:43127', clientId: 'devkit', detail: 'Authenticated with MCPWorkers API v1.' })
    mcpWorkersApi.getSnapshot.mockResolvedValue({ definitions: [{ id: 'localmcp', name: 'LocalMCP', definitionVersion: '1.0.0', capabilities: [], platforms: ['win32-x64'] }], instances: [instance] })
    render(<ServicesPage />)
    fireEvent.click(await screen.findByRole('button', { name: /Start/ }))
    await waitFor(() => expect(mcpWorkersApi.lifecycle).toHaveBeenCalledWith(instance.instanceId, 'start'))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Start LocalMCP?'))
  })

  it('registers a local process service using the form values', async () => {
    render(<ServicesPage />)
    fireEvent.click(screen.getByRole('button', { name: /Register service/ }))
    expect(screen.getByText(/forcefully terminates the managed process and every process contained in its Job Object/)).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('Local API'), { target: { value: 'Local API' } })
    fireEvent.change(screen.getByPlaceholderText('C:\\Program Files\\...'), { target: { value: 'C:\\Tools\\node.exe' } })
    fireEvent.change(screen.getByPlaceholderText('C:\\Projects\\service'), { target: { value: 'C:\\Projects\\api' } })
    fireEvent.change(screen.getAllByRole('textbox').find((element) => element.tagName === 'TEXTAREA')!, { target: { value: 'server.js\n--port\n4317' } })
    fireEvent.change(screen.getByPlaceholderText('http://127.0.0.1:4317/health'), { target: { value: 'http://127.0.0.1:4317/health' } })

    fireEvent.click(screen.getAllByRole('button', { name: 'Register service' })[1])

    await waitFor(() => expect(runtimeApi.registerService).toHaveBeenCalledTimes(1))
    const definition = runtimeApi.registerService.mock.calls[0][0]
    expect(definition).toMatchObject({
      id: 'local-api',
      name: 'Local API',
      adapterId: 'process.local',
      owner: { kind: 'managed', resourceId: 'local-api' },
      config: {
        executablePath: 'C:\\Tools\\node.exe',
        workingDirectory: 'C:\\Projects\\api',
        args: ['server.js', '--port', '4317'],
      },
      readinessProbe: { url: 'http://127.0.0.1:4317/health' },
    })
  })

  it('labels registered services as Runtime-managed', async () => {
    runtimeApi.listServices.mockResolvedValue([runningItem])
    render(<ServicesPage />)
    expect(await screen.findByText('Runtime-managed')).toBeTruthy()
  })

  it('requires review and confirmation before executing a startup plan', async () => {
    runtimeApi.listServices
      .mockResolvedValueOnce([stoppedItem])
      .mockResolvedValueOnce([runningItem])
    render(<ServicesPage />)

    fireEvent.click(await screen.findByRole('button', { name: /Start/ }))
    expect(await screen.findByText('Review startup plan')).toBeTruthy()
    expect(screen.getByText('Will start')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /Confirm and start/ }))
    await waitFor(() => expect(runtimeApi.executeStartPlan).toHaveBeenCalledWith('local-api', ['local-api']))
    expect(await screen.findByText('Started: local-api.')).toBeTruthy()
  })

  it('stops a running service only after confirmation', async () => {
    runtimeApi.listServices
      .mockResolvedValueOnce([runningItem])
      .mockResolvedValueOnce([stoppedItem])
    render(<ServicesPage />)

    fireEvent.click(await screen.findByRole('button', { name: /Stop/ }))
    await waitFor(() => expect(runtimeApi.stopService).toHaveBeenCalledWith('local-api'))
    expect(window.confirm).toHaveBeenCalled()
  })

  it('restarts a running service only after confirmation', async () => {
    runtimeApi.listServices
      .mockResolvedValueOnce([runningItem])
      .mockResolvedValueOnce([runningItem])
    render(<ServicesPage />)

    fireEvent.click(await screen.findByRole('button', { name: /Restart/ }))
    await waitFor(() => expect(runtimeApi.restartService).toHaveBeenCalledWith('local-api'))
    expect(window.confirm).toHaveBeenCalled()
  })

  it('does not expose lifecycle actions for an unobservable service', async () => {
    const unknownItem = {
      ...stoppedItem,
      snapshot: {
        ...stoppedItem.snapshot,
        state: 'unknown',
        process: { state: 'unobservable', pid: 4321, observedAt: new Date().toISOString(), identityVerified: false },
      },
    }
    runtimeApi.listServices.mockResolvedValue([unknownItem])
    render(<ServicesPage />)

    expect(await screen.findByText('Unobservable')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Start/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Stop/ })).toBeNull()
    expect(screen.getByRole('button', { name: /Confirm process stopped/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Remove/ })).toHaveProperty('disabled', true)
  })

  it('clears stale process ownership only after explicit user confirmation', async () => {
    const unknownItem = {
      ...stoppedItem,
      snapshot: {
        ...stoppedItem.snapshot,
        state: 'unknown',
        process: { state: 'unobservable', pid: 4321, observedAt: new Date().toISOString(), identityVerified: false },
      },
    }
    runtimeApi.listServices
      .mockResolvedValueOnce([unknownItem])
      .mockResolvedValueOnce([stoppedItem])
    render(<ServicesPage />)

    fireEvent.click(await screen.findByRole('button', { name: /Confirm process stopped/ }))
    await waitFor(() => expect(runtimeApi.acknowledgeUnobservableStopped).toHaveBeenCalledWith('local-api'))
    expect(window.confirm).toHaveBeenCalled()
  })

  it('removes only the service registration after confirmation', async () => {
    runtimeApi.listServices
      .mockResolvedValueOnce([stoppedItem])
      .mockResolvedValueOnce([])
    render(<ServicesPage />)

    fireEvent.click(await screen.findByRole('button', { name: /Remove/ }))
    await waitFor(() => expect(runtimeApi.unregisterService).toHaveBeenCalledWith('local-api'))
    expect(window.confirm).toHaveBeenCalled()
  })
})
