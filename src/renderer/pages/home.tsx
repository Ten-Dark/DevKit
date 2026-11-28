import { Activity, Blocks, HardDrive, RefreshCw, Search, Server, X, Clock } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Input } from '../components/ui/input'
import { ToolCard } from '../components/tool-card'
import { PageHeader } from '../components/page-header'
import { tools } from './tools'
import { ToolDestination } from '../types'
import type { McpWorkersHealthStatus } from '../../main/integrations/mcpworkers-client.js'

interface HomeProps {
  favorites: ToolDestination[]
  onToggleFavorite: (id: ToolDestination) => void
  recents: ToolDestination[]
  onSelect: (id: string) => void
  onRemoveRecent: (id: ToolDestination) => void
}

type WorkspaceOverview = {
  services: Awaited<ReturnType<typeof window.api.runtime.listServices>> | null
  mcpWorkers: McpWorkersHealthStatus | null
  mcpConnections: Awaited<ReturnType<typeof window.api.mcp.listConnections>> | null
  storage: Awaited<ReturnType<typeof window.api.storage.getStatus>> | null
  karakeep: Awaited<ReturnType<typeof window.api.storage.karakeep.getStatus>> | null
}

export default function Home({ favorites, onToggleFavorite, recents, onSelect, onRemoveRecent }: HomeProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const normalizedQuery = searchQuery.trim().replace(/\s+/g, ' ').toLowerCase()
  const searchResults = useMemo(() => {
    if (!normalizedQuery) return []
    return tools.filter((tool) =>
      [tool.title, tool.description, tool.category]
        .some((field) => field.toLowerCase().includes(normalizedQuery)),
    )
  }, [normalizedQuery])
  const featured = tools.slice(0, 4)
  const recentTools = recents.map((id) => tools.find((tool) => tool.id === id))
    .filter((tool): tool is (typeof tools)[number] => Boolean(tool))
  const isFavorite = (id: string) => favorites.includes(id as ToolDestination)
  const [workspace, setWorkspace] = useState<WorkspaceOverview>({ services: null, mcpWorkers: null, mcpConnections: null, storage: null, karakeep: null })

  const [workspaceLoading, setWorkspaceLoading] = useState(true)
  const [workspaceError, setWorkspaceError] = useState<string | null>(null)

  const loadWorkspace = useCallback(async () => {
    const [servicesResult, mcpWorkersResult, mcpResult, storageResult, karakeepResult] = await Promise.allSettled([
      window.api.runtime.listServices(),
      window.api.mcpWorkers.getHealth(),

      window.api.mcp.listConnections(),
      window.api.storage.getStatus(),
      window.api.storage.karakeep.getStatus(),
    ])
    setWorkspace({
      services: servicesResult.status === 'fulfilled' ? servicesResult.value : null,
      mcpWorkers: mcpWorkersResult.status === 'fulfilled' ? mcpWorkersResult.value : null,
      mcpConnections: mcpResult.status === 'fulfilled' ? mcpResult.value : null,
      storage: storageResult.status === 'fulfilled' ? storageResult.value : null,
      karakeep: karakeepResult.status === 'fulfilled' ? karakeepResult.value : null,
    })
    const failed = [servicesResult, mcpWorkersResult, mcpResult, storageResult, karakeepResult].filter((result) => result.status === 'rejected').length
    setWorkspaceError(failed > 0 ? 'Some workspace status could not be loaded. Use Refresh to retry.' : null)
    setWorkspaceLoading(false)
  }, [])


  const refreshWorkspace = useCallback(async () => {
    setWorkspaceLoading(true)
    await loadWorkspace()
  }, [loadWorkspace])

  useEffect(() => { void Promise.resolve().then(loadWorkspace) }, [loadWorkspace])
  return (
    <div className="page">
      <PageHeader title="Workspace overview" description="Live status for your Runtime services, MCPWorkers, MCP connections, and Storage. Press Ctrl+K to navigate." />
      <section className="workspace-overview" aria-label="Workspace status">
        <div className="workspace-overview-header">
          <h2 className="section-title">Workspace status</h2>
          <button type="button" className="workspace-refresh" onClick={() => void refreshWorkspace()} disabled={workspaceLoading} aria-label="Refresh workspace status">
            <RefreshCw size={14} /> {workspaceLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
        {workspaceError && <div className="service-message service-message-error" role="status">{workspaceError}</div>}
        <div className="workspace-overview-grid">
          <button type="button" className="workspace-overview-card" onClick={() => onSelect('services')} aria-label="Open Services">
            <span className="workspace-overview-card-title"><Server size={15} /> Runtime services</span>
            <strong className="workspace-overview-value">{workspace.services ? workspace.services.length : workspaceLoading ? '…' : 'Unavailable'}</strong>
            <span className="workspace-overview-meta">{workspace.services
              ? workspace.services.filter((item) => item.snapshot.state === 'running').length + ' running · ' + workspace.services.filter((item) => item.snapshot.state === 'degraded').length + ' degraded'
              : 'Status unavailable'}</span>
          </button>
          <button type="button" className="workspace-overview-card" onClick={() => onSelect('services')} aria-label="Open MCPWorkers Manager">
            <span className="workspace-overview-card-title"><Blocks size={15} /> MCPWorkers Manager</span>
            <strong className="workspace-overview-value">{workspace.mcpWorkers?.state === 'reachable' ? 'API v1' : workspaceLoading ? '…' : workspace.mcpWorkers?.state === 'incompatible' ? 'Incompatible' : workspace.mcpWorkers?.state === 'error' ? 'Error' : 'Unavailable'}</strong>
            <span className="workspace-overview-meta">{workspace.mcpWorkers?.state === 'reachable'
              ? 'Manager reachable · authentication not configured'
              : workspace.mcpWorkers?.detail ?? 'Status unavailable'}</span>
          </button>
          <button type="button" className="workspace-overview-card" onClick={() => onSelect('mcp-library')} aria-label="Open MCP connections">
            <span className="workspace-overview-card-title"><Activity size={15} /> MCP connections</span>
            <strong className="workspace-overview-value">{workspace.mcpConnections ? workspace.mcpConnections.length : workspaceLoading ? '…' : 'Unavailable'}</strong>
            <span className="workspace-overview-meta">{workspace.mcpConnections
              ? workspace.mcpConnections.filter((item) => item.state === 'connected').length + ' connected · ' + workspace.mcpConnections.filter((item) => item.state === 'error').length + ' errors'
              : 'Status unavailable'}</span>
          </button>
          <button type="button" className="workspace-overview-card" onClick={() => onSelect('storage')} aria-label="Open Storage">
            <span className="workspace-overview-card-title"><HardDrive size={15} /> Storage</span>
            <strong className="workspace-overview-value">{workspaceLoading ? '…' : [workspace.storage?.state === 'connected', workspace.karakeep?.state === 'connected'].filter(Boolean).length || (workspace.storage || workspace.karakeep ? 'Unavailable' : 'Not connected')}</strong>
            <span className="workspace-overview-meta">{[workspace.storage?.state === 'connected' ? workspace.storage.name : null, workspace.karakeep?.state === 'connected' ? workspace.karakeep.name : null].filter(Boolean).join(' · ') || (workspace.storage || workspace.karakeep ? 'Source unavailable' : 'No source connected')}{[workspace.storage?.state === 'connected', workspace.karakeep?.state === 'connected'].some(Boolean) ? ' · read-only' : ''}</span>
          </button>
        </div>
      </section>
      <div className="flex items-center gap-2" style={{ maxWidth: 360, marginBottom: 24 }}>

        <span style={{ color: 'var(--text-muted)' }}><Search size={16} /></span>
        <Input
          type="search"
          aria-label="Search tools"
          placeholder="Search tools..."
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
        />
        {searchQuery.length > 0 && (
          <button type="button" aria-label="Clear search" onClick={() => setSearchQuery('')}
            style={{ border: 0, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', padding: 6 }}>
            <X size={15} />
          </button>
        )}
      </div>
      {normalizedQuery ? (
        <section aria-live="polite" aria-label="Search results">
          <h2 className="section-title">Search results</h2>
          {searchResults.length > 0 ? (
            <div className="tools-grid" data-testid="home-search-results">
              {searchResults.map((tool) => (
                <ToolCard key={tool.id} {...tool} favorite={isFavorite(tool.id)}
                  onToggleFavorite={() => onToggleFavorite(tool.id)} onClick={() => onSelect(tool.id)} />
              ))}
            </div>
          ) : (
            <div className="empty-state" data-testid="home-search-empty">
              <span className="empty-state-icon"><Search size={22} /></span>
              <p>No tools found.</p>
              <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Try a different search term.</span>
            </div>
          )}
        </section>
      ) : (
        <div className="flex gap-4">
          <section className="flex-1">
            <h2 className="section-title">Featured</h2>
            <div className="tools-grid">
              {featured.map((tool) => (
                <ToolCard key={tool.id} {...tool} favorite={isFavorite(tool.id)}
                  onToggleFavorite={() => onToggleFavorite(tool.id)} onClick={() => onSelect(tool.id)} />
              ))}
            </div>
          </section>
          <section className="flex-1">
            <h2 className="section-title">Recent</h2>
            {recentTools.length === 0 ? (
              <div className="empty-state" data-testid="recents-empty">
                <span className="empty-state-icon"><Clock size={22} /></span>
                <p>No recently opened tools yet.</p>
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>Tools you open will appear here.</span>
              </div>
            ) : (
              <div className="flex flex-col gap-3" data-testid="recents-list">
                {recentTools.map((tool) => (
                  <article key={tool.id} className="tool-card"
                    style={{ display: 'flex', alignItems: 'center', gap: 12, cursor: 'default' }}>
                    <button type="button" onClick={() => onSelect(tool.id)} aria-label={'Open ' + tool.title}
                      style={{ display: 'flex', alignItems: 'center', gap: 12, flex: 1, minWidth: 0, padding: 0,
                        border: 0, background: 'transparent', color: 'inherit', textAlign: 'left', cursor: 'pointer' }}>
                      <span className="tool-card-icon">{tool.icon}</span>
                      <span className="tool-card-body">
                        <span className="tool-card-title">{tool.title}</span>
                        <span className="tool-card-description">{tool.description}</span>
                      </span>
                    </button>
                    <button type="button" aria-label={'Remove ' + tool.title + ' from recents'}
                      title="Remove from recents" onClick={() => onRemoveRecent(tool.id)}
                      style={{ border: 0, background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer', padding: 8 }}>
                      <X size={15} />
                    </button>
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
