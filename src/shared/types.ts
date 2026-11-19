// Shared types used by both main process and renderer.
// No React, DOM, or renderer-specific dependencies.

export interface ProjectFile {
  relativePath: string
  size: number
}

export type ProjectMarkdownIssueReason =
  | 'internal-ignore'
  | 'gitignore'
  | 'max-file-size'
  | 'binary'
  | 'read-error'
  | 'directory-read-error'
  | 'symlink'
  | 'unsupported-entry'
  | 'gitignore-read-error'
  | 'output-limit'

export interface ProjectMarkdownIssue {
  relativePath: string
  reason: ProjectMarkdownIssueReason
  kind: 'file' | 'directory'
}

export interface ProjectDirectoryScan {
  /** Canonical directory path used for both Preview and Generate document headers. */
  rootPath?: string
  files: ProjectFile[]
  issues: ProjectMarkdownIssue[]
}

export interface ProjectMarkdownOptions {
  maxFileSizeKB: number
  includeTree: boolean
  respectGitignore: boolean
}

export interface ProjectMarkdownStats {
  fileCount: number
  skippedCount: number
  limitedCount: number
  errorCount: number
  /** Rendered file-section characters, excluding the document shell. */
  totalChars: number
  /** Exact JavaScript string length of the complete Markdown document. */
  documentChars?: number
  truncated: boolean
  treeIncluded?: boolean
  treeOmitted?: boolean
  reportTruncated?: boolean
  issues: ProjectMarkdownIssue[]
}

export interface ProjectMarkdownResult {
  markdown: string
  stats: ProjectMarkdownStats
  /** Candidate files from the same scan used by Generate, for an up-to-date result view. */
  scannedFiles: ProjectFile[]
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

export type UpdaterStatus =
  | 'idle'
  | 'checking'
  | 'update-available'
  | 'update-not-available'
  | 'downloading'
  | 'downloaded'
  | 'installing'
  | 'error'
  | 'unsupported'

export interface UpdaterActionResult {
  success: boolean
  error?: string
}

export interface UpdaterInfo {
  status: UpdaterStatus
  currentVersion: string
  availableVersion?: string
  releaseNotes?: string
  releaseDate?: string
  downloadProgress?: number
  downloadSpeedBytesPerSecond?: number
  downloadedBytes?: number
  totalBytes?: number
  cancellationRequested?: boolean
  error?: string
  lastCheck?: string
}
