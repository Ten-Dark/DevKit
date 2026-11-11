import type { ReactElement } from 'react'

export interface Tool {
  id: string
  title: string
  description: string
  category: string
  favorite: boolean
  icon?: ReactElement
}

export interface SidebarItem {
  id: string
  title: string
}

export interface CommandPaletteResult {
  id: string
  title: string
  subtitle?: string
  icon?: ReactElement
  onSelect: () => void
}

export type Page = 'home' | 'tools' | 'settings'
