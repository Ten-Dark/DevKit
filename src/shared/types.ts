// Shared types used by both main process and renderer.
// No React, DOM, or renderer-specific dependencies.

export interface ProjectFile {
  relativePath: string
  size: number
}

export interface ProjectMarkdownOptions {
  maxFileSizeKB: number
  includeTree: boolean
  respectGitignore: boolean
}

export interface ProjectMarkdownStats {
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
  sheetsCount?: number
  warnings?: string[]
  hyperlinkCount?: number
  markerCount?: number
}

export interface AppSettings {
  favorites: string[]
  recents: string[]
  theme: 'dark'
  maxFileSizeKB: number
  includeTree: boolean
  respectGitignore: boolean
}

export interface XMindHyperlink {
  title: string
  href: string
}

export interface XMindTopic {
  title: string
  notes: string
  children: XMindTopic[]
  hyperlinks?: XMindHyperlink[]
  markers?: string[]
}
