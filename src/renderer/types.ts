import type { ReactElement } from 'react'

// Re-export shared types for backward compatibility with renderer code
export type {
  AppSettings,
  ProjectFile,
  ProjectDirectoryScan,
  ProjectMarkdownIssue,
  ProjectMarkdownOptions,
  ProjectMarkdownStats,
  ProjectMarkdownResult,
  ConversionResult,
  XMindConversionResult,
  XMindHyperlink,
  XMindTopic,
  UpdaterInfo,
  UpdaterActionResult,
} from '../shared/types'

// Renderer-specific types (React-dependent)
export type Page =
  | 'home'
  | 'tools'
  | 'services'
  | 'settings'
  | 'project-to-markdown'
  | 'xmind-to-markdown'

export type ToolDestination = Extract<Page, 'project-to-markdown' | 'xmind-to-markdown'>

export interface Tool {
  id: ToolDestination
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
