import { useState } from 'react'
import React from 'react'
import { Home, PanelLeft, Settings, Search, FileCode } from 'lucide-react'
import { Sidebar } from './components/sidebar'
import { CommandPalette } from './components/command-palette'
import { PageHeader } from './components/page-header'
import HomePage from './pages/home'
import ToolsPage from './pages/tools'
import ProjectToMarkdownPage from './pages/project-to-markdown'
import { Page } from './types'

const PALETTE_RESULTS: { id: Page; title: string; subtitle: string; icon: React.ReactElement }[] = [
  { id: 'home', title: 'Home', subtitle: 'Dashboard and quick actions', icon: <Home size={16} /> },
  { id: 'tools', title: 'Tools', subtitle: 'Browse all available tools', icon: <PanelLeft size={16} /> },
  { id: 'project-to-markdown', title: 'Project to Markdown', subtitle: 'Convert a project folder to Markdown', icon: <FileCode size={16} /> },
  { id: 'settings', title: 'Settings', subtitle: 'Application preferences', icon: <Settings size={16} /> },
]

export default function App() {
  const [page, setPage] = useState<Page>('home')
  const [paletteOpen, setPaletteOpen] = useState(false)

  const onSelectPage = (id: string) => {
    setPage(id as Page)
    setPaletteOpen(false)
  }

  return (
    <div className="app-shell">
      <Sidebar activeId={page} onSelect={onSelectPage} />
      <main className="app-main">
        <CommandPalette
          open={paletteOpen}
          onToggle={() => setPaletteOpen((open) => !open)}
          onClose={() => setPaletteOpen(false)}
          results={PALETTE_RESULTS.map((result) => ({
            ...result,
            onSelect: () => onSelectPage(result.id),
          }))}
        />
        {page === 'home' ? (
          <HomePage />
        ) : page === 'tools' ? (
          <ToolsPage onSelect={onSelectPage} />
        ) : page === 'project-to-markdown' ? (
          <ProjectToMarkdownPage />
        ) : (
          <PageHeader title="Settings" description="Application preferences." />
        )}
      </main>
    </div>
  )
}
