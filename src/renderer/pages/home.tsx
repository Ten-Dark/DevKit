import { useState } from 'react'
import { Search } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card, CardTitle, CardBody } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { ToolCard } from '../components/tool-card'
import { PageHeader } from '../components/page-header'
import { tools } from './tools'

export default function Home() {
  const [favorites, setFavorites] = useState<string[]>([])
  const featured = tools.slice(0, 4)
  const recent = tools.slice(4)

  const toggleFavorite = (id: string) =>
    setFavorites((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )

  const isFavorite = (id: string) => favorites.includes(id)

  return (
    <div className="page">
      <PageHeader
        title="Welcome back"
        description="Open a tool to get started. Press Ctrl+K to open the command palette."
      />

      <div className="flex items-center gap-2" style={{ maxWidth: 360, marginBottom: 24 }}>
        <span style={{ color: 'var(--text-muted)' }}><Search size={16} /></span>
        <Input placeholder="Search tools..." />
      </div>

      <div className="flex gap-4">
        <section className="flex-1">
          <h2 className="section-title">Featured</h2>
          <div className="tools-grid">
            {featured.map((tool) => (
              <ToolCard
                key={tool.id}
                {...tool}
                favorite={isFavorite(tool.id)}
                onToggleFavorite={() => toggleFavorite(tool.id)}
              />
            ))}
          </div>
        </section>

        <section className="flex-1">
          <h2 className="section-title">Recent</h2>
          <div className="flex flex-col gap-3">
            {recent.map((tool) => (
              <Card key={tool.id}>
                <CardTitle icon={tool.icon}>{tool.title}</CardTitle>
                <CardBody>{tool.description}</CardBody>
              </Card>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
