import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Activity, AlertCircle, ArrowDownToLine, Blocks, Cable, Check,
  ChevronDown, ChevronRight, CircleAlert, CircleCheck, CirclePause, CirclePlay,
  ExternalLink, FolderOpen, Globe, LoaderCircle, Plus, RefreshCw,
  Search, Server, Bot, ShieldAlert, ShieldCheck, Terminal, Trash2, Unplug, X,
} from 'lucide-react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Card, CardBody, CardTitle } from '../components/ui/card'
import { PageHeader } from '../components/page-header'
import type {
  McpConnectionInput,
  McpConnectionSummary,
  McpRegistryPackage,
  McpRegistryServer,
} from '../../shared/mcp'
import type { LocalIntegrationId, LocalIntegrationStatus } from '../../main/integrations/local-integrations'
import './mcp-library.css'

type LibraryTab = 'discover' | 'installed'
type ManualTransport = 'stdio' | 'streamable-http'

interface ManualFormState {
  name: string
  transport: ManualTransport
  command: string
  args: string
  cwd: string
  envJson: string
  url: string
  headersJson: string
}

const EMPTY_FORM: ManualFormState = {
  name: '',
  transport: 'stdio',
  command: 'node.exe',
  args: '',
  cwd: '',
  envJson: '{}',
  url: '',
  headersJson: '{}',
}

function parseJsonObject(value: string, label: string): Record<string, string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(label + ' must contain valid JSON.')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(label + ' must be a JSON object.')
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(parsed)) {
    if (typeof item !== 'string') throw new Error(label + ' values must be strings.')
    result[key] = item
  }
  return result
}

function stateText(state: LocalIntegrationStatus['state']): string {
  return {
    running: 'Running',
    stopped: 'Stopped',
    starting: 'Starting',
    unavailable: 'Not installed',
    error: 'Needs attention',
  }[state]
}

function IntegrationState({ state }: { state: LocalIntegrationStatus['state'] }) {
  const Icon = state === 'running' ? CircleCheck : state === 'starting' ? LoaderCircle : state === 'error' ? CircleAlert : CirclePause
  return (
    <span className={'mcp-state mcp-state-' + state}>
      <Icon size={13} className={state === 'starting' ? 'mcp-spin' : undefined} />
      {stateText(state)}
    </span>
  )
}

function ConnectionState({ state }: { state: McpConnectionSummary['state'] }) {
  return (
    <span className={'mcp-state mcp-state-' + state}>
      {state === 'connected' ? <CircleCheck size={13} /> : state === 'error' ? <CircleAlert size={13} /> : <CirclePause size={13} />}
      {state === 'connected' ? 'Connected' : state === 'error' ? 'Connection error' : 'Disconnected'}
    </span>
  )
}

function ServerCard({
  server,
  onAddLocal,
  onAddRemote,
  busy,
}: {
  server: McpRegistryServer
  onAddLocal: (server: McpRegistryServer, pkg: McpRegistryPackage) => void
  onAddRemote: (server: McpRegistryServer, url: string) => void
  busy: boolean
}) {
  const localPackages = server.status === 'active' ? server.packages.filter((item) => item.canInstallWithNpx) : []
  const remotes = server.status === 'active' ? server.remotes.filter((item) => item.type === 'streamable-http') : []
  const canAddRemote = remotes.find((item) => !item.requiresAuth)
  const needsRemoteAuth = remotes.some((item) => item.requiresAuth)
  const displayName = server.title || server.name
  const repoUrl = server.repositoryUrl || server.websiteUrl

  return (
    <Card>
      <div className="mcp-server-heading">
        <div className="mcp-server-icon"><Blocks size={19} /></div>
        <div className="mcp-server-heading-main">
          <strong>{displayName}</strong>
          <code>{server.name}</code>
        </div>
        <span className={'mcp-registry-status mcp-registry-' + server.status}>{server.status}</span>
      </div>
      <p className="mcp-server-description">{server.description}</p>
      <div className="mcp-server-meta">
        <span>Version <strong>{server.version}</strong></span>
        <span>{server.packages.length} package option{server.packages.length === 1 ? '' : 's'}</span>
        <span>{server.remotes.length} remote endpoint{server.remotes.length === 1 ? '' : 's'}</span>
      </div>
      {(localPackages.length > 0 || canAddRemote || needsRemoteAuth) && (
        <div className="mcp-install-options">
          {localPackages.map((pkg) => (
            <div className="mcp-install-option" key={pkg.registryType + ':' + pkg.identifier}>
              <div>
                <span className="mcp-option-label"><Terminal size={13} /> Local package</span>
                <code>{pkg.identifier}@{pkg.version}</code>
              </div>
              <Button variant="secondary" disabled={busy} onClick={() => onAddLocal(server, pkg)}>
                <Plus size={13} /> Add
              </Button>
            </div>
          ))}
          {canAddRemote && (
            <div className="mcp-install-option">
              <div>
                <span className="mcp-option-label"><Globe size={13} /> Hosted endpoint</span>
                <code>{new URL(canAddRemote.url).host}</code>
              </div>
              <Button variant="secondary" disabled={busy} onClick={() => onAddRemote(server, canAddRemote.url)}>
                <Plus size={13} /> Add
              </Button>
            </div>
          )}
          {!canAddRemote && needsRemoteAuth && (
            <div className="mcp-install-note">A remote endpoint requires credentials. Add it through Manual setup to enter the required headers securely.</div>
          )}
        </div>
      )}
      {server.packages.filter((pkg) => !pkg.canInstallWithNpx).map((pkg) => (
        <div className="mcp-install-note" key={pkg.registryType + ":" + pkg.identifier + ":" + pkg.version}>
          <strong>Setup required · {pkg.identifier}@{pkg.version}</strong>
          <span>{pkg.installBlockers.join(" ") || "This package needs manual setup before it can be launched."}</span>
        </div>
      ))}
      {server.status !== "active" && (
        <div className="mcp-install-note">This listing is not marked active in the official Registry. Quick-add is disabled.</div>
      )}
      {server.packages.length === 0 && remotes.length === 0 && (
        <div className="mcp-install-note">Registry entry does not declare a supported local stdio npm package or Streamable HTTP endpoint.</div>
      )}
      <div className="mcp-server-footer">
        <span>Official Registry · {server.status === 'active' ? 'Active listing' : 'Check publisher status'}</span>
        {repoUrl && (
          <button className="mcp-link-button" type="button" onClick={() => void window.api.openExternal(repoUrl)}>
            Publisher <ExternalLink size={12} />
          </button>
        )}
      </div>
    </Card>
  )
}

export default function McpLibraryPage() {
  const [tab, setTab] = useState<LibraryTab>('discover')
  const [query, setQuery] = useState('')
  const [servers, setServers] = useState<McpRegistryServer[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [loadingRegistry, setLoadingRegistry] = useState(false)
  const [registryCount, setRegistryCount] = useState(0)
  const [connections, setConnections] = useState<McpConnectionSummary[]>([])
  const [localServices, setLocalServices] = useState<LocalIntegrationStatus[]>([])
  const [projectsRoot, setProjectsRoot] = useState('')
  const [loadingLocal, setLoadingLocal] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [revealManualSecrets, setRevealManualSecrets] = useState(false)
  const [manualForm, setManualForm] = useState<ManualFormState>(EMPTY_FORM)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const installedIds = useMemo(() => new Set(connections.map((item) => item.registryName).filter(Boolean)), [connections])

  const refreshConnections = useCallback(async () => {
    try {
      setConnections(await window.api.mcp.listConnections())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load saved MCP connections.')
    }
  }, [])

  const refreshLocalServices = useCallback(async () => {
    setLoadingLocal(true)
    try {
      const result = await window.api.integrations.getStatuses()
      setProjectsRoot(result.projectsRoot)
      setLocalServices(result.integrations)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not inspect local integrations.')
    } finally {
      setLoadingLocal(false)
    }
  }, [])

  const searchRegistry = useCallback(async (reset: boolean) => {
    setLoadingRegistry(true)
    setError(null)
    try {
      const result = await window.api.mcp.searchRegistry(query.trim(), reset ? undefined : cursor)
      setServers((current) => reset ? result.servers : [...current, ...result.servers])
      setCursor(result.nextCursor)
      setRegistryCount(result.count)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not search the official MCP Registry.')
    } finally {
      setLoadingRegistry(false)
    }
  }, [cursor, query])

  useEffect(() => {
    let cancelled = false
    void window.api.mcp.listConnections().then((savedConnections) => {
      if (!cancelled) setConnections(savedConnections)
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load saved MCP connections.')
    })
    void window.api.integrations.getStatuses().then((localStatus) => {
      if (cancelled) return
      setProjectsRoot(localStatus.projectsRoot)
      setLocalServices(localStatus.integrations)
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not inspect local integrations.')
    })
    void window.api.mcp.searchRegistry('').then((registryPage) => {
      if (cancelled) return
      setServers(registryPage.servers)
      setCursor(registryPage.nextCursor)
      setRegistryCount(registryPage.count)
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load the official MCP Registry.')
    })
    return () => { cancelled = true }
  }, [])

  const addLocalPackage = async (server: McpRegistryServer, pkg: McpRegistryPackage) => {
    const packagePattern = /^(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+$/i
    if (!packagePattern.test(pkg.identifier) || !/^[0-9A-Za-z.+_-]+$/.test(pkg.version)) {
      setError('Registry package identifier or version is not safe for an npm package reference.')
      return
    }
    const confirmed = window.confirm(
      'Add ' + (server.title || server.name) + ' as a local MCP package?\n\nDevKit will save the package configuration only. It will not download or execute it until you explicitly press Connect. When connected, npm/npx downloads and runs third-party code with your Windows user permissions. Continue only if you trust the publisher.',
    )
    if (!confirmed) return
    setBusyId(server.name)
    setError(null)
    try {
      await window.api.mcp.addConnection({
        name: server.title || server.name,
        description: server.description,
        source: 'registry',
        registryName: server.name,
        registryVersion: server.version,
        transport: {
          type: 'stdio',
          command: 'npx',
          args: ['--yes', pkg.identifier + '@' + pkg.version],
          cwd: projectsRoot,
        },
      })
      setNotice('Added ' + (server.title || server.name) + '. It is saved and not running yet.')
      setTab('installed')
      await refreshConnections()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add this MCP server.')
    } finally {
      setBusyId(null)
    }
  }

  const addRemoteEndpoint = async (server: McpRegistryServer, url: string) => {
    const confirmed = window.confirm(
      'Add the hosted MCP endpoint for ' + (server.title || server.name) + '?\n\nWhen connected, DevKit sends MCP requests and tool context to this third-party provider. Check its privacy policy and terms first.',
    )
    if (!confirmed) return
    setBusyId(server.name)
    setError(null)
    try {
      await window.api.mcp.addConnection({
        name: server.title || server.name,
        description: server.description,
        source: 'registry',
        registryName: server.name,
        registryVersion: server.version,
        transport: { type: 'streamable-http', url },
      })
      setNotice('Added hosted endpoint. Connect to activate it.')
      setTab('installed')
      await refreshConnections()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add this MCP endpoint.')
    } finally {
      setBusyId(null)
    }
  }

  const submitManual = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setBusyId('manual')
    try {
      const input: McpConnectionInput = manualForm.transport === 'stdio'
        ? {
            name: manualForm.name.trim(),
            transport: {
              type: 'stdio',
              command: manualForm.command.trim(),
              args: manualForm.args.split(/\r?\n/).map((item) => item.trim()).filter(Boolean),
              cwd: manualForm.cwd.trim() || projectsRoot,
              env: parseJsonObject(manualForm.envJson, 'Environment'),
            },
          }
        : {
            name: manualForm.name.trim(),
            transport: {
              type: 'streamable-http',
              url: manualForm.url.trim(),
              headers: parseJsonObject(manualForm.headersJson, 'HTTP headers'),
            },
          }
      await window.api.mcp.addConnection(input)
      setManualForm(EMPTY_FORM)
      setManualOpen(false)
      setNotice('MCP connection saved. It will remain disconnected until you connect it.')
      await refreshConnections()
      setTab('installed')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save MCP configuration.')
    } finally {
      setBusyId(null)
    }
  }

  const connect = async (connection: McpConnectionSummary) => {
    setBusyId(connection.id)
    setError(null)
    setNotice(null)
    try {
      const result = await window.api.mcp.connect(connection.id)
      if (!result) return
      await refreshConnections()
      if (result.state === 'error') setError(result.error || 'MCP connection failed.')
      else setNotice('Connected to ' + connection.name + '. Discovered ' + result.tools.length + ' tools.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'MCP connection failed.')
      await refreshConnections()
    } finally {
      setBusyId(null)
    }
  }

  const disconnect = async (connection: McpConnectionSummary) => {
    setBusyId(connection.id)
    setError(null)
    try {
      await window.api.mcp.disconnect(connection.id)
      await refreshConnections()
      setNotice('Disconnected ' + connection.name + '.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not disconnect MCP server.')
    } finally {
      setBusyId(null)
    }
  }

  const remove = async (connection: McpConnectionSummary) => {
    if (connection.state === 'connected') {
      setError('Disconnect the server before removing it.')
      return
    }
    if (!window.confirm('Remove saved connection "' + connection.name + '"? This does not uninstall its npm package or delete server files.')) return
    setBusyId(connection.id)
    try {
      await window.api.mcp.removeConnection(connection.id)
      if (expandedId === connection.id) setExpandedId(null)
      await refreshConnections()
      setNotice('Removed the saved connection.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove MCP connection.')
    } finally {
      setBusyId(null)
    }
  }

  const runLocalAction = async (id: LocalIntegrationId, action: 'start' | 'stop') => {
    setBusyId(id)
    setError(null)
    setNotice(null)
    try {
      const result = await window.api.integrations[action](id)
      setLocalServices((current) => current.map((item) => item.id === id ? result : item))
      setNotice(result.detail || (result.name + ' updated.'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Local integration action failed.')
      await refreshLocalServices()
    } finally {
      setBusyId(null)
    }
  }

  const chooseMultiAggregatorExecutable = async () => {
    try {
      const selected = await window.api.integrations.selectMultiAggregatorExecutable()
      if (!selected) return
      setNotice('Multi-AI Aggregator executable configured.')
      await refreshLocalServices()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not configure Multi-AI Aggregator.')
    }
  }

  const chooseProjectsRoot = async () => {
    const selected = await window.api.integrations.selectProjectsRoot()
    if (!selected) return
    try {
      const result = await window.api.integrations.setProjectsRoot(selected)
      setProjectsRoot(result)
      await refreshLocalServices()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save Projects directory.')
    }
  }

  const chooseWorkingDirectory = async () => {
    const selected = await window.api.mcp.selectWorkingDirectory()
    if (selected) setManualForm((current) => ({ ...current, cwd: selected }))
  }

  return (
    <div className="page mcp-library-page">
      <PageHeader
        title="MCP & Integrations"
        description="A single workspace for your local MCP stack, connected servers and the official MCP Registry."
      />

      <section className="mcp-local-stack">
        <div className="mcp-section-heading">
          <div>
            <h2>Local development stack</h2>
            <p>Manage local MCP services and the Multi-AI Aggregator desktop app. Nothing starts automatically.</p>
          </div>
          <Button variant="secondary" onClick={() => void refreshLocalServices()} disabled={loadingLocal}>
            <RefreshCw size={14} className={loadingLocal ? 'mcp-spin' : undefined} /> Refresh
          </Button>
        </div>
        <div className="mcp-root-picker">
          <FolderOpen size={14} />
          <span>Projects folder</span>
          <code title={projectsRoot}>{projectsRoot || 'Not configured'}</code>
          <Button variant="ghost" onClick={() => void chooseProjectsRoot()}>Change</Button>
        </div>
        <div className="mcp-local-grid">
          {localServices.map((service) => (
            <Card key={service.id}>
              <div className="mcp-local-card-top">
                <span className="mcp-local-icon">
                  {service.id === 'multiaggregator' ? <Bot size={18} /> : service.id === 'localmcp-tunnel' ? <Cable size={18} /> : service.id === 'chat2agent' ? <Activity size={18} /> : <Server size={18} />}
                </span>
                <span className="mcp-ownership-chip">{service.id === 'multiaggregator' ? 'Desktop app' : 'External integration'}</span>
                <IntegrationState state={service.state} />
              </div>
              <h3>{service.name}</h3>
              <p>{service.description}</p>
              {service.detail && <div className="mcp-local-detail">{service.detail}</div>}
              {service.stopHint && service.state === 'running' && <div className="mcp-inline-hint">{service.stopHint}</div>}
              <div className="mcp-local-actions">
                {service.id === 'multiaggregator' && <Button variant="secondary" onClick={() => void chooseMultiAggregatorExecutable()} disabled={busyId !== null}>Configure</Button>}
                {service.canStart && service.state !== 'running' && (
                  <Button onClick={() => void runLocalAction(service.id, 'start')} disabled={busyId !== null}>
                    {busyId === service.id ? <LoaderCircle size={13} className="mcp-spin" /> : <CirclePlay size={13} />} Start
                  </Button>
                )}
                {service.canStop && service.id !== 'localmcp-tunnel' && (
                  <Button variant="secondary" onClick={() => void runLocalAction(service.id, 'stop')} disabled={busyId !== null}>
                    <CirclePause size={13} /> Stop
                  </Button>
                )}
                {service.id === 'localmcp-tunnel' && service.state === 'running' && (
                  <span className="mcp-local-stop-note">Stop with Ctrl+C in its terminal</span>
                )}
              </div>
            </Card>
          ))}
        </div>
      </section>

      <div className="mcp-tabs">
        <button type="button" className={tab === 'discover' ? 'mcp-tab mcp-tab-active' : 'mcp-tab'} onClick={() => setTab('discover')}>
          <Globe size={15} /> Discover servers
        </button>
        <button type="button" className={tab === 'installed' ? 'mcp-tab mcp-tab-active' : 'mcp-tab'} onClick={() => setTab('installed')}>
          <Blocks size={15} /> My MCPs <span>{connections.length}</span>
        </button>
        <div className="mcp-tabs-spacer" />
        <Button variant="secondary" onClick={() => setManualOpen((open) => !open)}>
          <Plus size={14} /> Add manually
        </Button>
      </div>

      {error && <div className="service-message service-message-error" role="alert"><AlertCircle size={15} />{error}<button type="button" onClick={() => setError(null)} aria-label="Dismiss"><X size={14} /></button></div>}
      {notice && <div className="service-message service-message-success" role="status"><Check size={15} />{notice}<button type="button" onClick={() => setNotice(null)} aria-label="Dismiss"><X size={14} /></button></div>}

      {manualOpen && (
        <Card>
          <CardTitle icon={<Plus size={16} />}>Add MCP connection</CardTitle>
          <CardBody>Choose a local stdio process or a remote Streamable HTTP endpoint. Credentials are encrypted by Windows before they are saved.</CardBody>
          <form className="mcp-manual-form" onSubmit={(event) => void submitManual(event)}>
            <div className="mcp-form-grid">
              <label className="service-form-field">
                <span className="service-form-label">Display name</span>
                <Input value={manualForm.name} onChange={(event) => setManualForm((current) => ({ ...current, name: event.target.value }))} placeholder="My MCP server" required />
              </label>
              <label className="service-form-field">
                <span className="service-form-label">Transport</span>
                <select className="mcp-select" value={manualForm.transport} onChange={(event) => setManualForm((current) => ({ ...current, transport: event.target.value as ManualTransport }))}>
                  <option value="stdio">Local process (stdio)</option>
                  <option value="streamable-http">Remote endpoint (Streamable HTTP)</option>
                </select>
              </label>
            </div>
            {manualForm.transport === 'stdio' ? (
              <>
                <div className="mcp-form-grid">
                  <label className="service-form-field">
                    <span className="service-form-label">Command</span>
                    <Input value={manualForm.command} onChange={(event) => setManualForm((current) => ({ ...current, command: event.target.value }))} placeholder="node.exe or cmd.exe" required />
                  </label>
                  <label className="service-form-field">
                    <span className="service-form-label">Working directory</span>
                    <div className="service-input-action">
                      <Input value={manualForm.cwd} onChange={(event) => setManualForm((current) => ({ ...current, cwd: event.target.value }))} placeholder={projectsRoot || 'C:\\Projects'} />
                      <Button type="button" variant="secondary" onClick={() => void chooseWorkingDirectory()}><FolderOpen size={13} /> Browse</Button>
                    </div>
                  </label>
                </div>
                <label className="service-form-field">
                  <span className="service-form-label">Arguments — one per line</span>
                  <textarea className="service-textarea" rows={3} value={manualForm.args} onChange={(event) => setManualForm((current) => ({ ...current, args: event.target.value }))} placeholder={'--yes\n@scope/mcp-server'} />
                </label>
                <label className="service-form-field">
                  <div className="mcp-secret-heading"><span className="service-form-label">Environment variables — JSON object</span><button type="button" className="mcp-secret-toggle" onClick={() => setRevealManualSecrets((value) => !value)}>{revealManualSecrets ? "Hide values" : "Reveal values"}</button></div>
                  <textarea className={revealManualSecrets ? "service-textarea mcp-secret-input mcp-secret-revealed" : "service-textarea mcp-secret-input"} rows={3} value={manualForm.envJson} onChange={(event) => setManualForm((current) => ({ ...current, envJson: event.target.value }))} spellCheck={false} />
                  <span className="service-form-hint">Values are encrypted with Windows secure storage. They are never sent back to the renderer.</span>
                </label>
              </>
            ) : (
              <>
                <label className="service-form-field">
                  <span className="service-form-label">MCP endpoint URL</span>
                  <Input value={manualForm.url} onChange={(event) => setManualForm((current) => ({ ...current, url: event.target.value }))} placeholder="https://provider.example/mcp" required />
                </label>
                <label className="service-form-field">
                  <div className="mcp-secret-heading"><span className="service-form-label">HTTP headers — JSON object</span><button type="button" className="mcp-secret-toggle" onClick={() => setRevealManualSecrets((value) => !value)}>{revealManualSecrets ? "Hide values" : "Reveal values"}</button></div>
                  <textarea className={revealManualSecrets ? "service-textarea mcp-secret-input mcp-secret-revealed" : "service-textarea mcp-secret-input"} rows={3} value={manualForm.headersJson} onChange={(event) => setManualForm((current) => ({ ...current, headersJson: event.target.value }))} spellCheck={false} />
                  <span className="service-form-hint">Authorization headers are encrypted with Windows secure storage. Public endpoints must use HTTPS; HTTP is allowed only on loopback.</span>
                </label>
              </>
            )}
            <div className="service-form-actions">
              <Button type="button" variant="secondary" onClick={() => setManualOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={busyId !== null}><Plus size={13} /> Save connection</Button>
            </div>
          </form>
        </Card>
      )}

      {tab === 'discover' ? (
        <section className="mcp-discover-section">
          <div className="mcp-registry-intro">
            <div>
              <div className="mcp-registry-title"><ShieldCheck size={17} /> Official MCP Registry <span>Preview</span></div>
              <p>Browse published MCP server metadata. Listings are not security certifications; review the publisher, permissions and privacy policy before connecting.</p>
            </div>
            <Button variant="secondary" onClick={() => void searchRegistry(true)} disabled={loadingRegistry}>
              <RefreshCw size={13} /> Refresh catalogue
            </Button>
          </div>
          <form className="mcp-search-row" onSubmit={(event) => { event.preventDefault(); void searchRegistry(true) }}>
            <div className="mcp-search-input">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search servers — e.g. filesystem, github, database" />
            </div>
            <Button type="submit" disabled={loadingRegistry || (query.trim().length > 0 && query.trim().length < 3)}>
              {loadingRegistry ? <LoaderCircle size={14} className="mcp-spin" /> : <Search size={14} />} Search
            </Button>
          </form>
          <div className="mcp-results-meta">
            <span>{registryCount.toLocaleString()} matching registry entries</span>
            <span>Latest published versions · status verified from registry metadata</span>
          </div>
          {servers.length === 0 && !loadingRegistry ? (
            <div className="empty-state"><Blocks size={34} /><p>No MCP servers found.</p><span>Try a different search query.</span></div>
          ) : (
            <div className="mcp-server-grid">
              {servers.map((server) => (
                <ServerCard
                  key={server.name}
                  server={server}
                  onAddLocal={(entry, pkg) => void addLocalPackage(entry, pkg)}
                  onAddRemote={(entry, url) => void addRemoteEndpoint(entry, url)}
                  busy={busyId !== null || installedIds.has(server.name)}
                />
              ))}
            </div>
          )}
          {cursor && (
            <div className="mcp-load-more">
              <Button variant="secondary" onClick={() => void searchRegistry(false)} disabled={loadingRegistry}>
                {loadingRegistry ? <LoaderCircle size={14} className="mcp-spin" /> : <ArrowDownToLine size={14} />} Load more
              </Button>
            </div>
          )}
        </section>
      ) : (
        <section className="mcp-installed-section">
          <div className="mcp-section-heading">
            <div>
              <h2>Saved MCP connections</h2>
              <p>Servers are not launched automatically when DevKit opens. Connect them only when needed.</p>
            </div>
            <Button variant="secondary" onClick={() => void refreshConnections()}><RefreshCw size={13} /> Refresh</Button>
          </div>
          {connections.length === 0 ? (
            <div className="empty-state"><Unplug size={34} /><p>No MCP connections saved.</p><span>Find a server in Discover or add one manually.</span></div>
          ) : (
            <div className="mcp-connection-list">
              {connections.map((connection) => (
                <Card key={connection.id}>
                  <div className="mcp-connection-heading">
                    <div className="mcp-server-icon"><Blocks size={18} /></div>
                    <div className="mcp-server-heading-main">
                      <strong>{connection.name}</strong>
                      <code>{connection.transportType === 'stdio' ? [connection.command, connection.argumentCount ? '(' + connection.argumentCount + ' args)' : ''].filter(Boolean).join(' ') : connection.endpointOrigin}</code>
                    </div>
                    <ConnectionState state={connection.state} />
                  </div>
                  {connection.description && <p className="mcp-server-description">{connection.description}</p>}
                  <div className="mcp-server-meta">
                    <span>{connection.transportType === 'stdio' ? 'Local stdio' : 'Remote Streamable HTTP'}</span>
                    <span>{connection.tools.length} discovered tools</span>
                    {connection.serverInfo && <span>Server <strong>{connection.serverInfo.name} {connection.serverInfo.version}</strong></span>}
                    {connection.pid && <span>PID <strong>{connection.pid}</strong></span>}
                    {connection.envKeys.length > 0 && <span>Environment <strong>{connection.envKeys.length} protected values</strong></span>}
                    {connection.headerKeys.length > 0 && <span>Headers <strong>{connection.headerKeys.join(', ')}</strong></span>}
                  </div>
                  {connection.error && <div className="mcp-connection-error"><AlertCircle size={13} />{connection.error}</div>}
                  <div className="mcp-connection-actions">
                    {connection.state === 'connected' ? (
                      <Button variant="secondary" onClick={() => void disconnect(connection)} disabled={busyId !== null}>
                        <Unplug size={13} /> Disconnect
                      </Button>
                    ) : (
                      <Button onClick={() => void connect(connection)} disabled={busyId !== null}>
                        {busyId === connection.id ? <LoaderCircle size={13} className="mcp-spin" /> : <CirclePlay size={13} />} Connect
                      </Button>
                    )}
                    <Button variant="ghost" onClick={() => setExpandedId((current) => current === connection.id ? null : connection.id)}>
                      {expandedId === connection.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />} Tools ({connection.tools.length})
                    </Button>
                    <Button variant="ghost" onClick={() => void remove(connection)} disabled={busyId !== null || connection.state === 'connected'}>
                      <Trash2 size={13} /> Remove
                    </Button>
                  </div>
                  {expandedId === connection.id && (
                    <div className="mcp-tool-list">
                      {connection.tools.length === 0 ? (
                        <span>No tools discovered yet. Connect to request the server's tools/list.</span>
                      ) : connection.tools.map((tool) => (
                        <div className="mcp-tool-row" key={tool.name}>
                          <code>{tool.name}</code>
                          <span>{tool.description || 'No description supplied.'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="mcp-security-note">
        <ShieldAlert size={15} />
        <span>Security boundary: DevKit does not run registry packages during discovery or when saving a connection. A local server runs with your Windows account permissions after you confirm Connect. Credentials are encrypted at rest using Windows secure storage.</span>
      </div>
    </div>
  )
}
