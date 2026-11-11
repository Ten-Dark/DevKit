import { useState } from 'react'
import { FolderOpen, FileText, Edit3, ClipboardList, Terminal, Settings, FileCode } from 'lucide-react'
import { ToolCard } from '../components/tool-card'
import { PageHeader } from '../components/page-header'
import { Tool } from '../types'

export const tools: Tool[] = [
  {
    id: 'open-directory',
    title: 'Open Directory',
    description: 'Browse and open a folder on disk to inspect its contents.',
    category: 'Files',
    favorite: false,
    icon: <FolderOpen size={18} />,
  },
  {
    id: 'read-file',
    title: 'Read File',
    description: 'Read the contents of a file from disk.',
    category: 'Files',
    favorite: false,
    icon: <FileText size={18} />,
  },
  {
    id: 'write-file',
    title: 'Write File',
    description: 'Create or overwrite a file on disk.',
    category: 'Files',
    favorite: false,
    icon: <Edit3 size={18} />,
  },
  {
    id: 'project-to-markdown',
    title: 'Project to Markdown',
    description: 'Convert a project folder into a single Markdown document with a file tree and fenced code blocks.',
    category: 'Files',
    favorite: false,
    icon: <FileCode size={18} />,
  },
  {
    id: '/tools/xmind-to-markdown',
    title: 'XMind to Markdown',
    description: 'Convert an XMind (.xmind) mind map into a Markdown outline with topics and notes.',
    category: 'Files',
    favorite: false,
    icon: <FileText size={18} />,
  },
  {
    id: 'clipboard',
    title: 'Clipboard',
    description: 'Copy, paste, and manage clipboard contents.',
    category: 'Utilities',
    favorite: false,
    icon: <ClipboardList size={18} />,
  },
  {
    id: 'terminal',
    title: 'Terminal',
    description: 'Run shell commands and view their output.',
    category: 'Utilities',
    favorite: false,
    icon: <Terminal size={18} />,
  },
  {
    id: 'settings',
    title: 'Settings',
    description: 'Configure application preferences.',
    category: 'System',
    favorite: false,
    icon: <Settings size={18} />,
  },
]

export default function ToolsPage({ onSelect }: { onSelect?: (id: string) => void }) {
  const [favorites, setFavorites] = useState<string[]>([])

  const toggleFavorite = (id: string) =>
    setFavorites((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )

  const isFavorite = (id: string) => favorites.includes(id)

  return (
    <div className="page">
      <PageHeader title="Tools" description="Browse all available tools." />

      <div className="tools-grid">
        {tools.map((tool) => (
          <ToolCard
            key={tool.id}
            {...tool}
            favorite={isFavorite(tool.id)}
            onToggleFavorite={() => toggleFavorite(tool.id)}
            onClick={() => {
              onSelect?.(tool.id)
            }}
          />
        ))}
      </div>

      {tools.length === 0 && (
        <div className="empty-state">
          <span className="empty-state-icon">&#129352;</span>
          <p>No tools available.</p>
        </div>
      )}
    </div>
  )
}
