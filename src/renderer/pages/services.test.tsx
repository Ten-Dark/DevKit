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
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { runtime: runtimeApi },
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

  it('registers a local process service using the form values', async () => {
    render(<ServicesPage />)
    fireEvent.click(screen.getByRole('button', { name: /Register service/ }))
    expect(screen.getByText(/forcefully terminates the managed process and every process contained in its Job Object/)).toBeTruthy()

    fireEvent.change(screen.getByPlaceholderText('Local API'), { target: { value: 'Local API' } })
    fireEvent.change(screen.getByPlaceholderText('C:\\Program Files\\...'), { target: { value: 'C:\\Tools\\node.exe' } })
    fireEvent.change(screen.getByPlaceholderText('C:\\Projects\\service'), { target: { value: 'C:\\Projects\\api' } })
    fireEvent.change(screen.getAllByRole('textbox')[4], { target: { value: 'server.js\n--port\n4317' } })
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
