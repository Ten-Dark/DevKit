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
import { ProjectFile, ProjectMarkdownOptions, ProjectMarkdownStats } from '../types'

const DEFAULT_OPTIONS: ProjectMarkdownOptions = {
  maxFileSizeKB: 1024,
  includeTree: true,
  respectGitignore: true,
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export default function ProjectToMarkdownPage() {
  const [folderPath, setFolderPath] = useState<string | null>(null)
  const [folderName, setFolderName] = useState('')
  const [files, setFiles] = useState<ProjectFile[]>([])
  const [options, setOptions] = useState<ProjectMarkdownOptions>(DEFAULT_OPTIONS)
  const [markdown, setMarkdown] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error' | 'aborted'>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [fileCount, setFileCount] = useState(0)
  const [skippedCount, setSkippedCount] = useState(0)
  const [totalChars, setTotalChars] = useState(0)
  const [progress, setProgress] = useState({ processed: 0, total: 0 })

  const api = window.api as {
    openDirectory: () => Promise<string[]>
    walkDirectory: (dirPath: string) => Promise<{ relativePath: string; size: number }[]>
    readFileContent: (filePath: string) => Promise<string | null>
    generateProjectMarkdown: (
      dirPath: string,
      options: ProjectMarkdownOptions,
      operationId?: string,
    ) => Promise<{ markdown: string; stats: ProjectMarkdownStats }>
    copyToClipboard: (text: string) => Promise<{ success: boolean }>
    writeFile: (filePath: string, content: string) => Promise<{ success: boolean }>
    selectOutputFile: () => Promise<string | null>
    abortOperation: (operationId: string) => Promise<{ success: boolean }>
    onProjectMarkdownProgress: (
      callback: (payload: { operationId: string; processed: number; total: number }) => void,
    ) => () => void
  }

  const mountedRef = useRef(false)
  const operationIdRef = useRef<string | null>(null)

  const reset = useCallback(() => {
    setMarkdown('')
    setStatus('idle')
    setStatusMessage('')
    setError(null)
    setProgress({ processed: 0, total: 0 })
    operationIdRef.current = null
  }, [])

  const computeStats = useCallback(
    async (list: ProjectFile[]) => {
      const limit = options.maxFileSizeKB * 1024
      const included = list.filter((f) => f.size <= limit)
      setFileCount(included.length)
      setSkippedCount(list.length - included.length)
      let total = 0
      for (const f of included) {
        const content = await api.readFileContent(`${folderPath}/${f.relativePath}`)
        if (content !== null) {
          total += content.length
        }
      }
      setTotalChars(total)
    },
    [folderPath, options.maxFileSizeKB, api],
  )

  const loadPreview = useCallback(async () => {
    if (!folderPath) return
    setError(null)
    try {
      const listed = await api.walkDirectory(folderPath)
      setFiles(listed)
      await computeStats(listed)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load folder contents')
      setFiles([])
    }
  }, [folderPath, api, computeStats])

  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    if (!folderPath) return
    void computeStats(files)
  }, [options.maxFileSizeKB, folderPath, files, computeStats])

  useEffect(() => {
    const unsub = api.onProjectMarkdownProgress?.((payload) => {
      if (operationIdRef.current && payload.operationId === operationIdRef.current) {
        setProgress({ processed: payload.processed, total: payload.total })
      }
    })
    return unsub
  }, [api])

  const selectFolder = async () => {
    reset()
    const paths = await api.openDirectory()
    if (!paths || paths.length === 0) return
    setFolderPath(paths[0])
    setFolderName(paths[0].split(/[\\/]/).pop() || paths[0])
    await loadPreview()
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
    setProgress({ processed: 0, total: files.length })
    try {
      const result = await api.generateProjectMarkdown(folderPath, options, operationId)
      setMarkdown(result.markdown)
      setFileCount(result.stats.fileCount)
      setSkippedCount(result.stats.skippedCount)
      setTotalChars(result.stats.totalChars)
      setStatus('success')
      setStatusMessage(
        `Generated ${result.stats.fileCount} file(s)${
          result.stats.skippedCount > 0 ? `, ${result.stats.skippedCount} skipped` : ''
        }.`,
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
                <div>
                  <label style={{ display: 'block', fontSize: 13, color: 'var(--text-primary)', marginBottom: 6 }}>
                    Max file size
                  </label>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Input
                      type="number"
                      value={String(options.maxFileSizeKB)}
                      onChange={(e) => {
                        const v = Math.max(1, parseInt(e.target.value, 10) || 1)
                        setOptions((o) => ({ ...o, maxFileSizeKB: v }))
                      }}
                      style={{ width: 120 }}
                    />
                    <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>KB</span>
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={options.includeTree}
                    onChange={(e) =>
                      setOptions((o) => ({ ...o, includeTree: e.target.checked }))
                    }
                  />
                  <label style={{ fontSize: 13, color: 'var(--text-primary)', cursor: 'pointer', margin: 0 }}>
                    Include file tree
                  </label>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <input
                    type="checkbox"
                    checked={options.respectGitignore}
                    onChange={(e) =>
                      setOptions((o) => ({ ...o, respectGitignore: e.target.checked }))
                    }
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
                  {fileCount} included&nbsp;&middot;&nbsp;{skippedCount} skipped&nbsp;&middot;&nbsp;{' '}
                  {totalChars.toLocaleString()} chars
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
                  {files.length === 0 ? (
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', padding: 8 }}>
                      Select a folder to preview files.
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      {files.map((f) => {
                        const included = f.size <= options.maxFileSizeKB * 1024
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
                                too large
                              </span>
                            )}
                          </div>
                        )
                      })}
                    </div>
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
                    <Button onClick={generate} disabled={!folderPath || loading} style={{ width: 'auto' }}>
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
