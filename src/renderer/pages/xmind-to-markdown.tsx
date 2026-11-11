import { useCallback, useRef, useState } from 'react'
import {
  FolderOpen,
  FileText,
  Copy,
  Save,
  X,
  CheckCircle,
  AlertCircle,
  Clock,
} from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card, CardTitle, CardBody } from '../components/ui/card'
import { PageHeader } from '../components/page-header'
import { XMindConversionResult } from '../types'

export default function XMindToMarkdownPage() {
  const [filePath, setFilePath] = useState<string | null>(null)
  const [fileName, setFileName] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error'>('idle')
  const [statusMessage, setStatusMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [topicCount, setTopicCount] = useState(0)
  const [depth, setDepth] = useState(0)
  const [sheetsCount, setSheetsCount] = useState(0)
  const [warnings, setWarnings] = useState<string[]>([])
  const [hyperlinkCount, setHyperlinkCount] = useState(0)
  const [markerCount, setMarkerCount] = useState(0)

  const api = window.api as {
    selectXMindFile: () => Promise<string | null>
    convertXMindToMarkdown: (xmindPath: string) => Promise<XMindConversionResult>
    copyToClipboard: (text: string) => Promise<{ success: boolean }>
    selectXMindOutputFile: () => Promise<string | null>
    writeFile: (filePath: string, content: string) => Promise<{ success: boolean }>
  }

  const mountedRef = useRef(false)

  const reset = useCallback(() => {
    setMarkdown('')
    setTitle('')
    setTopicCount(0)
    setDepth(0)
    setSheetsCount(0)
    setWarnings([])
    setHyperlinkCount(0)
    setMarkerCount(0)
    setStatus('idle')
    setStatusMessage('')
    setError(null)
  }, [])

  const selectFile = async () => {
    reset()
    const path = await api.selectXMindFile()
    if (!path) return
    setFilePath(path)
    setFileName(path.split(/[\\/]/).pop() || path)
  }

  const convert = async () => {
    if (!filePath) return
    setLoading(true)
    setStatus('idle')
    setStatusMessage('')
    setError(null)
    try {
      const result = await api.convertXMindToMarkdown(filePath)
      setMarkdown(result.markdown)
      setTitle(result.title)
      setTopicCount(result.topicCount)
      setDepth(result.depth)
      setSheetsCount(result.sheetsCount ?? 0)
      setWarnings(result.warnings ?? [])
      setHyperlinkCount(result.hyperlinkCount ?? 0)
      setMarkerCount(result.markerCount ?? 0)
      setStatus('success')
      setStatusMessage(
        `Converted ${result.topicCount} topic(s), depth ${result.depth}.`,
      )
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Failed to convert XMind file')
      setStatusMessage('Conversion failed.')
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
      const outPath = await api.selectXMindOutputFile()
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
        title="XMind to Markdown"
        description="Convert an XMind (.xmind) mind map into a Markdown outline."
      />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <aside style={{ width: 360, flexShrink: 0 }}>
            <Card>
              <CardTitle icon={<FolderOpen size={16} />}>Select XMind file</CardTitle>
              <CardBody>
                <Button onClick={selectFile} disabled={loading} style={{ width: '100%' }}>
                  {loading ? <Clock size={14} /> : null} Choose .xmind file
                </Button>
                {filePath && (
                  <div style={{ marginTop: 10 }}>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                      Selected file
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
                      title={filePath}
                    >
                      {fileName}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                      XMind file
                    </div>
                    <Button
                      variant="ghost"
                      onClick={selectFile}
                      style={{ marginTop: 8, width: '100%', fontSize: 12 }}
                    >
                      Change file
                    </Button>
                  </div>
                )}
              </CardBody>
            </Card>

            <Card style={{ marginTop: 12 }}>
              <CardTitle icon={<FileText size={16} />}>Statistics</CardTitle>
              <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Topics</span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                    {topicCount}
                  </span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Depth</span>
                  <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                    {depth}
                  </span>
                </div>
                {markdown && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Characters</span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                      {markdown.length.toLocaleString()}
                    </span>
                  </div>
                )}
                {sheetsCount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Sheets</span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                      {sheetsCount}
                    </span>
                  </div>
                )}
                {hyperlinkCount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Hyperlinks</span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                      {hyperlinkCount}
                    </span>
                  </div>
                )}
                {markerCount > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ color: 'var(--text-secondary)' }}>Markers</span>
                    <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                      {markerCount}
                    </span>
                  </div>
                )}
              </CardBody>
            </Card>

            {warnings.length > 0 && (
              <Card style={{ marginTop: 12 }}>
                <CardBody style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <AlertCircle size={14} />
                  <div style={{ flex: 1, fontSize: 13, color: 'var(--text-secondary)' }}>
                    {warnings.map((w, i) => (
                      <div key={i} style={{ marginBottom: i > 0 ? 4 : 0 }}>
                        {w}
                      </div>
                    ))}
                  </div>
                </CardBody>
              </Card>
            )}
          </aside>

          <main style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Card>
              <CardBody style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <h3 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                    Generated Markdown
                  </h3>
                  <Button onClick={convert} disabled={!filePath || loading} style={{ width: 'auto' }}>
                    {loading ? <Clock size={14} /> : null} Convert
                  </Button>
                </div>
                {loading && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                    <Clock size={14} /> Converting…
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
          </main>
        </div>
      </div>
    </div>
  )
}
