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

export type Page = 'home' | 'tools' | 'settings' | 'project-to-markdown' | '/tools/xmind-to-markdown'

export interface ProjectFile {
  relativePath: string
  size: number
}

export interface ProjectMarkdownOptions {
  maxFileSizeKB: number
  includeTree: boolean
  respectGitignore: boolean
}

export interface ConversionResult {
  markdown: string
  fileCount: number
  skippedCount: number
  totalChars: number
}

export interface ConversionResult {
  markdown: string
  fileCount: number
  skippedCount: number
  totalChars: number
}

export interface XMindConversionResult {
  markdown: string
  title: string
  topicCount: number
  depth: number
}

export interface AppSettings {
  favorites: string[]
  recents: string[]
  theme: 'dark'
  maxFileSizeKB: number
  includeTree: boolean
  respectGitignore: boolean
}
