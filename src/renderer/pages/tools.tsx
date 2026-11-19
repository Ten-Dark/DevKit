import { FileText, FileCode } from 'lucide-react'
import { ToolCard } from '../components/tool-card'
import { PageHeader } from '../components/page-header'
import { Tool, ToolDestination } from '../types'

export const tools: Tool[] = [
  {
    id: 'project-to-markdown',
    title: 'Project to Markdown',
    description: 'Convert a project folder into a single Markdown document with a file tree and fenced code blocks.',
    category: 'Files',
    favorite: false,
    icon: <FileCode size={18} />,
  },
  {
    id: 'xmind-to-markdown',
    title: 'XMind to Markdown',
    description: 'Convert an XMind (.xmind) mind map into a Markdown outline with topics and notes.',
    category: 'Files',
    favorite: false,
    icon: <FileText size={18} />,
  },
]

interface ToolsPageProps {
  onSelect?: (id: ToolDestination) => void
  favorites: ToolDestination[]
  onToggleFavorite: (id: ToolDestination) => void
}

export default function ToolsPage({ onSelect, favorites, onToggleFavorite }: ToolsPageProps) {
  const isFavorite = (id: ToolDestination) => favorites.includes(id)

  return (
    <div className="page">
      <PageHeader title="Tools" description="Browse all available tools." />

      <div className="tools-grid">
        {tools.map((tool) => (
          <ToolCard
            key={tool.id}
            {...tool}
            favorite={isFavorite(tool.id)}
            onToggleFavorite={() => onToggleFavorite(tool.id)}
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
