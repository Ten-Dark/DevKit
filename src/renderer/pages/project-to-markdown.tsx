import { useCallback, useEffect, useRef, useState } from 'react'
import {
  FolderOpen,
  FileText,
  Copy,
  Save,
  X,
  CheckCircle,
  AlertCircle,
  Clock,
  File,
} from 'lucide-react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Card, CardTitle, CardBody } from '../components/ui/card'
import { PageHeader } from '../components/page-header'
import { ProjectDirectoryScan, ProjectFile, ProjectMarkdownIssue, ProjectMarkdownOptions, ProjectMarkdownResult } from '../types'
import {
  createProjectMarkdownDocumentPlan,
  finalizeProjectMarkdownDocument,
  getProjectMarkdownFileSectionLength,
  getProjectMarkdownLimitReason,
  getProjectMarkdownTreeCandidates,
  MAX_TOTAL_OUTPUT_CHARS,
} from '../../shared/utils/project-markdown-policy'

const DEFAULT_OPTIONS: ProjectMarkdownOptions = {
  maxFileSizeKB: 1024,
  includeTree: true,
  respectGitignore: true,
}

function normalizeProjectMarkdownOptions(settings: unknown): ProjectMarkdownOptions {
  const values =
    settings && typeof settings === 'object' && !Array.isArray(settings)
      ? (settings as Record<string, unknown>)
      : {}

  const maxFileSizeKB = values.maxFileSizeKB

  return {
    maxFileSizeKB:
      typeof maxFileSizeKB === 'number' &&
      Number.isFinite(maxFileSizeKB) &&
      Number.isInteger(maxFileSizeKB) &&
      maxFileSizeKB >= 1
        ? maxFileSizeKB
        : DEFAULT_OPTIONS.maxFileSizeKB,
    includeTree:
      typeof values.includeTree === 'boolean' ? values.includeTree : DEFAULT_OPTIONS.includeTree,
    respectGitignore:
      typeof values.respectGitignore === 'boolean'
        ? values.respectGitignore
        : DEFAULT_OPTIONS.respectGitignore,
  }
}

function getProjectNameFromPath(path: string): string {
  const normalized = path.replace(/[\\/]+$/, '')
  return normalized.split(/[\\/]/).pop() || 'Project'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

const ISSUE_LABELS: Record<ProjectMarkdownIssue['reason'], string> = {
  'internal-ignore': 'Built-in exclusions',
  gitignore: '.gitignore exclusions',
  'max-file-size': 'Over per-file size limit',
  binary: 'Binary files',
  'read-error': 'Read errors',
  'directory-read-error': 'Inaccessible directories',
  symlink: 'Symbolic links (not followed)',
  'unsupported-entry': 'Unsupported filesystem entries',
  'gitignore-read-error': '.gitignore could not be read',
  'output-limit': 'Total Markdown document limit',
}

export default function ProjectToMarkdownPage() {
  const [folderPath, setFolderPath] = useState<string | null>(null)
  const [folderName, setFolderName] = useState('')
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [options, setOptions] = useState<ProjectMarkdownOptions>(DEFAULT_OPTIONS)
  const [settingsLoadError, setSettingsLoadError] = useState(false)
  const [markdown, setMarkdown] = useState('')
  const [loading, setLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewStatus, setPreviewStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [status, setStatus] = useState<'idle' | 'success' | 'error' | 'aborted'>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fileCount, setFileCount] = useState(0)
  const [skippedCount, setSkippedCount] = useState(0)
  const [limitedCount, setLimitedCount] = useState(0)
  const [errorCount, setErrorCount] = useState(0)
  const [issues, setIssues] = useState<ProjectMarkdownIssue[]>([])
  const [totalChars, setTotalChars] = useState(0)
  const [previewTruncated, setPreviewTruncated] = useState(false)
  const [treeOmitted, setTreeOmitted] = useState(false)
  const [reportTruncated, setReportTruncated] = useState(false)
  const [progress, setProgress] = useState({ processed: 0, total: 0 })

  const api = window.api as {
    openDirectory: () => Promise<string[]>
    getSettings: () => Promise<unknown>
    walkDirectory: (dirPath: string, options?: { respectGitignore?: boolean }) => Promise<ProjectDirectoryScan>
    readFileContent: (filePath: string) => Promise<string | null>
    generateProjectMarkdown: (
      dirPath: string,
      options: ProjectMarkdownOptions,
      operationId?: string,
    ) => Promise<ProjectMarkdownResult>
    copyToClipboard: (text: string) => Promise<{ success: boolean }>
    writeFile: (filePath: string, content: string) => Promise<{ success: boolean }>
    selectOutputFile: () => Promise<string | null>
    abortOperation: (operationId: string) => Promise<{ success: boolean }>
    onProjectMarkdownProgress: (
      callback: (payload: { operationId: string; processed: number; total: number }) => void,
    ) => () => void
  }

  const mountedRef = useRef(true)
  const previewRequestRef = useRef(0)
  const settingsRequestRef = useRef(0)
  const editedOptionsRef = useRef(new Set<keyof ProjectMarkdownOptions>())
  const optionsRef = useRef(options)
  const folderPathRef = useRef<string | null>(null)
  const operationIdRef = useRef<string | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      previewRequestRef.current += 1
    }
  }, [])

  const reset = useCallback(() => {
    setMarkdown('')
    setStatus('idle')
    setStatusMessage('')
    setError(null)
    setProgress({ processed: 0, total: 0 })
    setTreeOmitted(false)
    setReportTruncated(false)
    operationIdRef.current = null
  }, [])

  const computeStats = useCallback(
    async (
      path: string,
      scan: ProjectDirectoryScan,
      maxFileSizeKB: number,
      includeTree: boolean,
      requestId: number,
    ) => {
      const issues = [...scan.issues]
      const maxFileSizeBytes = maxFileSizeKB * 1024
      // Mirror Generate: files already known to exceed the per-file limit
      // cannot appear in the document and must not consume tree reservation.
      const treeCandidates = getProjectMarkdownTreeCandidates(scan.files, maxFileSizeBytes)
      const plan = createProjectMarkdownDocumentPlan(
        getProjectNameFromPath(scan.rootPath ?? path),
        scan.rootPath ?? path,
        treeCandidates,
        includeTree,
        MAX_TOTAL_OUTPUT_CHARS,
      )
      const included: { relativePath: string; size: number; content: string; sectionChars: number }[] = []
      let totalChars = 0

      for (let index = 0; index < scan.files.length; index += 1) {
        if (requestId !== previewRequestRef.current || !mountedRef.current) return null
        const file = scan.files[index]
        if (file.size > maxFileSizeBytes) {
          issues.push({ relativePath: file.relativePath, reason: 'max-file-size', kind: 'file' })
          continue
        }
        try {
          const content = await api.readFileContent(`${path}/${file.relativePath}`)
          if (requestId !== previewRequestRef.current || !mountedRef.current) return null
          if (content === null) {
            issues.push({ relativePath: file.relativePath, reason: 'binary', kind: 'file' })
            continue
          }

          const sectionChars = getProjectMarkdownFileSectionLength(file.relativePath, content)
          const limitReason = getProjectMarkdownLimitReason(
            file,
            maxFileSizeBytes,
            totalChars,
            sectionChars,
            plan.fileSectionBudget,
          )
          if (limitReason) {
            issues.push({ relativePath: file.relativePath, reason: limitReason, kind: 'file' })
            if (limitReason === 'output-limit') {
              for (let omittedIndex = index + 1; omittedIndex < scan.files.length; omittedIndex += 1) {
                const omitted = scan.files[omittedIndex]
                issues.push({
                  relativePath: omitted.relativePath,
                  reason: omitted.size > maxFileSizeBytes ? 'max-file-size' : 'output-limit',
                  kind: 'file',
                })
              }
              break
            }
            continue
          }
          included.push({ ...file, content, sectionChars })
          totalChars += sectionChars
        } catch {
          issues.push({ relativePath: file.relativePath, reason: 'read-error', kind: 'file' })
        }
      }

      return finalizeProjectMarkdownDocument(plan, included, issues, maxFileSizeKB).stats
    },
    [api],
  )

  const loadPreview = useCallback(
    async (
      path: string,
      maxFileSizeKB: number,
      preserveGenerationState = false,
      respectGitignore = optionsRef.current.respectGitignore,
    ) => {
      const requestId = ++previewRequestRef.current
      setPreviewLoading(true)
      setPreviewStatus('loading')
      setFiles([])
      setFileCount(0)
      setSkippedCount(0)
      setLimitedCount(0)
      setErrorCount(0)
      setIssues([])
      setTotalChars(0)
      setPreviewTruncated(false)
      setTreeOmitted(false)
      setReportTruncated(false)
      setError(null)
      if (!preserveGenerationState) reset()

      try {
        const scanResult = await api.walkDirectory(path, { respectGitignore })
        const scan: ProjectDirectoryScan = Array.isArray(scanResult)
          ? { files: scanResult, issues: [] }
          : scanResult
        if (requestId !== previewRequestRef.current || !mountedRef.current) return
        const stats = await computeStats(path, scan, maxFileSizeKB, optionsRef.current.includeTree, requestId)
        if (!stats || requestId !== previewRequestRef.current || !mountedRef.current) return
        setFiles(scan.files)
        setFileCount(stats.fileCount)
        setSkippedCount(stats.skippedCount)
        setLimitedCount(stats.limitedCount)
        setErrorCount(stats.errorCount)
        setIssues(stats.issues)
        setTotalChars(stats.documentChars ?? stats.totalChars)
        setPreviewTruncated(stats.truncated)
        setTreeOmitted(stats.treeOmitted ?? false)
        setReportTruncated(stats.reportTruncated ?? false)
        setPreviewStatus('success')
      } catch (err) {
        if (requestId !== previewRequestRef.current || !mountedRef.current) return
        setFiles([])
        setFileCount(0)
        setSkippedCount(0)
        setLimitedCount(0)
        setErrorCount(0)
        setIssues([])
        setTotalChars(0)
        setTreeOmitted(false)
        setReportTruncated(false)
        setPreviewStatus('error')
        setError(err instanceof Error ? err.message : 'Failed to load folder contents')
        setStatus('error')
      } finally {
        if (requestId === previewRequestRef.current && mountedRef.current) {
          setPreviewLoading(false)
        }
      }
    },
    [api, computeStats, reset],
  )

  const updateOption = (key: keyof ProjectMarkdownOptions, value: number | boolean) => {
    editedOptionsRef.current.add(key)
    const nextOptions = { ...optionsRef.current, [key]: value } as ProjectMarkdownOptions
    optionsRef.current = nextOptions
    setOptions(nextOptions)
  }

  const updateIncludeTree = (includeTree: boolean) => {
    updateOption('includeTree', includeTree)
    const currentFolderPath = folderPathRef.current
    if (currentFolderPath) {
      void loadPreview(currentFolderPath, optionsRef.current.maxFileSizeKB, true)
    }
  }

  const updateRespectGitignore = (respectGitignore: boolean) => {
    updateOption('respectGitignore', respectGitignore)
    const currentFolderPath = folderPathRef.current
    if (currentFolderPath) {
      void loadPreview(currentFolderPath, optionsRef.current.maxFileSizeKB, true, respectGitignore)
    }
  }

  const updateMaxFileSize = async (maxFileSizeKB: number) => {
    updateOption('maxFileSizeKB', maxFileSizeKB)
    const currentFolderPath = folderPathRef.current
    if (currentFolderPath) {
      await loadPreview(currentFolderPath, maxFileSizeKB, true)
    }
  }

  useEffect(() => {
    let active = true
    const requestId = ++settingsRequestRef.current

    void api
      .getSettings()
      .then((settings) => {
        if (!active || !mountedRef.current || requestId !== settingsRequestRef.current) return

        const loadedOptions = normalizeProjectMarkdownOptions(settings)
        const currentOptions = optionsRef.current
        const nextOptions = { ...currentOptions }

        if (!editedOptionsRef.current.has('maxFileSizeKB')) {
          nextOptions.maxFileSizeKB = loadedOptions.maxFileSizeKB
        }
        if (!editedOptionsRef.current.has('includeTree')) {
          nextOptions.includeTree = loadedOptions.includeTree
        }
        if (!editedOptionsRef.current.has('respectGitignore')) {
          nextOptions.respectGitignore = loadedOptions.respectGitignore
        }

        const previewOptionsChanged =
          nextOptions.maxFileSizeKB !== currentOptions.maxFileSizeKB ||
          nextOptions.respectGitignore !== currentOptions.respectGitignore
        optionsRef.current = nextOptions
        setOptions(nextOptions)
        setSettingsLoadError(false)

        const currentFolderPath = folderPathRef.current
        if (previewOptionsChanged && currentFolderPath) {
          void loadPreview(currentFolderPath, nextOptions.maxFileSizeKB, true, nextOptions.respectGitignore)
        }
      })
      .catch(() => {
        if (!active || !mountedRef.current || requestId !== settingsRequestRef.current) return
        setSettingsLoadError(true)
      })

    return () => {
      active = false
      settingsRequestRef.current += 1
    }
  }, [api, loadPreview])

  useEffect(() => {
    const unsub = api.onProjectMarkdownProgress?.((payload) => {
      if (operationIdRef.current && payload.operationId === operationIdRef.current) {
        setProgress({ processed: payload.processed, total: payload.total })
      }
    })
    return unsub
  }, [api])

  const selectFolder = async () => {
    const paths = await api.openDirectory()
    if (!mountedRef.current || !paths || paths.length === 0) return
    const selectedPath = paths[0]
    folderPathRef.current = selectedPath
    setFolderPath(selectedPath)
    setFolderName(selectedPath.split(/[\\/]/).pop() || selectedPath)
    await loadPreview(selectedPath, optionsRef.current.maxFileSizeKB)
  }

  const cancel = async () => {
    const id = operationIdRef.current
    if (!id) return
    try {
      await api.abortOperation(id)
    } catch {
      // abort request failed; ignore
    }
  }

  const generate = async () => {
    if (!folderPath) return
    const operationId = crypto.randomUUID?.() ?? Date.now().toString()
    operationIdRef.current = operationId
    setLoading(true)
    setStatus('idle')
    setStatusMessage('')
    setError(null)
    setProgress({ processed: 0, total: files.length + issues.length })
    try {
      const result = await api.generateProjectMarkdown(folderPath, options, operationId)
      setMarkdown(result.markdown)
      setFiles(result.scannedFiles ?? files)
      setFileCount(result.stats.fileCount)
      setSkippedCount(result.stats.skippedCount)
      setLimitedCount(result.stats.limitedCount ?? 0)
      setErrorCount(result.stats.errorCount ?? 0)
      setIssues(result.stats.issues ?? [])
      setTotalChars(result.stats.documentChars ?? result.stats.totalChars)
      setPreviewTruncated(result.stats.truncated)
      setTreeOmitted(result.stats.treeOmitted ?? false)
      setReportTruncated(result.stats.reportTruncated ?? false)
      setStatus('success')
      setStatusMessage(
        `Generated ${result.stats.fileCount} file(s), ${result.stats.skippedCount} skipped, ${result.stats.limitedCount ?? 0} limited, ${result.stats.errorCount ?? 0} errors.`,
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate markdown'
      const aborted =
        message === 'Operation aborted' || (err as { name?: string })?.name === 'AbortError'
      if (aborted) {
        setStatus('aborted')
        setStatusMessage('Generation aborted.')
      } else {
        setStatus('error')
        setError(message)
        setStatusMessage('Generation failed.')
      }
    } finally {
      if (operationIdRef.current === operationId) operationIdRef.current = null
      setLoading(false)
    }
  }

  const handleCopy = async () => {
    if (!markdown) return
    try {
      await api.copyToClipboard(markdown)
      setStatus('success')
      setStatusMessage('Copied to clipboard.')
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Copy failed')
    }
  }

  const handleSave = async () => {
    if (!markdown) return
    try {
      const outPath = await api.selectOutputFile()
      if (!outPath) return
      await api.writeFile(outPath, markdown)
      setStatus('success')
      setStatusMessage(`Saved to ${outPath.split(/[\\/]/).pop() || outPath}`)
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  return (
    <div className="page" style={{ padding: 24 }}>
      <PageHeader
        title="Project to Markdown"
        description="Convert a project folder into a single Markdown document with a file tree and fenced code blocks."
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <aside style={{ width: 360, flexShrink: 0 }}>
            <Card>
              <CardTitle icon={<FolderOpen size={16} />}>Select folder</CardTitle>
              <CardBody>
                <Button onClick={selectFolder} disabled={loading} style={{ width: '100%' }}>
                  {loading ? <Clock size={14} /> : null} Choose project folder
                </Button>
                {folderPath && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                      Selected folder
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: 'var(--text-primary)',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        width: '100%',
                      }}
                      title={folderPath}
                    >
                      {folderName}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      {files.length} file(s) detected
                    </div>
                    <Button
                      variant="ghost"
                      onClick={selectFolder}
                      disabled={loading}
                      style={{ marginTop: 8, width: '100%', fontSize: 12 }}
                    >
                      Change folder
                    </Button>
                  </div>
                )}
              </CardBody>
            </Card>

            <Card style={{ marginTop: 12 }}>
              <CardTitle icon={<FileText size={16} />}>Options</CardTitle>
              <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {settingsLoadError && (
                  <div
                    role="alert"
                    style={{ fontSize: 12, color: 'var(--text-muted)' }}
                  >
                    Settings could not be loaded. Using default values.
                  </div>
                )}
                <div>
                  <label style={{ display: 'block', fontSize: 13, color: 'var(--text-primary)', marginBottom: 6 }}>
                    Max file size
                  </label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Input
                      type="number"
                      value={String(options.maxFileSizeKB)}
                      onChange={(e) => {
                        const value = Math.max(1, parseInt(e.target.value, 10) || 1)
                        void updateMaxFileSize(value)
                      }}
                      style={{ width: 120 }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>KB</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="checkbox"
                    aria-label="Include file tree"
                    checked={options.includeTree}
                    onChange={(e) => updateIncludeTree(e.target.checked)}
                  />
                  <label style={{ fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer', margin: 0 }}>
                    Include file tree
                  </label>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="checkbox"
                    aria-label="Respect .gitignore"
                    checked={options.respectGitignore}
                    onChange={(e) => updateRespectGitignore(e.target.checked)}
                  />
                  <label style={{ fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer', margin: 0 }}>
                    Respect .gitignore
                  </label>
                </div>
              </CardBody>
            </Card>

            <Card style={{ marginTop: 12 }}>
              <CardTitle icon={<File size={16} />}>Files to include</CardTitle>
              <CardBody>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                  {fileCount} included&nbsp;·&nbsp;{skippedCount} skipped&nbsp;·&nbsp;{limitedCount} limited&nbsp;·&nbsp;{errorCount} errors&nbsp;·&nbsp;{totalChars.toLocaleString()} document chars{previewTruncated ? ` · document limit applied (${MAX_TOTAL_OUTPUT_CHARS.toLocaleString()} chars)` : ''}{treeOmitted ? ' · tree omitted' : ''}{reportTruncated ? ' · report shortened' : ''}
                </div>
                <div
                  className="scroll-area"
                  style={{
                    maxHeight: 260,
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--surface-elevated)',
                    padding: 8,
                  }}
                >
                  {previewLoading ? (
                    <div role="status" style={{ fontSize: 12, color: 'var(--text-muted)', padding: 8 }}>
                      Loading preview…
                    </div>
                  ) : previewStatus === 'error' ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 8 }}>
                      Preview could not be loaded.
                    </div>
                  ) : files.length === 0 && issues.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 8 }}>
                      {previewStatus === 'success' ? 'This folder is empty.' : 'Select a folder to preview files.'}
                    </div>
                  ) : files.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 8 }}>
                      No files are eligible for export. Review the exclusions below.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {files.map((f) => {
                        const fileIssue = issues.find((issue) => issue.relativePath === f.relativePath)
                        const included = f.size <= options.maxFileSizeKB * 1024 && !fileIssue
                        return (
                          <div
                            key={f.relativePath}
                            style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              fontSize: 11.5,
                              padding: '2px 6px',
                              borderRadius: 3,
                              color: included ? 'var(--text-secondary)' : 'var(--text-muted)',
                              backgroundColor: included ? 'transparent' : 'rgba(116,22,46,0.08)',
                            }}
                          >
                            <span
                              title={f.relativePath}
                              style={{
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {f.relativePath}
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                              {formatSize(f.size)}
                            </span>
                            {!included && (
                              <span style={{ fontSize: 10, color: 'var(--accent-secondary)' }}>
                                {fileIssue ? ISSUE_LABELS[fileIssue.reason] : 'Over size limit'}
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                  {!previewLoading && previewStatus === 'success' && issues.length > 0 && (
                    <details style={{ marginTop: 10, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                      <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--text-secondary)' }}>
                        {issues.length} skipped or limited item(s) — reasons and paths
                      </summary>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                        {Array.from(new Set(issues.map((issue) => issue.reason))).map((reason) => (
                          <div key={reason}>
                            <div style={{ fontSize: 11, color: 'var(--text-secondary)', fontWeight: 600 }}>
                              {ISSUE_LABELS[reason]} ({issues.filter((issue) => issue.reason === reason).length})
                            </div>
                            {issues.filter((issue) => issue.reason === reason).slice(0, 50).map((issue) => (
                              <div key={`${reason}:${issue.relativePath}`} title={issue.relativePath} style={{ fontSize: 11, color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>
                                {issue.relativePath}
                              </div>
                            ))}
                            {issues.filter((issue) => issue.reason === reason).length > 50 && (
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Additional paths are summarized in the export report.</div>
                            )}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              </CardBody>
            </Card>
          </aside>

          <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Card>
              <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                    Generated Markdown
                  </h3>
                  {loading ? (
                    <Button onClick={cancel} variant="secondary" style={{ width: 'auto' }}>
                      <X size={14} /> Cancel
                    </Button>
                  ) : (
                    <Button onClick={generate} disabled={!folderPath || loading || previewLoading} style={{ width: 'auto' }}>
                      Generate
                    </Button>
                  )}
                </div>
                {loading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                    <Clock size={14} />
                    {progress.total > 0
                      ? `Processing ${progress.processed} of ${progress.total} files…`
                      : 'Processing files…'}
                  </div>
                )}
                <div
                  className="scroll-area"
                  style={{
                    flex: 1,
                    minHeight: 340,
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    backgroundColor: 'var(--surface-elevated)',
                  }}
                >
                  <textarea
                    readOnly
                    value={markdown}
                    style={{
                      width: '100%',
                      height: '100%',
                      padding: 12,
                      backgroundColor: 'transparent',
                      border: 'none',
                      color: 'var(--text-primary)',
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      fontSize: 12,
                      lineHeight: 1.5,
                      resize: 'none',
                      outline: 'none',
                    }}
                  />
                </div>
              </CardBody>
            </Card>

            <div style={{ display: 'flex', gap: 10 }}>
              <Button
                onClick={handleCopy}
                disabled={!markdown || loading}
                style={{ flex: 1 }}
              >
                <Copy size={14} /> Copy to clipboard
              </Button>
              <Button
                variant="secondary"
                onClick={handleSave}
                disabled={!markdown || loading}
                style={{ flex: 1 }}
              >
                <Save size={14} /> Save to .md
              </Button>
            </div>

            {status === 'error' && error && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: 10,
                  backgroundColor: 'rgba(116,22,46,0.15)',
                  border: '1px solid var(--accent)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                }}
              >
                <AlertCircle size={14} />
                <span style={{ fontSize: 13 }}>{error}</span>
                <button
                  onClick={() => {
                    setError(null)
                    setStatus('idle')
                  }}
                  style={{
                    marginLeft: 'auto',
                    background: 'none',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: 2,
                    fontSize: 14,
                  }}
                >
                  &times;
                </button>
              </div>
            )}
            {status === 'success' && statusMessage && !loading && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: 10,
                  backgroundColor: 'rgba(34,139,34,0.15)',
                  border: '1px solid var(--accent-secondary)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                }}
              >
                <CheckCircle size={14} />
                <span style={{ fontSize: 13 }}>{statusMessage}</span>
              </div>
            )}
            {status === 'aborted' && statusMessage && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: 10,
                  backgroundColor: 'rgba(245,158,11,0.15)',
                  border: '1px solid var(--accent-secondary)',
                  borderRadius: 'var(--radius-sm)',
                  color: 'var(--text-primary)',
                }}
              >
                <Clock size={14} />
                <span style={{ fontSize: 13 }}>{statusMessage}</span>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
