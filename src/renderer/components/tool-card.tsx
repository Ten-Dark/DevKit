import { Star } from 'lucide-react'
import { clsx } from 'clsx'

interface ToolCardProps {
  title: string
  description: string
  icon?: React.ReactElement
  category?: string
  favorite: boolean
  onToggleFavorite: () => void
  onClick?: () => void
}

export function ToolCard({ title, description, icon, category, favorite, onToggleFavorite, onClick }: ToolCardProps) {
  return (
    <article className="tool-card">
      <button
        type="button"
        className="tool-card-main"
        aria-label={`Open ${title}`}
        onClick={onClick}
        disabled={!onClick}
      >
        <span className="tool-card-icon" aria-hidden="true">{icon}</span>
        <span className="tool-card-body">
          {category && <span className="badge">{category}</span>}
          <span className="tool-card-title">{title}</span>
          <span className="tool-card-description">{description}</span>
        </span>
      </button>
      <button
        type="button"
        className={clsx('tool-card-favorite', favorite && 'tool-card-favorite-active')}
        aria-label={favorite ? `Remove ${title} from favorites` : `Add ${title} to favorites`}
        onClick={onToggleFavorite}
      >
        <Star size={16} fill={favorite ? 'var(--accent)' : 'none'} stroke={favorite ? 'none' : 'var(--text-muted)'} strokeWidth={1.5} />
      </button>
    </article>
  )
}

