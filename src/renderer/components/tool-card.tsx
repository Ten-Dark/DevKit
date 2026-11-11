import { Star } from 'lucide-react'
import { clsx } from 'clsx'

interface ToolCardProps {
  title: string
  description: string
  icon?: React.ReactElement
  category?: string
  favorite: boolean
  onToggleFavorite: () => void
}

export function ToolCard({ title, description, icon, category, favorite, onToggleFavorite }: ToolCardProps) {
  return (
    <article className="tool-card" role="button" tabIndex={0}>
      <div className="tool-card-icon">{icon}</div>
      <div className="tool-card-body">
        {category && <span className="badge">{category}</span>}
        <h3 className="tool-card-title">{title}</h3>
        <p className="tool-card-description">{description}</p>
      </div>
      <button
        className={clsx('tool-card-favorite', favorite && 'tool-card-favorite-active')}
        aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
        onClick={(e) => {
          e.stopPropagation()
          onToggleFavorite()
        }}
      >
        <Star size={16} fill={favorite ? 'var(--accent)' : 'none'} stroke={favorite ? 'none' : 'var(--text-muted)'} strokeWidth={1.5} />
      </button>
    </article>
  )
}

