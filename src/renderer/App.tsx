import { useState } from 'react'
import React from 'react'
import { Home, PanelLeft, Settings, Search } from 'lucide-react'
import { Sidebar } from './components/sidebar'
import { CommandPalette } from './components/command-palette'
import { PageHeader } from './components/page-header'
import HomePage from './pages/home'
import ToolsPage from './pages/tools'
import { Page } from './types'

const PALETTE_RESULTS: { id: Page; title: string; subtitle: string; icon: React.ReactElement }[] = [  { id: 'home', title: 'Home', subtitle: 'Dashboard and quick actions', icon: <Home size={16} /> },
  { id: 'tools', title: 'Tools', subtitle: 'Browse all available tools', icon: <PanelLeft size={16} /> },
  { id: 'settings', title: 'Settings', subtitle: 'Application preferences', icon: <Settings size={16} /> },
]

export default function App() {
  const [page, setPage] = useState<Page>('home')
  const [paletteOpen, setPaletteOpen] = useState(false)

  return (
    <div className="app-shell">
      <Sidebar activeId={page} onSelect={(id: string) => { setPage(id as Page); }} />
      <main className="app-main">
        <CommandPalette
          open={paletteOpen}
          onToggle={() => setPaletteOpen((open) => !open)}
          onClose={() => setPaletteOpen(false)}
          results={PALETTE_RESULTS.map((result) => ({
            ...result,
            onSelect: () => {
              setPage(result.id)
              setPaletteOpen(false)
            },
          }))}
        />
        {page === 'home' ? <HomePage /> : page === 'tools' ? <ToolsPage /> : <PageHeader title="Settings" description="Application preferences." />}
      </main>
    </div>
  )
}
