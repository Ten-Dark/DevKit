import type { ReactElement } from 'react'

// Re-export shared types for backward compatibility with renderer code
export type {
  AppSettings,
  ProjectFile,
  ProjectMarkdownOptions,
  ProjectMarkdownStats,
  ConversionResult,
  XMindConversionResult,
  XMindHyperlink,
  XMindTopic,
  UpdaterInfo,
} from '../shared/types'

// Renderer-specific types (React-dependent)
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

export type Page = 'home' | 'tools' | 'settings' | 'project-to-markdown' | '/tools/xmind-to-markdown'
