import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Activity, AlertCircle, CheckCircle2, ChevronDown, ChevronRight, CircleStop, Play, Plus, RefreshCw, Server, Trash2 } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Card, CardBody, CardTitle } from '../components/ui/card'
import { PageHeader } from '../components/page-header'
import type { ServiceDefinition, ServiceRuntimeSnapshot } from '../../main/core/contracts'
import type { DependencyPlan } from '../../main/core/dependency-engine'
import type { RuntimeServiceDetails, RuntimeServiceItem } from '../../main/core/runtime-core'
import type { McpWorkersConnectionStatus, McpWorkersHealthStatus, McpWorkersInstance, McpWorkersSnapshot } from '../../main/integrations/mcpworkers-client.js'
import type { SecretProviderEntry } from '../../main/secrets/secret-provider.js'
import type { McpWorkersManagerRuntimeState } from '../../main/integrations/mcpworkers-manager-runtime.js'

type McpWorkersHealthCheckResult = {

  state: string
  checkedAt?: string
  latencyMs?: number
  failureClass?: string
  checks?: Array<{ id: string; state: string; message: string }>
  error?: string
  httpStatus?: number
  errorCode?: string
}


interface ServiceFormState {
  name: string
  id: string
  executablePath: string
  workingDirectory: string
  args: string
  readinessUrl: string
  dependencies: string
}

const EMPTY_FORM: ServiceFormState = {
  name: '',
  id: '',
  executablePath: '',
  workingDirectory: '',
  args: '',
  readinessUrl: '',
  dependencies: '',
}

function slugify(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)
}

function stateLabel(state: ServiceRuntimeSnapshot['state']): string {
  return {
    running: 'Running',
    stopped: 'Stopped',
    failed: 'Exited',
    degraded: 'Degraded',
    unknown: 'Unobservable',
  }[state]
}

function ServiceState({ state }: { state: ServiceRuntimeSnapshot['state'] }) {
  return <span className={'service-state service-state-' + state}>{stateLabel(state)}</span>
}

function FormField({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="service-form-field">
      <span className="service-form-label">{label}</span>
      {children}
      {hint && <span className="service-form-hint">{hint}</span>}
    </label>
  )
}

export default function ServicesPage() {
  const [services, setServices] = useState<RuntimeServiceItem[]>([])
  const [mcpWorkersHealth, setMcpWorkersHealth] = useState<McpWorkersHealthStatus | null>(null)
  const [mcpWorkersStatus, setMcpWorkersStatus] = useState<McpWorkersConnectionStatus | null>(null)
  const [mcpWorkersSnapshot, setMcpWorkersSnapshot] = useState<McpWorkersSnapshot | null>(null)
  const [mcpWorkersBusy, setMcpWorkersBusy] = useState(false)
  const [mcpWorkersHealthCheckingId, setMcpWorkersHealthCheckingId] = useState<string | null>(null)
  const [mcpWorkersCheckResults, setMcpWorkersCheckResults] = useState<Record<string, McpWorkersHealthCheckResult>>({})
  const [mcpWorkersRuntimeStatus, setMcpWorkersRuntimeStatus] = useState<{ dataRoot: string | null; runtime: McpWorkersManagerRuntimeState } | null>(null)
  const [mcpWorkersRuntimeBusy, setMcpWorkersRuntimeBusy] = useState(false)
  const [keepassDatabasePath, setKeepassDatabasePath] = useState('')
  const [keepassEntryPath, setKeepassEntryPath] = useState('')
  const [keepassEntries, setKeepassEntries] = useState<SecretProviderEntry[]>([])
  const [keepassEntriesLoading, setKeepassEntriesLoading] = useState(false)

  const [loading, setLoading] = useState(true)
  const [busyServiceId, setBusyServiceId] = useState<string | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState<ServiceFormState>(EMPTY_FORM)
  const [pendingPlan, setPendingPlan] = useState<{ serviceId: string; plan: DependencyPlan } | null>(null)
  const [details, setDetails] = useState<RuntimeServiceDetails | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    const [servicesResult, mcpWorkersResult, managerRuntimeResult] = await Promise.allSettled([
      window.api.runtime.listServices(),
      window.api.mcpWorkers.getHealth(),
      window.api.mcpWorkers.getManagerRuntimeStatus(),
    ])
    if (servicesResult.status === 'fulfilled') {
      setServices(servicesResult.value)
      setError(null)
    } else {
      setError(servicesResult.reason instanceof Error ? servicesResult.reason.message : 'Could not load registered services.')
    }
    if (mcpWorkersResult.status === 'fulfilled') {
      setMcpWorkersHealth(mcpWorkersResult.value)
    } else {
      setMcpWorkersHealth({
        state: 'error',
        baseUrl: 'http://127.0.0.1:43127',
        detail: 'Could not query the MCPWorkers Manager API.',
      })
    }
    if (managerRuntimeResult.status === 'fulfilled') {
      setMcpWorkersRuntimeStatus(managerRuntimeResult.value)
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    window.api.runtime.listServices().then((result) => {
      if (!cancelled) setServices(result)
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load registered services.')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    let cancelled = false
    window.api.mcpWorkers.getManagerRuntimeStatus().then((result) => {
      if (!cancelled) setMcpWorkersRuntimeStatus(result)
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    window.api.mcpWorkers.getHealth().then((result) => {
      if (!cancelled) setMcpWorkersHealth(result)
    }).catch(() => {
      if (!cancelled) setMcpWorkersHealth({
        state: 'error',
        baseUrl: 'http://127.0.0.1:43127',
        detail: 'Could not query the MCPWorkers Manager API.',
      })
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    window.api.mcpWorkers.getConnectionStatus().then((status) => {
      if (!cancelled) {
        setMcpWorkersStatus(status)
        if (status.state === 'connected') {
          window.api.mcpWorkers.getSnapshot().then((snapshot) => {
            if (!cancelled) setMcpWorkersSnapshot(snapshot)
          }).catch(() => undefined)
        }
      }
    }).catch(() => undefined)
    return () => { cancelled = true }
  }, [])

  const refreshMcpWorkers = useCallback(async () => {
    const [health, status, runtimeStatus] = await Promise.all([
      window.api.mcpWorkers.getHealth(),
      window.api.mcpWorkers.getConnectionStatus(),
      window.api.mcpWorkers.getManagerRuntimeStatus(),
    ])
    setMcpWorkersHealth(health)
    setMcpWorkersStatus(status)
    setMcpWorkersRuntimeStatus(runtimeStatus)
    if (status.state === 'connected') {
      setMcpWorkersSnapshot(await window.api.mcpWorkers.getSnapshot())
    } else {
      setMcpWorkersSnapshot(null)
    }
  }, [])

  const selectMcpWorkersDataRoot = async () => {
    setMcpWorkersRuntimeBusy(true)
    setError(null)
    try {
      const result = await window.api.mcpWorkers.selectManagerDataRoot()
      if (result) {
        setMcpWorkersRuntimeStatus(result)
        setNotice('MCPWorkers data directory saved. Start or connect the Manager when ready.')
      }
      await refreshMcpWorkers()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not configure the MCPWorkers data directory.')
    } finally {
      setMcpWorkersRuntimeBusy(false)
    }
  }

  const startMcpWorkersManager = async () => {
    setMcpWorkersRuntimeBusy(true)
    setError(null)
    try {
      const runtime = await window.api.mcpWorkers.startManager()
      setMcpWorkersRuntimeStatus((current) => current ? { ...current, runtime } : { dataRoot: null, runtime })
      await refreshMcpWorkers()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start or attach to MCPWorkers Manager.')
    } finally {
      setMcpWorkersRuntimeBusy(false)
    }
  }

  const stopMcpWorkersManager = async () => {
    if (mcpWorkersRuntimeStatus?.runtime.state !== 'managed') return
    if (!window.confirm('Stop the DevKit-managed MCPWorkers Manager? An externally owned Manager will never be stopped.')) return
    setMcpWorkersRuntimeBusy(true)
    setError(null)
    try {
      const runtime = await window.api.mcpWorkers.stopManager()
      setMcpWorkersRuntimeStatus((current) => current ? { ...current, runtime } : { dataRoot: null, runtime })
      await refreshMcpWorkers()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not stop the DevKit-managed MCPWorkers Manager.')
    } finally {
      setMcpWorkersRuntimeBusy(false)
    }
  }

  const selectKeePassDatabase = async () => {
    try {
      const selected = await window.api.mcpWorkers.selectKeePassDatabase()
      if (!selected) return
      setKeepassDatabasePath(selected)
      setKeepassEntryPath('')
      setKeepassEntries([])
      setKeepassEntriesLoading(true)
      setError(null)
      try {
        const entries = await window.api.mcpWorkers.listKeePassEntries(selected)
        setKeepassEntries(entries)
        if (entries.length === 0) setError('No entries were found in the selected KeePassXC database.')
      } finally {
        setKeepassEntriesLoading(false)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load KeePassXC entries.')
    }
  }

  const connectMcpWorkers = async () => {
    setMcpWorkersBusy(true)
    setError(null)
    try {
      const status = await window.api.mcpWorkers.connect({
        providerId: 'keepassxc',
        reference: { databasePath: keepassDatabasePath, entryPath: keepassEntryPath, attribute: 'Password' },
      })
      setMcpWorkersStatus(status)

      await refreshMcpWorkers()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not authenticate with MCPWorkers.')
    } finally {

      setMcpWorkersBusy(false)
    }
  }

  const unlockMcpWorkers = async () => {
    setMcpWorkersBusy(true)
    setError(null)
    try {
      const status = await window.api.mcpWorkers.unlock()
      setMcpWorkersStatus(status)

      await refreshMcpWorkers()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not unlock MCPWorkers credentials.')
    } finally {

      setMcpWorkersBusy(false)
    }
  }

  const disconnectMcpWorkers = async () => {
    if (!window.confirm('Disconnect DevKit from MCPWorkers? No workers will be stopped or changed.')) return
    setMcpWorkersBusy(true)
    try {
      await window.api.mcpWorkers.disconnect()
      setMcpWorkersStatus({ state: 'disconnected', baseUrl: 'http://127.0.0.1:43127', detail: 'No MCPWorkers client credential is configured.' })
      setMcpWorkersSnapshot(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not disconnect MCPWorkers.')
    } finally {
      setMcpWorkersBusy(false)
    }
  }

  const runMcpWorkersHealthCheck = async (instance: McpWorkersInstance) => {
    const label = mcpWorkersSnapshot?.definitions.find((definition) => definition.id === instance.definitionId)?.name
      ?? instance.definitionId ?? instance.instanceId
    setMcpWorkersBusy(true)
    setMcpWorkersHealthCheckingId(instance.instanceId)
    setError(null)
    setNotice('Checking health for ' + label + '…')
    try {
      const result = await window.api.mcpWorkers.checkHealth(instance.instanceId) as McpWorkersHealthCheckResult
      setMcpWorkersCheckResults((current) => ({ ...current, [instance.instanceId]: result }))
      const state = typeof result?.state === 'string' ? ': ' + result.state : ''
      setNotice('Health check completed for ' + label + state + '.')
      try {
        await refreshMcpWorkers()
      } catch (cause) {
        setError('Health check completed, but the Worker list could not be refreshed: ' + (cause instanceof Error ? cause.message : 'Unknown refresh error.'))
      }
    } catch (cause) {
      setNotice(null)
      const message = cause instanceof Error ? cause.message : 'MCPWorkers health check failed.'
      const apiError = cause && typeof cause === 'object' ? cause as { status?: unknown; code?: unknown } : {}
      setMcpWorkersCheckResults((current) => ({
        ...current,
        [instance.instanceId]: {
          state: 'error',
          error: message,
          ...(typeof apiError.status === 'number' ? { httpStatus: apiError.status } : {}),
          ...(typeof apiError.code === 'string' ? { errorCode: apiError.code } : {}),
        },
      }))
      setError('Health check failed for ' + label + ': ' + message)
    } finally {
      setMcpWorkersHealthCheckingId(null)
      setMcpWorkersBusy(false)
    }
  }

  const runMcpWorkersLifecycle = async (instance: McpWorkersInstance, action: 'start' | 'stop' | 'restart') => {
    const label = mcpWorkersSnapshot?.definitions.find((definition) => definition.id === instance.definitionId)?.name
      ?? instance.definitionId ?? instance.instanceId
    if (!window.confirm(action[0]!.toUpperCase() + action.slice(1) + ' ' + label + '? MCPWorkers will perform this operation.')) return
    setMcpWorkersBusy(true)
    setError(null)
    try {
      await window.api.mcpWorkers.lifecycle(instance.instanceId, action)
      await refreshMcpWorkers()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'MCPWorkers lifecycle operation failed.')
      await refreshMcpWorkers().catch(() => undefined)
    } finally {
      setMcpWorkersBusy(false)
    }
  }

  const serviceNames = useMemo(
    () => new Map(services.map(({ service }) => [service.id, service.name])),
    [services],
  )

  const updateForm = (key: keyof ServiceFormState, value: string) => {
    setForm((current) => {
      const next = { ...current, [key]: value }
      if (key === 'name' && (!current.id || current.id === slugify(current.name))) next.id = slugify(value)
      return next
    })
  }

  const handleRegister = async (event: FormEvent) => {
    event.preventDefault()
    if (busyServiceId) return
    const id = form.id.trim()
    const name = form.name.trim()
    if (!name || !id || !form.executablePath.trim() || !form.workingDirectory.trim()) {
      setError('Name, service ID, executable and working directory are required.')
      return
    }

    const dependencies = [...new Set(form.dependencies.split(',').map((value) => value.trim()).filter(Boolean))]
      .map((serviceId) => ({ serviceId, required: true }))
    const args = form.args.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
    const definition: ServiceDefinition = {
      id,
      name,
      version: '1.0.0',
      adapterId: 'process.local',
      owner: { kind: 'managed', resourceId: id },
      capabilities: ['status', 'health', 'start', 'stop', 'restart', 'logs'],
      platforms: ['win32'],
      dependencies,
      config: {
        executablePath: form.executablePath.trim(),
        workingDirectory: form.workingDirectory.trim(),
        args,
      },
      ...(form.readinessUrl.trim()
        ? { readinessProbe: { type: 'http' as const, url: form.readinessUrl.trim(), timeoutMs: 2_000, expectedStatusCodes: [200] } }
        : {}),
    }

    setBusyServiceId(id)
    try {
      await window.api.runtime.registerService(definition)
      setForm(EMPTY_FORM)
      setFormOpen(false)
      setNotice('Service ' + name + ' registered.')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Service registration failed.')
    } finally {
      setBusyServiceId(null)
    }
  }

  const requestStart = async (serviceId: string) => {
    setBusyServiceId(serviceId)
    setError(null)
    setNotice(null)
    try {
      const plan = await window.api.runtime.getStartPlan(serviceId)
      setPendingPlan({ serviceId, plan })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not build a startup plan.')
    } finally {
      setBusyServiceId(null)
    }
  }

  const confirmStart = async () => {
    if (!pendingPlan || busyServiceId) return
    const { serviceId, plan } = pendingPlan
    setBusyServiceId(serviceId)
    setError(null)
    try {
      const result = await window.api.runtime.executeStartPlan(serviceId, plan.toStart)
      setNotice('Started: ' + (result.startedServiceIds.join(', ') || 'all required services were already ready') + '.')
      setPendingPlan(null)
      await refresh()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Startup plan failed.'
      await refresh()
      setError(message)
    } finally {
      setBusyServiceId(null)
    }
  }

  const stopService = async (serviceId: string) => {
    if (busyServiceId || !window.confirm('Stop ' + (serviceNames.get(serviceId) ?? serviceId) + '?')) return
    setBusyServiceId(serviceId)
    setError(null)
    setNotice(null)
    try {
      const snapshot = await window.api.runtime.stopService(serviceId)
      setNotice('Service state: ' + stateLabel(snapshot.state) + '.')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Service stop failed.')
    } finally {
      setBusyServiceId(null)
    }
  }

  const acknowledgeStopped = async (serviceId: string) => {
    const confirmed = window.confirm(
      'DevKit cannot verify this process after a previous session. Continue only if you have independently confirmed that it is stopped. This action does not terminate any process; it only clears the stale ownership record.',
    )
    if (!confirmed || busyServiceId) return
    setBusyServiceId(serviceId)
    setError(null)
    try {
      await window.api.runtime.acknowledgeUnobservableStopped(serviceId)
      setNotice('Previous process ownership record cleared.')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not clear the stale process record.')
    } finally {
      setBusyServiceId(null)
    }
  }

  const restartService = async (serviceId: string) => {
    const name = serviceNames.get(serviceId) ?? serviceId
    if (busyServiceId || !window.confirm('Restart ' + name + '?')) return
    setBusyServiceId(serviceId)
    setError(null)
    setNotice(null)
    try {
      const snapshot = await window.api.runtime.restartService(serviceId)
      setNotice('Service state: ' + stateLabel(snapshot.state) + '.')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Service restart failed.')
    } finally {
      setBusyServiceId(null)
    }
  }

  const unregisterService = async (serviceId: string) => {
    const name = serviceNames.get(serviceId) ?? serviceId
    if (busyServiceId || !window.confirm('Remove registration for ' + name + '? Managed files and data will not be deleted.')) return
    setBusyServiceId(serviceId)
    setError(null)
    try {
      await window.api.runtime.unregisterService(serviceId)
      if (details?.service.id === serviceId) setDetails(null)
      setNotice('Registration for ' + serviceId + ' removed. No service files were deleted.')
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove service registration.')
    } finally {
      setBusyServiceId(null)
    }
  }

  const showDetails = async (serviceId: string) => {
    setBusyServiceId(serviceId)
    try {
      setDetails(await window.api.runtime.getServiceDetails(serviceId))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load service details.')
    } finally {
      setBusyServiceId(null)
    }
  }

  const selectExecutable = async () => {
    try {
      const selected = await window.api.runtime.selectExecutable()
      if (selected) updateForm('executablePath', selected)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Executable selection failed.')
    }
  }

  const selectWorkingDirectory = async () => {
    try {
      const selected = await window.api.runtime.selectWorkingDirectory()
      if (selected) updateForm('workingDirectory', selected)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Directory selection failed.')
    }
  }

  return (
    <div className="page services-page">
      <PageHeader title="Services" description="Manage DevKit Runtime services and connected service platforms." />
      {error && <div className="service-message service-message-error" role="alert"><AlertCircle size={16} />{error}</div>}
      {notice && <div className="service-message service-message-success" role="status"><CheckCircle2 size={16} />{notice}</div>}

      <Card>
        <CardTitle icon={<Server size={16} />}>MCPWorkers Manager</CardTitle>
        <CardBody>
          {mcpWorkersHealth ? (
            <>
              <strong>{mcpWorkersHealth.state === 'reachable' ? 'API v1 reachable' : mcpWorkersHealth.state === 'unavailable' ? 'Unavailable' : mcpWorkersHealth.state === 'incompatible' ? 'Incompatible API' : 'Connection error'}</strong>
              <p>{mcpWorkersHealth.detail}</p>
              <small>{mcpWorkersHealth.baseUrl}</small>
            </>
          ) : 'Checking MCPWorkers Manager API…'}
          <div className="service-form-hint service-details-wide">
            <strong>
              Runtime ownership: {mcpWorkersRuntimeStatus?.runtime.state === 'external'
                ? 'External — attached'
                : mcpWorkersRuntimeStatus?.runtime.state === 'managed'
                  ? 'Managed by DevKit'
                  : mcpWorkersRuntimeStatus?.runtime.state === 'blocked'
                    ? 'Blocked'
                    : 'Unavailable / not configured'}
            </strong>
            <p>{mcpWorkersRuntimeStatus?.runtime.detail ?? 'Checking Runtime ownership…'}</p>
            <small>
              MCPWorkers storage: {mcpWorkersRuntimeStatus?.dataRoot ?? 'Not detected'}
            </small>
            <p className="service-form-hint">
              {mcpWorkersRuntimeStatus?.dataRoot
                ? 'Existing MCPWorkers storage found. It contains the Manager registry and configuration. DevKit reuses it and does not create a replacement.'
                : 'DevKit looks for existing MCPWorkers storage automatically. If it is not found, choose the .mcpworkers folder inside your MCPWorkers project — not the parent project folder. DevKit checks the folder before using it.'}
            </p>
            <div className="service-form-actions">
              <Button variant="secondary" onClick={() => void selectMcpWorkersDataRoot()} disabled={mcpWorkersRuntimeBusy}>
                {mcpWorkersRuntimeStatus?.dataRoot ? 'Change storage folder' : 'Locate existing storage'}
              </Button>
              <Button onClick={() => void startMcpWorkersManager()} disabled={mcpWorkersRuntimeBusy}>
                <Play size={13} /> Connect / Launch Manager
              </Button>
              <Button variant="secondary" onClick={() => void stopMcpWorkersManager()} disabled={mcpWorkersRuntimeBusy || mcpWorkersRuntimeStatus?.runtime.state !== 'managed'}>
                <CircleStop size={13} /> Shutdown DevKit-owned
              </Button>
            </div>
            <small>DevKit never stops an externally owned Manager. Worker Instances remain under MCPWorkers control.</small>
          </div>
          </CardBody>
      </Card>

      <Card>
        <CardTitle icon={<Server size={16} />}>MCPWorkers connection</CardTitle>
        <CardBody>
          <p>{mcpWorkersStatus?.detail ?? 'Checking authenticated Manager connection…'}</p>
          <small>Manager API: http://127.0.0.1:43127 · Worker lifecycle is owned by MCPWorkers.</small>
          {mcpWorkersStatus?.state === 'connected' ? (
            <div className="service-form-actions">
              <strong>Authenticated</strong>
              <Button variant="secondary" onClick={() => void refreshMcpWorkers()} disabled={mcpWorkersBusy}>Refresh Workers</Button>
              <Button variant="ghost" onClick={() => void disconnectMcpWorkers()} disabled={mcpWorkersBusy}>Disconnect</Button>
            </div>
          ) : (
            <div className="service-form-grid">
              <FormField label="KeePassXC database" hint="Select the database containing the MCPWorkers DevKit client token.">
                <div className="service-input-action">
                  <Input value={keepassDatabasePath} onChange={(event) => setKeepassDatabasePath(event.target.value)} placeholder="No database selected" />
                  <Button type="button" variant="secondary" onClick={() => void selectKeePassDatabase()}>Browse</Button>
                </div>
              </FormField>
              <FormField label="KeePassXC entry" hint="Choose the entry that contains the DevKit client credential.">
                <select
                  className="input"
                  value={keepassEntryPath}
                  onChange={(event) => setKeepassEntryPath(event.target.value)}
                  disabled={keepassEntriesLoading || keepassEntries.length === 0}
                >
                  <option value="">
                    {keepassEntriesLoading ? 'Loading entries…' : keepassEntries.length > 0 ? 'Select an entry' : 'Choose a database first'}
                  </option>
                  {keepassEntries.map((entry) => (
                    <option key={entry.path} value={entry.path}>
                      {entry.groupPath ? entry.groupPath + ' / ' + entry.title : entry.title}
                    </option>
                  ))}
                </select>
              </FormField>

              <div className="service-form-actions">
                <Button onClick={() => void (mcpWorkersStatus?.state === 'configured' ? unlockMcpWorkers() : connectMcpWorkers())} disabled={mcpWorkersBusy || !keepassDatabasePath.trim() || !keepassEntryPath.trim()}>
                  {mcpWorkersStatus?.state === 'configured' ? 'Unlock in secure prompt' : 'Connect in secure prompt'}
                </Button>
                {mcpWorkersStatus && mcpWorkersStatus.state !== 'disconnected' && (
                  <Button variant="ghost" onClick={() => void disconnectMcpWorkers()} disabled={mcpWorkersBusy}>Clear saved connection</Button>
                )}
              </div>
              <div className="service-form-hint service-details-wide">
                Select the KeePassXC entry that stores the DevKit client credential.

                The master password is requested securely and is never sent through the interface. Only the encrypted database and entry reference is saved.
              </div>
            </div>
          )}
        </CardBody>
        {mcpWorkersSnapshot && (
          <div className="services-grid">
            {mcpWorkersSnapshot.instances.map((instance) => {
              const definition = mcpWorkersSnapshot.definitions.find((item) => item.id === instance.definitionId)
              const label = definition?.name ?? instance.definitionId
              return (
                <div className="service-card" key={instance.instanceId}>
                  <div className="service-card-heading">
                    <div className="service-card-icon"><Server size={18} /></div>
                    <div className="service-card-title"><strong>{label}</strong><code>{instance.definitionId}</code></div>
                    <span className="service-owner-label">MCPWorkers-managed</span>
                  </div>
                  <div className="service-card-meta">
                    <span>Version <strong>{instance.installedVersion}</strong></span>
                    <span>Runtime <strong>{instance.runtimeState}</strong></span>
                    <span>Health <strong>{instance.healthState}</strong></span>
                    <span>Enabled <strong>{instance.enabled ? 'Yes' : 'No'}</strong></span>
                    {instance.role && <span>Role <strong>{instance.role}</strong></span>}
                    {instance.priority !== undefined && <span>Priority <strong>{instance.priority}</strong></span>}
                    <span>Verified capabilities <strong>{instance.verifiedCapabilities?.join(', ') || 'None verified'}</strong></span>
                    {definition?.credentialRequirements && definition.credentialRequirements.length > 0 && (
                      <div className="service-details-wide service-credential-requirements">
                        <span>Credential requirements</span>
                        {definition.credentialRequirements.map((item) => (
                          <span key={item.id}>
                            <strong>{item.label}</strong> — {item.description} ({item.requirement === 'optional' ? 'Optional' : 'Depends on configuration'})
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  {mcpWorkersCheckResults[instance.instanceId] && (() => {
                    const result = mcpWorkersCheckResults[instance.instanceId]!
                    return (
                      <div className={'service-health-report' + (result.state === 'error' ? ' service-health-report-error' : '')} aria-label={'Health check details for ' + label}>
                        <div className="service-health-report-heading">
                          <strong>Latest health check: {result.state}</strong>
                          {typeof result.latencyMs === 'number' && <span>{result.latencyMs} ms</span>}
                          {result.checkedAt && <span>{result.checkedAt}</span>}
                        </div>
                        {result.failureClass && <p>Failure class: <strong>{result.failureClass}</strong></p>}
                        {result.error && <p role="alert">{result.error}</p>}
                        {result.httpStatus !== undefined && <p>HTTP {result.httpStatus}{result.errorCode ? ' · ' + result.errorCode : ''}</p>}
                        {result.checks && result.checks.length > 0 && (
                          <div className="service-health-report-checks">
                            {result.checks.map((check) => (
                              <div className="service-health-row" key={check.id}>
                                <strong>{check.id}</strong>
                                <span className={'service-health-check-state service-health-check-' + check.state}>{check.state}</span>
                                <small>{check.message}</small>
                              </div>
                            ))}
                          </div>
                        )}
                        {!result.error && (!result.checks || result.checks.length === 0) && <p>No individual check details were returned by MCPWorkers.</p>}
                      </div>
                    )
                  })()}
                  <div className="service-card-actions">
                    <Button className="service-button-compact" variant="secondary" onClick={() => void runMcpWorkersHealthCheck(instance)} disabled={mcpWorkersBusy}>
                      {mcpWorkersHealthCheckingId === instance.instanceId ? 'Checking…' : 'Check health'}
                    </Button>
                    {instance.enabled && ['installed', 'stopped', 'failed'].includes(instance.runtimeState) && <Button className="service-button-compact" onClick={() => void runMcpWorkersLifecycle(instance, 'start')} disabled={mcpWorkersBusy}><Play size={13} /> Start</Button>}
                    {instance.enabled && instance.runtimeState === 'running' && <Button className="service-button-compact" variant="secondary" onClick={() => void runMcpWorkersLifecycle(instance, 'restart')} disabled={mcpWorkersBusy}><RefreshCw size={13} /> Restart</Button>}
                    {['running', 'degraded'].includes(instance.runtimeState) && <Button className="service-button-compact" variant="secondary" onClick={() => void runMcpWorkersLifecycle(instance, 'stop')} disabled={mcpWorkersBusy}><CircleStop size={13} /> Stop</Button>}
                  </div>
                </div>
              )
            })}
            {mcpWorkersSnapshot.instances.length === 0 && <div className="empty-state">No Worker Instances are registered in MCPWorkers.</div>}
          </div>
        )}
      </Card>

      <div className="services-toolbar">
        <div className="services-summary">
          <span><strong>{services.length}</strong> registered</span>
          <span><strong>{services.filter((item) => item.snapshot.state === 'running').length}</strong> running</span>
          <span><strong>{services.filter((item) => item.snapshot.state === 'degraded').length}</strong> degraded</span>
        </div>
        <div className="toolbar">
          <Button variant="secondary" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14} /> Refresh</Button>
          <Button onClick={() => setFormOpen((open) => !open)}><Plus size={14} /> Register service</Button>
        </div>
      </div>


      {formOpen && (
        <Card>
          <CardTitle icon={<Plus size={16} />}>Register local service</CardTitle>
          <CardBody>DevKit launches the selected executable directly with shell execution disabled. Shell scripts and secret environment variables are not accepted in this MVP. Windows stop forcefully terminates the managed process and every process contained in its Job Object. Graceful shutdown is not supported yet.</CardBody>
          <form className="service-form" onSubmit={handleRegister}>
            <div className="service-form-grid">
              <FormField label="Display name">
                <Input value={form.name} onChange={(event) => updateForm('name', event.target.value)} placeholder="Local API" />
              </FormField>
              <FormField label="Service ID" hint="Lowercase letters, numbers and hyphens.">
                <Input value={form.id} onChange={(event) => updateForm('id', event.target.value)} placeholder="local-api" />
              </FormField>
              <FormField label="Executable" hint="Select a .exe or .com file.">
                <div className="service-input-action">
                  <Input value={form.executablePath} onChange={(event) => updateForm('executablePath', event.target.value)} placeholder="C:\Program Files\..." />
                  <Button type="button" variant="secondary" onClick={() => void selectExecutable()}>Browse</Button>
                </div>
              </FormField>
              <FormField label="Working directory">
                <div className="service-input-action">
                  <Input value={form.workingDirectory} onChange={(event) => updateForm('workingDirectory', event.target.value)} placeholder="C:\Projects\service" />
                  <Button type="button" variant="secondary" onClick={() => void selectWorkingDirectory()}>Browse</Button>
                </div>
              </FormField>
              <FormField label="Arguments" hint="One argument per line. Each line is passed separately; no shell parsing.">
                <textarea className="service-textarea" value={form.args} onChange={(event) => updateForm('args', event.target.value)} placeholder={'--port\n4317'} rows={3} />
              </FormField>
              <FormField label="Readiness URL (optional)" hint="Must use localhost, 127.0.0.1 or ::1.">
                <Input value={form.readinessUrl} onChange={(event) => updateForm('readinessUrl', event.target.value)} placeholder="http://127.0.0.1:4317/health" />
              </FormField>
              <FormField label="Dependencies (optional)" hint="Comma-separated registered service IDs. All are treated as required.">
                <Input value={form.dependencies} onChange={(event) => updateForm('dependencies', event.target.value)} placeholder="database, cache" />
              </FormField>
            </div>
            <div className="service-form-actions">
              <Button type="button" variant="secondary" onClick={() => setFormOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busyServiceId !== null}>Register service</Button>
            </div>
          </form>
        </Card>
      )}

      {pendingPlan && (
        <Card>
          <CardTitle icon={<Activity size={16} />}>Review startup plan</CardTitle>
          <CardBody>Dependencies start before the selected service. DevKit waits for readiness checks and does not restart services that are already ready.</CardBody>
          <div className="service-plan-list">
            {pendingPlan.plan.order.map((id, index) => (
              <div className="service-plan-row" key={id}>
                <span className="service-plan-number">{index + 1}</span>
                <span>{serviceNames.get(id) ?? id}</span>
                <code>{id}</code>
                {pendingPlan.plan.alreadyReady.includes(id)
                  ? <span className="service-plan-ready">Already ready</span>
                  : <span className="service-plan-start">Will start</span>}
              </div>
            ))}
          </div>
          {pendingPlan.plan.blockers.map((blocker) => <p className="service-plan-blocker" key={blocker}>{blocker}</p>)}
          {pendingPlan.plan.warnings.map((warning) => <p className="service-plan-warning" key={warning}>{warning}</p>)}
          <div className="service-form-actions">
            <Button variant="secondary" onClick={() => setPendingPlan(null)}>Cancel</Button>
            <Button onClick={() => void confirmStart()} disabled={!pendingPlan.plan.canExecute || busyServiceId !== null}>
              <Play size={14} /> Confirm and start
            </Button>
          </div>
        </Card>
      )}

      {loading ? (
        <div className="empty-state">Loading services…</div>
      ) : services.length === 0 ? (
        <div className="empty-state">
          <Server size={36} />
          <p>No services registered yet.</p>
          <span>Register a local executable to begin managing its lifecycle.</span>
        </div>
      ) : (
        <div className="services-grid">
          {services.map(({ service, snapshot }) => (
            <Card key={service.id}>
              <div className="service-card-heading">
                <div className="service-card-icon"><Server size={18} /></div>
                <div className="service-card-title"><strong>{service.name}</strong><code>{service.id}</code></div>
                <span className="service-owner-label">Runtime-managed</span>
                <ServiceState state={snapshot.state} />
              </div>
              <div className="service-card-meta">
                <span>Adapter <strong>{service.adapterId}</strong></span>
                <span>Version <strong>{service.version}</strong></span>
                <span>Process <strong>{snapshot.process.state}</strong></span>
                {snapshot.process.pid && <span>PID <strong>{snapshot.process.pid}</strong></span>}
              </div>
              {snapshot.reason && <p className="service-card-reason">{snapshot.reason}</p>}
              {service.dependencies.length > 0 && (
                <div className="service-card-dependencies">
                  <span>Dependencies</span>
                  {service.dependencies.map((dependency) => <code key={dependency.serviceId}>{dependency.serviceId}</code>)}
                </div>
              )}
              <div className="service-card-actions">
                {(snapshot.state === 'stopped' || snapshot.state === 'failed') && service.capabilities.includes('start') && (
                  <Button className="service-button-compact" onClick={() => void requestStart(service.id)} disabled={busyServiceId !== null}><Play size={13} /> Start</Button>
                )}
                {(snapshot.state === 'running' || snapshot.state === 'degraded') && service.capabilities.includes('stop') && (
                  <>
                    {service.capabilities.includes('restart') && <Button className="service-button-compact" variant="secondary" onClick={() => void restartService(service.id)} disabled={busyServiceId !== null}><RefreshCw size={13} /> Restart</Button>}
                    <Button className="service-button-compact" variant="secondary" onClick={() => void stopService(service.id)} disabled={busyServiceId !== null || (service.id === 'mcpworkers-manager' && snapshot.process.ownership !== 'managed')}><CircleStop size={13} /> Stop</Button>
                  </>
                )}
                {snapshot.state === 'unknown' && (
                  <Button className="service-button-compact" variant="secondary" onClick={() => void acknowledgeStopped(service.id)} disabled={busyServiceId !== null}>
                    Confirm process stopped
                  </Button>
                )}
                <Button className="service-button-compact" variant="ghost" onClick={() => void showDetails(service.id)} disabled={busyServiceId !== null}>
                  {details?.service.id === service.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Details
                </Button>
                <Button className="service-button-compact" variant="ghost" onClick={() => void unregisterService(service.id)} disabled={busyServiceId !== null || service.id === 'mcpworkers-manager' || snapshot.state === 'running' || snapshot.state === 'degraded' || snapshot.state === 'unknown'}>
                  <Trash2 size={13} /> Remove
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {details && (
        <Card>
          <CardTitle icon={<Activity size={16} />}>{details.service.name} — details</CardTitle>
          <div className="service-details-grid">
            <div><span>Process state</span><strong>{details.snapshot.process.state}</strong></div>
            <div><span>PID</span><strong>{details.snapshot.process.pid ?? '—'}</strong></div>
            <div><span>Identity verified</span><strong>{details.snapshot.process.identityVerified ? 'Yes' : 'No'}</strong></div>
            <div><span>Started</span><strong>{details.snapshot.process.startedAt ?? '—'}</strong></div>
            <div className="service-details-wide"><span>Executable</span><code>{details.snapshot.process.executablePath ?? String(details.service.config.executablePath ?? '—')}</code></div>
            <div className="service-details-wide"><span>Working directory</span><code>{details.snapshot.process.workingDirectory ?? String(details.service.config.workingDirectory ?? '—')}</code></div>
            <div className="service-details-wide"><span>Readiness checks</span>
              {details.snapshot.healthChecks.map((check) => (
                <div className="service-health-row" key={check.id}>
                  <span>{check.id}</span>
                  <ServiceState state={check.state === 'pass' ? 'running' : check.state === 'fail' ? 'failed' : 'unknown'} />
                  <small>{check.message}</small>
                </div>
              ))}
            </div>
            <div className="service-details-wide"><span>Recent events</span>
              {details.recentEvents.length === 0
                ? <small>No events recorded.</small>
                : details.recentEvents.map((event) => <code className="service-event-line" key={event}>{event}</code>)}
            </div>
          </div>
        </Card>
      )}
    </div>
  )
}
