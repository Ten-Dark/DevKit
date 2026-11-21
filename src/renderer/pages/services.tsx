import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Activity, AlertCircle, CheckCircle2, ChevronDown, ChevronRight, CircleStop, Play, Plus, RefreshCw, Server, Trash2 } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Card, CardBody, CardTitle } from '../components/ui/card'
import { PageHeader } from '../components/page-header'
import type { ServiceDefinition, ServiceRuntimeSnapshot } from '../../main/core/contracts'
import type { DependencyPlan } from '../../main/core/dependency-engine'
import type { RuntimeServiceDetails, RuntimeServiceItem } from '../../main/core/runtime-core'

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
    try {
      setServices(await window.api.runtime.listServices())
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load registered services.')
    } finally {
      setLoading(false)
    }
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
      <PageHeader title="Services" description="Register and manage local services through explicit, dependency-aware lifecycle operations." />

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

      {error && <div className="service-message service-message-error" role="alert"><AlertCircle size={16} />{error}</div>}
      {notice && <div className="service-message service-message-success" role="status"><CheckCircle2 size={16} />{notice}</div>}

      {formOpen && (
        <Card>
          <CardTitle icon={<Plus size={16} />}>Register local service</CardTitle>
          <CardBody>DevKit launches the selected executable directly with shell execution disabled. Shell scripts and secret environment variables are not accepted in this MVP. Windows stop forcefully terminates only the managed process; graceful shutdown and child-process tree management are not supported yet.</CardBody>
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
                    <Button className="service-button-compact" variant="secondary" onClick={() => void stopService(service.id)} disabled={busyServiceId !== null}><CircleStop size={13} /> Stop</Button>
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
                <Button className="service-button-compact" variant="ghost" onClick={() => void unregisterService(service.id)} disabled={busyServiceId !== null || snapshot.state === 'running' || snapshot.state === 'degraded' || snapshot.state === 'unknown'}>
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
