import { Layout, PanelLeft, Server, Settings, Blocks, HardDrive } from 'lucide-react'
import { clsx } from 'clsx'

interface SidebarItem {
  id: string
  title: string
  icon: React.ReactElement
}

interface SidebarProps {
  items?: SidebarItem[]
  activeId: string | null
  onSelect: (id: string) => void
}

export function Sidebar({ items, activeId, onSelect }: SidebarProps) {
  const defaultItems: SidebarItem[] = [
    { id: 'home', title: 'Home', icon: <Layout className="sidebar-item-icon" /> },
    { id: 'tools', title: 'Tools', icon: <PanelLeft className="sidebar-item-icon" /> },
    { id: 'services', title: 'Services', icon: <Server className="sidebar-item-icon" /> },
    { id: 'mcp-library', title: 'MCP & Integrations', icon: <Blocks className="sidebar-item-icon" /> },
    { id: 'storage', title: 'Storage', icon: <HardDrive className="sidebar-item-icon" /> },
    { id: 'settings', title: 'Settings', icon: <Settings className="sidebar-item-icon" /> },
  ]

  return (
    <aside className={clsx('sidebar')}>
      <div className="sidebar-brand">
        <div className="sidebar-brand-icon"><Layout /></div>
        <span className="sidebar-brand-text">Dev Toolbox</span>
      </div>
      <nav className="sidebar-nav">
        {(items ?? defaultItems).map((item) => {
          const active = item.id === activeId
          return (
            <div key={item.id} role="button" tabIndex={0}
              onClick={() => onSelect(item.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onSelect(item.id)
                }
              }}
              className={clsx('sidebar-item', active && 'sidebar-item-active')}>
              {item.icon}<span>{item.title}</span>
            </div>
          )
        })}
      </nav>
    </aside>
  )
}
