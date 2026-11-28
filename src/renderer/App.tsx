import { useEffect, useRef, useState } from 'react'
import { Home, PanelLeft, Settings, FileCode, FileText, Server, Blocks, HardDrive } from 'lucide-react'
import { Sidebar } from './components/sidebar'
import { CommandPalette } from './components/command-palette'
import HomePage from './pages/home'
import ToolsPage, { tools } from './pages/tools'
import SettingsPage from './pages/settings'
import ProjectToMarkdownPage from './pages/project-to-markdown'
import XMindToMarkdownPage from './pages/xmind-to-markdown'
import ServicesPage from './pages/services'
import McpLibraryPage from './pages/mcp-library'
import StoragePage from './pages/storage'
import { AppSettings } from './types'
import { Page, ToolDestination } from './types'

const PAGE_IDS: readonly Page[] = ['home', 'tools', 'services', 'mcp-library', 'storage', 'settings', 'project-to-markdown', 'xmind-to-markdown']
const TOOL_IDS = new Set<string>(tools.map((tool) => tool.id))
const MAX_RECENTS = 8

function normalizeToolIds(value: unknown): ToolDestination[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter((id): id is ToolDestination => typeof id === 'string' && TOOL_IDS.has(id)))]
}

function normalizeRecents(value: unknown): ToolDestination[] {
  return normalizeToolIds(value).slice(0, MAX_RECENTS)
}

function isPage(id: string): id is Page {
  return PAGE_IDS.some((pageId) => pageId === id)
}

const PALETTE_RESULTS: { id: Page; title: string; subtitle: string; icon: React.ReactElement }[] = [
  { id: 'home', title: 'Home', subtitle: 'Dashboard and quick actions', icon: <Home size={16} /> },
  { id: 'tools', title: 'Tools', subtitle: 'Browse all available tools', icon: <PanelLeft size={16} /> },
  { id: 'services', title: 'Services', subtitle: 'Manage local services and dependencies', icon: <Server size={16} /> },
  { id: 'mcp-library', title: 'MCP & Integrations', subtitle: 'Discover and manage MCP servers', icon: <Blocks size={16} /> },
  { id: 'project-to-markdown', title: 'Project to Markdown', subtitle: 'Convert a project folder to Markdown', icon: <FileCode size={16} /> },
  { id: 'xmind-to-markdown', title: 'XMind to Markdown', subtitle: 'Convert an XMind mind map to Markdown', icon: <FileText size={16} /> },
  { id: 'settings', title: 'Settings', subtitle: 'Application preferences', icon: <Settings size={16} /> },
  { id: 'storage', title: 'Storage', subtitle: 'Connect folders and knowledge stores', icon: <HardDrive size={16} /> },
]

export default function App() {
  const [page, setPage] = useState<Page>('home')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [favorites, setFavorites] = useState<ToolDestination[]>([])
  const [recents, setRecents] = useState<ToolDestination[]>([])
  const [persistenceError, setPersistenceError] = useState<string | null>(null)
  const favoritesRef = useRef<ToolDestination[]>([])
  const recentsRef = useRef<ToolDestination[]>([])
  const userChangedFavoritesRef = useRef(false)
  const userChangedRecentsRef = useRef(false)
  const settingsLoadStatusRef = useRef<'loading' | 'loaded' | 'error'>('loading')
  const mountedRef = useRef(false)
  const settingsLoadGenerationRef = useRef(0)
  const pendingFavoriteUpdatesRef = useRef<Array<(current: ToolDestination[]) => ToolDestination[]>>([])
  const pendingRecentUpdatesRef = useRef<Array<(current: ToolDestination[]) => ToolDestination[]>>([])
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve())
  const settingsLoadRef = useRef<Promise<void>>(Promise.resolve())
  const navigationRequestRef = useRef(0)

  const startSettingsLoad = () => {
    const generation = ++settingsLoadGenerationRef.current
    settingsLoadStatusRef.current = 'loading'
    const load = Promise.resolve().then(() => window.api.getSettings())
      .then((settings: AppSettings) => {
        if (!mountedRef.current || generation !== settingsLoadGenerationRef.current) return
        const loadedFavorites = normalizeToolIds(settings?.favorites)
        const loadedRecents = normalizeRecents(settings?.recents)
        const nextFavorites = pendingFavoriteUpdatesRef.current.reduce((current, update) => update(current), loadedFavorites)
        const nextRecents = pendingRecentUpdatesRef.current.reduce((current, update) => update(current), loadedRecents)
        pendingFavoriteUpdatesRef.current = []
        pendingRecentUpdatesRef.current = []
        favoritesRef.current = nextFavorites
        recentsRef.current = nextRecents
        setFavorites(nextFavorites)
        setRecents(nextRecents)
        settingsLoadStatusRef.current = 'loaded'
        setPersistenceError(null)
      })
      .catch(() => {
        if (mountedRef.current && generation === settingsLoadGenerationRef.current) {
          settingsLoadStatusRef.current = 'error'
          setPersistenceError('Could not load saved app data. Changes remain visible, but cannot be saved until settings are recovered.')
        }
      })
    settingsLoadRef.current = load
    return load
  }

  const ensureSettingsLoaded = () => {
    if (settingsLoadStatusRef.current === 'loaded') return Promise.resolve()
    if (settingsLoadStatusRef.current === 'loading') return settingsLoadRef.current
    return startSettingsLoad()
  }

  useEffect(() => {
    mountedRef.current = true
    void startSettingsLoad()
    return () => { mountedRef.current = false }
  }, [])

  const enqueueSettingsSave = () => {
    const loadAttempt = ensureSettingsLoaded()
    saveQueueRef.current = saveQueueRef.current
      .catch(() => undefined)
      .then(() => loadAttempt)
      .then(async () => {
        if (settingsLoadStatusRef.current !== 'loaded') throw new Error('Settings are not loaded.')
        const result = await window.api.saveSettings({
          favorites: [...favoritesRef.current],
          recents: [...recentsRef.current],
        })
        if (!result.success) throw new Error('Settings save failed.')
        setPersistenceError(null)
      })
      .catch(() => {
        if (settingsLoadStatusRef.current === 'loaded') {
          setPersistenceError('App data could not be saved. Your current selection remains visible, but is not guaranteed to persist.')
        }
      })
  }
  const toggleFavorite = (id: ToolDestination) => {
    userChangedFavoritesRef.current = true
    const update = (current: ToolDestination[]) => current.includes(id)
      ? current.filter((favorite) => favorite !== id)
      : [...current, id]
    if (settingsLoadStatusRef.current !== 'loaded') pendingFavoriteUpdatesRef.current.push(update)
    const next = update(favoritesRef.current)
    favoritesRef.current = next
    setFavorites(next)
    enqueueSettingsSave()
  }

  const recordRecent = (id: ToolDestination) => {
    userChangedRecentsRef.current = true
    const update = (current: ToolDestination[]) => [id, ...current.filter((recent) => recent !== id)].slice(0, MAX_RECENTS)
    if (settingsLoadStatusRef.current !== 'loaded') pendingRecentUpdatesRef.current.push(update)
    const next = update(recentsRef.current)
    recentsRef.current = next
    setRecents(next)
    enqueueSettingsSave()
  }

  const removeRecent = (id: ToolDestination) => {
    userChangedRecentsRef.current = true
    const update = (current: ToolDestination[]) => current.filter((recent) => recent !== id)
    if (settingsLoadStatusRef.current !== 'loaded') pendingRecentUpdatesRef.current.push(update)
    const next = update(recentsRef.current)
    if (next.length === recentsRef.current.length) return
    recentsRef.current = next
    setRecents(next)
    enqueueSettingsSave()
  }

  const handleSettingsReset = () => {
    favoritesRef.current = []
    recentsRef.current = []
    userChangedFavoritesRef.current = true
    userChangedRecentsRef.current = true
    setFavorites([])
    setRecents([])
    setPersistenceError(null)
  }

  const onSelectPage = (id: string) => {
    setPaletteOpen(false)
    if (!isPage(id)) return
    const navigationRequest = ++navigationRequestRef.current
    if (id === 'settings') {
      const shouldPersistRecoveredUpdates = settingsLoadStatusRef.current === 'error'
        && (pendingFavoriteUpdatesRef.current.length > 0 || pendingRecentUpdatesRef.current.length > 0)
      void ensureSettingsLoaded()
        .then(() => {
          if (settingsLoadStatusRef.current === 'loaded' && shouldPersistRecoveredUpdates) enqueueSettingsSave()
          return saveQueueRef.current.catch(() => undefined)
        })
        .then(() => {
          if (settingsLoadStatusRef.current === 'loaded' && navigationRequest === navigationRequestRef.current) setPage(id)
        })
      return
    }
    if (TOOL_IDS.has(id)) recordRecent(id as ToolDestination)
    setPage(id)
  }

  const pageRenderers: Record<Page, () => React.ReactNode> = {
    home: () => <HomePage favorites={favorites} onToggleFavorite={toggleFavorite} recents={recents} onSelect={onSelectPage} onRemoveRecent={removeRecent} />,
    tools: () => <ToolsPage onSelect={onSelectPage} favorites={favorites} onToggleFavorite={toggleFavorite} />,
    services: () => <ServicesPage />,
    'mcp-library': () => <McpLibraryPage />,
    storage: () => <StoragePage />,
    settings: () => <SettingsPage onResetSuccess={handleSettingsReset} />,
    'project-to-markdown': () => <ProjectToMarkdownPage />,
    'xmind-to-markdown': () => <XMindToMarkdownPage />,
  }

  return (
    <div className="app-shell">
      <Sidebar activeId={page} onSelect={onSelectPage} />
      <main className="app-main">
        <CommandPalette key={paletteOpen ? 'open' : 'closed'}
          open={paletteOpen}
          onToggle={() => setPaletteOpen((open) => !open)}
          onClose={() => setPaletteOpen(false)}
          results={PALETTE_RESULTS.map((result) => ({ ...result, onSelect: () => onSelectPage(result.id) }))}
        />
        {persistenceError && (
          <div role="alert" className="page" style={{ paddingBottom: 0 }}>
            <div style={{ padding: '10px 14px', borderRadius: 6, border: '1px solid var(--accent)', backgroundColor: 'rgba(116, 22, 46, 0.15)', color: 'var(--accent-light)' }}>
              {persistenceError}
            </div>
          </div>
        )}
        {pageRenderers[page]()}
      </main>
    </div>
  )
}
