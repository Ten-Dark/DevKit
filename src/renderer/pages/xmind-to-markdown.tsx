import { useCallback, useEffect, useRef, useState } from 'react'
import { FolderOpen, FileText, Copy, Save, CheckCircle, AlertCircle, Clock, X } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card, CardTitle, CardBody } from '../components/ui/card'
import { PageHeader } from '../components/page-header'
import { XMindConversionResult } from '../types'

type XMindProgress = {
  operationId: string
  phase: 'extracting' | 'converting'
  stage?: 'sheets' | 'parsing' | 'rendering'
  processed: number
  total: number
  processedEntries: number
  totalEntries: number
}

type XMindApi = {
  selectXMindFile: () => Promise<string | null>
  convertXMindToMarkdown: (xmindPath: string, operationId: string) => Promise<XMindConversionResult>
  cancelXMindConversion: (operationId: string) => Promise<{ success: boolean }>
  onXMindConversionProgress: (callback: (payload: XMindProgress) => void) => () => void
  copyToClipboard: (text: string) => Promise<{ success: boolean }>
  selectXMindOutputFile: () => Promise<string | null>
  writeFile: (filePath: string, content: string) => Promise<{ success: boolean }>
}

export default function XMindToMarkdownPage() {
  const [filePath, setFilePath] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [loading, setLoading] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [progress, setProgress] = useState<XMindProgress | null>(null)
  const [status, setStatus] = useState<'idle' | 'success' | 'error' | 'aborted'>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [cancelError, setCancelError] = useState<string | null>(null)
  const [topicCount, setTopicCount] = useState(0)
  const [depth, setDepth] = useState(0)
  const [sheetsCount, setSheetsCount] = useState(0)
  const [warnings, setWarnings] = useState<string[]>([])
  const [hyperlinkCount, setHyperlinkCount] = useState(0)
  const [markerCount, setMarkerCount] = useState(0)

  const api = window.api as unknown as XMindApi
  const mountedRef = useRef(false)
  const activeOperationIdRef = useRef<string | null>(null)
  const operationSequenceRef = useRef(0)

  const clearResult = useCallback(() => {
    setMarkdown('')
    setTopicCount(0)
    setDepth(0)
    setSheetsCount(0)
    setWarnings([])
    setHyperlinkCount(0)
    setMarkerCount(0)
  }, [])

  const reset = useCallback(() => {
    clearResult()
    setStatus('idle')
    setStatusMessage('')
    setError(null)
    setCancelError(null)
    setProgress(null)
  }, [clearResult])

  useEffect(() => {
    mountedRef.current = true
    const unsubscribe = api.onXMindConversionProgress((payload) => {
      if (!mountedRef.current || payload.operationId !== activeOperationIdRef.current) return
      setProgress(payload)
    })
    return () => {
      mountedRef.current = false
      unsubscribe()
      const operationId = activeOperationIdRef.current
      activeOperationIdRef.current = null
      if (operationId) void api.cancelXMindConversion(operationId).catch(() => undefined)
    }
  }, [api])

  const selectFile = async () => {
    reset()
    try {
      const path = await api.selectXMindFile()
      if (!mountedRef.current || !path) return
      setFilePath(path)
      setFileName(path.split(/[\\/]/).pop() || path)
    } catch (err) {
      if (!mountedRef.current) return
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Failed to select XMind file')
      setStatusMessage('File selection failed.')
    }
  }

  const convert = async () => {
    if (!filePath || activeOperationIdRef.current) return
    const operationId = globalThis.crypto?.randomUUID?.() ?? ('xmind-' + Date.now() + '-' + (++operationSequenceRef.current))
    activeOperationIdRef.current = operationId
    setLoading(true)
    setCancelling(false)
    setProgress({ operationId, phase: 'extracting', processed: 0, total: 0, processedEntries: 0, totalEntries: 0 })
    setStatus('idle')
    setStatusMessage('')
    setError(null)
    setCancelError(null)
    clearResult()

    try {
      const result = await api.convertXMindToMarkdown(filePath, operationId)
      if (!mountedRef.current || activeOperationIdRef.current !== operationId) return
      setMarkdown(result.markdown)
      setTopicCount(result.topicCount)
      setDepth(result.depth)
      setSheetsCount(result.sheetsCount ?? 0)
      setWarnings(result.warnings ?? [])
      setHyperlinkCount(result.hyperlinkCount ?? 0)
      setMarkerCount(result.markerCount ?? 0)
      setStatus('success')
      setStatusMessage('Converted ' + result.topicCount + ' topic(s), depth ' + result.depth + '.')
    } catch (err) {
      if (!mountedRef.current || activeOperationIdRef.current !== operationId) return
      const message = err instanceof Error ? err.message : 'Failed to convert XMind file'
      if (message === 'Operation aborted' || (err as { name?: string })?.name === 'AbortError') {
        setStatus('aborted')
        setStatusMessage('Conversion cancelled.')
      } else {
        setStatus('error')
        setError(message)
        setStatusMessage('Conversion failed.')
      }
    } finally {
      if (activeOperationIdRef.current === operationId) {
        activeOperationIdRef.current = null
        if (mountedRef.current) {
          setLoading(false)
          setCancelling(false)
          setProgress(null)
        }
      }
    }
  }

  const cancel = async () => {
    const operationId = activeOperationIdRef.current
    if (!operationId || cancelling) return
    setCancelling(true)
    setCancelError(null)
    let cancellationAccepted = false
    try {
      const result = await api.cancelXMindConversion(operationId)
      cancellationAccepted = result.success
      if (!result.success && mountedRef.current && activeOperationIdRef.current === operationId) {
        setCancelError('Cancellation could not be confirmed. The conversion may still be running.')
      }
    } catch {
      if (mountedRef.current && activeOperationIdRef.current === operationId) {
        setCancelError('Could not send the cancellation request. You can try again.')
      }
    } finally {
      if (mountedRef.current && activeOperationIdRef.current === operationId) {
        // A successful IPC response only confirms that the abort was requested.
        // Keep the UI in its cancelling state until the conversion promise settles.
        if (!cancellationAccepted) setCancelling(false)
      }
    }
  }

  const handleCopy = async () => {
    if (!markdown || loading) return
    try {
      await api.copyToClipboard(markdown)
      if (!mountedRef.current) return
      setStatus('success')
      setStatusMessage('Copied to clipboard.')
      setError(null)
    } catch (err) {
      if (!mountedRef.current) return
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Copy failed')
    }
  }

  const handleSave = async () => {
    if (!markdown || loading) return
    try {
      const outPath = await api.selectXMindOutputFile()
      if (!outPath || !mountedRef.current) return
      const result = await api.writeFile(outPath, markdown)
      if (!result.success) throw new Error('Could not save Markdown file')
      if (!mountedRef.current) return
      setStatus('success')
      setStatusMessage('Saved to ' + (outPath.split(/[\\/]/).pop() || outPath))
      setError(null)
    } catch (err) {
      if (!mountedRef.current) return
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  const progressLabel = progress?.phase === 'extracting'
    ? 'Extracting archive'
    : progress?.stage === 'parsing'
      ? 'Parsing topics'
      : progress?.stage === 'rendering'
        ? 'Rendering Markdown'
        : 'Converting sheets'
  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B'
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
  }
  const progressText = progress && progress.total > 0
    ? progress.phase === 'extracting'
      ? progressLabel + ': ' + formatBytes(progress.processed) + ' of ' + formatBytes(progress.total)
      : progressLabel + ': ' + progress.processed + ' of ' + progress.total
    : progress?.stage === 'parsing'
      ? progressLabel + ': ' + progress.processed + ' processed'
      : progressLabel + '...'
  const progressPercent = progress && progress.total > 0
    ? Math.min(100, Math.round((progress.processed / progress.total) * 100))
    : 0

  return (
    <div className="page" style={{ padding: 24 }}>
      <PageHeader title="XMind to Markdown" description="Convert an XMind (.xmind) mind map into a Markdown outline." />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <aside style={{ width: 360, flexShrink: 0 }}>
            <Card>
              <CardTitle icon={<FolderOpen size={16} />}>Select XMind file</CardTitle>
              <CardBody>
                <Button onClick={selectFile} disabled={loading} style={{ width: '100%' }}>Choose .xmind file</Button>
                {filePath && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Selected file</div>
                    <div style={{ fontSize: 13, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }} title={filePath}>{fileName}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>XMind file</div>
                    <Button variant="ghost" onClick={selectFile} disabled={loading} style={{ marginTop: 8, width: '100%', fontSize: 12 }}>Change file</Button>
                  </div>
                )}
              </CardBody>
            </Card>

            <Card style={{ marginTop: 12 }}>
              <CardTitle icon={<FileText size={16} />}>Statistics</CardTitle>
              <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: 'var(--text-secondary)' }}>Topics</span><span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{topicCount}</span></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: 'var(--text-secondary)' }}>Depth</span><span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{depth}</span></div>
                {markdown && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: 'var(--text-secondary)' }}>Characters</span><span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{markdown.length.toLocaleString()}</span></div>}
                {sheetsCount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: 'var(--text-secondary)' }}>Sheets</span><span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{sheetsCount}</span></div>}
                {hyperlinkCount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: 'var(--text-secondary)' }}>Hyperlinks</span><span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{hyperlinkCount}</span></div>}
                {markerCount > 0 && <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}><span style={{ color: 'var(--text-secondary)' }}>Markers</span><span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{markerCount}</span></div>}
              </CardBody>
            </Card>
            {warnings.length > 0 && (
              <Card style={{ marginTop: 12 }}>
                <CardBody style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <AlertCircle size={14} />
                  <div style={{ flex: 1, fontSize: 13, color: 'var(--text-secondary)' }}>
                    {warnings.map((warning) => <div key={warning} style={{ marginBottom: 4 }}>{warning}</div>)}
                  </div>
                </CardBody>
              </Card>
            )}
          </aside>

          <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Card>
              <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Generated Markdown</h3>
                  {loading ? (
                    <Button onClick={cancel} disabled={cancelling} variant="secondary" style={{ width: 'auto' }}>
                      <X size={14} /> {cancelling ? 'Cancelling...' : 'Cancel'}
                    </Button>
                  ) : (
                    <Button onClick={convert} disabled={!filePath} style={{ width: 'auto' }}>Convert</Button>
                  )}
                </div>
                {loading && (
                  <div role="status" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'var(--text-secondary)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Clock size={14} /> {progressText}</div>
                    {progress && progress.total > 0 && (
                      <div role="progressbar" aria-label={progressLabel} aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.processed} style={{ height: 6, overflow: 'hidden', borderRadius: 99, background: 'var(--border)' }}>
                        <div style={{ width: progressPercent + '%', height: '100%', background: 'var(--accent)', transition: 'width 120ms ease' }} />
                      </div>
                    )}
                  </div>
                )}
                {cancelError && <div role="alert" style={{ fontSize: 12, color: 'var(--accent-light)' }}>{cancelError}</div>}
                <div className="scroll-area" style={{ flex: 1, minHeight: 340, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', backgroundColor: 'var(--surface-elevated)' }}>
                  <textarea readOnly aria-label="Generated Markdown" value={markdown} style={{ width: '100%', height: '100%', padding: 12, backgroundColor: 'transparent', border: 'none', color: 'var(--text-primary)', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace', fontSize: 12, lineHeight: 1.5, resize: 'none', outline: 'none' }} />
                </div>
              </CardBody>
            </Card>

            <div style={{ display: 'flex', gap: 10 }}>
              <Button onClick={handleCopy} disabled={!markdown || loading} style={{ flex: 1 }}><Copy size={14} /> Copy to clipboard</Button>
              <Button variant="secondary" onClick={handleSave} disabled={!markdown || loading} style={{ flex: 1 }}><Save size={14} /> Save to .md</Button>
            </div>

            {status === 'error' && error && (
              <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, backgroundColor: 'rgba(116,22,46,0.15)', border: '1px solid var(--accent)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' }}>
                <AlertCircle size={14} /><span style={{ fontSize: 13 }}>{error}</span>
                <button type="button" aria-label="Dismiss error" onClick={() => { setError(null); setStatus('idle') }} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 2, fontSize: 14 }}>&times;</button>
              </div>
            )}
            {status === 'success' && statusMessage && !loading && (
              <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, backgroundColor: 'rgba(34,139,34,0.15)', border: '1px solid var(--accent-secondary)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)' }}>
                <CheckCircle size={14} /><span style={{ fontSize: 13 }}>{statusMessage}</span>
              </div>
            )}
            {status === 'aborted' && statusMessage && !loading && (
              <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: 10, backgroundColor: 'var(--surface-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-secondary)' }}>
                <X size={14} /><span style={{ fontSize: 13 }}>{statusMessage}</span>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  )
}
