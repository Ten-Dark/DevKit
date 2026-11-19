import { Search, X, Clock } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Input } from '../components/ui/input'
import { ToolCard } from '../components/tool-card'
import { PageHeader } from '../components/page-header'
import { tools } from './tools'
import { ToolDestination } from '../types'

interface HomeProps {
  favorites: ToolDestination[]
  onToggleFavorite: (id: ToolDestination) => void
  recents: ToolDestination[]
  onSelect: (id: string) => void
  onRemoveRecent: (id: ToolDestination) => void
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

  return (
    <div className="page">
      <PageHeader title="Welcome back" description="Open a tool to get started. Press Ctrl+K to open the command palette." />
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
