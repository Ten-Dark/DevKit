import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import { AlertCircle, File, Folder, FolderOpen, HardDrive, RefreshCw, Search, ShieldCheck, Unplug } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Card } from '../components/ui/card'
import { PageHeader } from '../components/page-header'
import type {
  KarakeepSourceSummary,

  StorageEntry,
  StorageEntryMetadata,
  StorageFileContent,
  StorageListing,
  StorageSearchResult,
  StorageSourceSummary,
} from '../../shared/storage'
import './storage.css'

function formatSize(size?: number): string {
  if (size === undefined) return '—'
  if (size < 1_024) return size + ' B'
  if (size < 1_048_576) return (size / 1_024).toFixed(1) + ' KB'
  return (size / 1_048_576).toFixed(1) + ' MB'
}

export default function StoragePage() {
  const [source, setSource] = useState<StorageSourceSummary | null>(null)
  const [listing, setListing] = useState<StorageListing | null>(null)
  const [searchResults, setSearchResults] = useState<StorageSearchResult | null>(null)
  const [selected, setSelected] = useState<StorageEntryMetadata | null>(null)
  const [noteContent, setNoteContent] = useState<StorageFileContent | null>(null)
  const [query, setQuery] = useState('')
  const [relativePath, setRelativePath] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const [karakeepSource, setKarakeepSource] = useState<KarakeepSourceSummary | null>(null)
  const [karakeepBaseUrl, setKarakeepBaseUrl] = useState('http://localhost:3001')

  const [keepassDatabasePath, setKeepassDatabasePath] = useState('Y:\\data\\system_cache.dll')
  const [keepassEntryPath, setKeepassEntryPath] = useState('Dev Secrets/SSH & APIes/Karakeep')

  const [karakeepBusy, setKarakeepBusy] = useState(false)
  const [karakeepChecking, setKarakeepChecking] = useState(true)
  const [karakeepError, setKarakeepError] = useState<string | null>(null)
  const karakeepActionRef = useRef(false)

  const refreshStatus = useCallback(async () => {
    const result = await window.api.storage.getStatus()
    setSource(result)
    if (result?.state === 'connected') setListing(await window.api.storage.list(relativePath))
    else setListing(null)
  }, [relativePath])

  useEffect(() => {
    let cancelled = false
    Promise.resolve().then(() => window.api.storage.getStatus()).then(async (result) => {
      if (cancelled) return
      setSource(result)
      if (result?.state === 'connected') {
        const next = await window.api.storage.list('')
        if (!cancelled) setListing(next)
      }
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load Storage status.')
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    let timeout: ReturnType<typeof setTimeout> | undefined
    const statusRequest = Promise.resolve().then(() => window.api.storage.karakeep.getStatus())
    const statusTimeout = new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Karakeep status request timed out.')), 8_000)
    })

    Promise.race([statusRequest, statusTimeout]).then((result) => {
      if (cancelled || karakeepActionRef.current) return
      setKarakeepSource(result)
      if (result?.baseUrl) setKarakeepBaseUrl(result.baseUrl)
      setKarakeepError(result?.error ?? null)
    }).catch((cause: unknown) => {
      if (!cancelled) setKarakeepError(cause instanceof Error ? cause.message : 'Could not load Karakeep status.')
    }).finally(() => {
      if (timeout) clearTimeout(timeout)
      if (!cancelled) setKarakeepChecking(false)
    })
    return () => {
      cancelled = true
      if (timeout) clearTimeout(timeout)
    }
  }, [])



  const connectKarakeepFromKeePass = async () => {
    karakeepActionRef.current = true
    setKarakeepBusy(true)
    setKarakeepChecking(true)
    setKarakeepError(null)
    try {
      const result = await window.api.storage.karakeep.connectWithSecretReference(karakeepBaseUrl, {
        providerId: 'keepassxc',
        reference: { databasePath: keepassDatabasePath, entryPath: keepassEntryPath, attribute: 'Password' },
      })
      setKarakeepSource(result)
    } catch (cause) {
      setKarakeepError(cause instanceof Error ? cause.message : 'Could not connect Karakeep using KeePassXC.')
    } finally {
      setKarakeepBusy(false)
      setKarakeepChecking(false)
    }
  }


  const disconnectKarakeep = async () => {
    if (!window.confirm('Disconnect Karakeep? Your Karakeep data will not be changed.')) return
    karakeepActionRef.current = true
    setKarakeepBusy(true)
    setKarakeepError(null)
    try {
      await window.api.storage.karakeep.disconnect()
      setKarakeepSource(null)
    } catch (cause) {
      setKarakeepError(cause instanceof Error ? cause.message : 'Could not disconnect Karakeep.')
    } finally {
      setKarakeepBusy(false)
    }
  }

  const refreshKarakeep = async () => {
    karakeepActionRef.current = true
    setKarakeepBusy(true)
    setKarakeepChecking(true)
    setKarakeepError(null)
    try {
      const status = await window.api.storage.karakeep.getStatus()
      setKarakeepSource(status)
      setKarakeepError(status?.error ?? null)
    } catch (cause) {
      setKarakeepError(cause instanceof Error ? cause.message : 'Could not refresh Karakeep connection.')
    } finally {
      setKarakeepBusy(false)
      setKarakeepChecking(false)
    }
  }


  const connect = async () => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const result = await window.api.storage.selectAndConnect()
      if (!result) return
      setSource(result)
      setRelativePath('')
      setQuery('')
      setSearchResults(null)
      setSelected(null)
      setNoteContent(null)
      setListing(await window.api.storage.list(''))
      setNotice('Folder connected in read-only mode.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not connect the selected folder.')
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    if (!window.confirm('Disconnect this folder? Files and folders will not be changed.')) return
    setBusy(true)
    setError(null)
    try {
      await window.api.storage.disconnect()
      setSource(null)
      setListing(null)
      setSearchResults(null)
      setSelected(null)
      setNoteContent(null)
      setRelativePath('')
      setNotice('Storage folder disconnected. No files were changed.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not disconnect Storage.')
    } finally {
      setBusy(false)
    }
  }

  const openDirectory = async (nextPath: string) => {
    setBusy(true)
    setError(null)
    try {
      const next = await window.api.storage.list(nextPath)
      setRelativePath(next.relativePath)
      setListing(next)
      setSearchResults(null)
      setSelected(null)
      setNoteContent(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not open this folder.')
    } finally {
      setBusy(false)
    }
  }

  const runSearch = async (event: FormEvent) => {
    event.preventDefault()
    if (query.trim().length < 2) {
      setError('Enter at least two characters to search file and folder names.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      setSearchResults(await window.api.storage.search(query.trim()))
      setSelected(null)
      setNoteContent(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Storage search failed.')
    } finally {
      setBusy(false)
    }
  }

  const selectEntry = async (entry: StorageEntry) => {
    if (entry.kind === 'directory') {
      await openDirectory(entry.id)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const metadata = await window.api.storage.getMetadata(entry.id)
      setSelected(metadata)
      setNoteContent(null)
      if (source?.provider === 'obsidian' && source.capabilities.read && entry.name.toLocaleLowerCase().endsWith('.md')) {
        setNoteContent(await window.api.storage.read(entry.id))
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load file metadata.')
    } finally {
      setBusy(false)
    }
  }

  const clearSearch = async () => {
    setQuery('')
    setSearchResults(null)
    await openDirectory(relativePath)
  }

  const currentEntries = searchResults?.entries ?? listing?.entries ?? []
  const breadcrumbs = relativePath ? relativePath.split('/').filter(Boolean) : []

  return (
    <div className="page storage-page">
      <PageHeader title="Storage" description="Connect existing folders and knowledge stores without taking ownership of their data." />
      {error && <div className="service-message service-message-error" role="alert"><AlertCircle size={15} />{error}</div>}
      {notice && <div className="service-message service-message-success" role="status">{notice}</div>}

      <Card>
        <div className="storage-karakeep-heading">
          <div className="storage-source-icon"><HardDrive size={18} /></div>
          <div className="storage-source-info">
            <strong>Karakeep</strong>
            <span>{karakeepSource?.baseUrl ?? 'Self-hosted or HTTPS Karakeep instance'}</span>
            <small><ShieldCheck size={12} /> Connection status only · data remains in Karakeep</small>
          </div>
          <div className="storage-connection-statuses" aria-live="polite">
            <div className="storage-connection-status">
              <span className={'storage-status-dot ' + (karakeepChecking ? 'is-checking' : karakeepSource?.credentialProvider === 'keepassxc' && karakeepSource.state === 'connected' ? 'is-connected' : karakeepSource?.credentialProvider === 'keepassxc' && karakeepSource.state === 'configured' ? 'is-checking' : karakeepSource?.credentialProvider === 'keepassxc' ? 'is-error' : 'is-disconnected')} />
              <span>KeePassXC</span>
              <strong>{karakeepChecking ? 'Checking' : karakeepSource?.credentialProvider === 'keepassxc' && karakeepSource.state === 'connected' ? 'Connected' : karakeepSource?.credentialProvider === 'keepassxc' && karakeepSource.state === 'configured' ? 'Configured · unlock required' : karakeepSource?.credentialProvider === 'keepassxc' ? 'Error' : 'Not connected'}</strong>
            </div>
            <div className="storage-connection-status">
              <span className={'storage-status-dot ' + (karakeepChecking ? 'is-checking' : karakeepSource?.state === 'connected' ? 'is-connected' : karakeepSource?.state === 'configured' ? 'is-checking' : karakeepSource ? 'is-error' : 'is-disconnected')} />
              <span>Karakeep API</span>
              <strong>{karakeepChecking ? 'Checking' : karakeepSource?.state === 'connected' ? 'Connected' : karakeepSource?.state === 'configured' ? 'Not verified' : karakeepSource ? 'Error' : 'Not connected'}</strong>
              {karakeepSource?.lastCheckedAt && <small>Checked {new Date(karakeepSource.lastCheckedAt).toLocaleTimeString()}</small>}
            </div>
          </div>
        </div>
        {karakeepError && <div className="storage-warning" role="alert"><AlertCircle size={14} /> {karakeepError}</div>}
        {karakeepSource?.state !== 'connected' ? (
          <div className="storage-karakeep-connect">
            <Input value={karakeepBaseUrl} onChange={(event) => setKarakeepBaseUrl(event.target.value)} placeholder="http://localhost:3001" aria-label="Karakeep base URL" />
            <Input value={keepassDatabasePath} onChange={(event) => setKeepassDatabasePath(event.target.value)} placeholder="KeePassXC database path" aria-label="KeePassXC database path" />
            <Input value={keepassEntryPath} onChange={(event) => setKeepassEntryPath(event.target.value)} placeholder="KeePassXC entry path" aria-label="KeePassXC entry path" />
            <Button type="button" variant="secondary" disabled={karakeepBusy || !keepassDatabasePath.trim() || !keepassEntryPath.trim()} onClick={() => void connectKarakeepFromKeePass()}>Connect with KeePassXC</Button>
            <small>Unlock happens in a separate secure PowerShell prompt. The master password never enters the DevKit UI or Renderer process.</small>
          </div>
        ) : (
          <div className="storage-source-actions">
            <Button variant="secondary" onClick={() => void refreshKarakeep()} disabled={karakeepBusy || karakeepChecking}><RefreshCw size={13} /> Refresh connection</Button>
            <Button variant="ghost" onClick={() => void disconnectKarakeep()} disabled={karakeepBusy}><Unplug size={13} /> Disconnect</Button>
          </div>
        )}
      </Card>

      {!source ? (
        <Card>
          <div className="storage-empty">
            <HardDrive size={32} />
            <h2>No local folder connected</h2>
            <p>Connect a local folder or an Obsidian vault. Obsidian Markdown notes can be previewed in read-only mode; other folders expose directory metadata only. Your files remain in their original location.</p>
            <Button onClick={() => void connect()} disabled={busy}><FolderOpen size={14} /> Connect folder</Button>
          </div>
        </Card>
      ) : (
        <>
          <Card>
            <div className="storage-source-heading">
              <div className="storage-source-icon"><HardDrive size={18} /></div>
              <div className="storage-source-info">
                <strong>{source.name}</strong>
                <span>{source.rootPath}</span>
                <small><ShieldCheck size={12} /> {source.provider === 'obsidian' ? 'Obsidian vault · Markdown preview only' : 'Connected folder · Metadata only'}</small>
              </div>
              <div className="storage-source-actions">
                <Button variant="secondary" onClick={() => void refreshStatus()} disabled={busy || loading}><RefreshCw size={13} /> Refresh</Button>
                <Button variant="secondary" onClick={() => void connect()} disabled={busy}><FolderOpen size={13} /> Change</Button>
                <Button variant="ghost" onClick={() => void disconnect()} disabled={busy}><Unplug size={13} /> Disconnect</Button>
              </div>
            </div>
            {source.state !== 'connected' && <div className="storage-warning"><AlertCircle size={14} /> {source.error || 'The selected folder is currently unavailable.'}</div>}
          </Card>

          <div className="storage-toolbar">
            <form className="storage-search" onSubmit={runSearch}>
              <Search size={15} />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search file and folder names…" />
              <Button type="submit" variant="secondary" disabled={busy || query.trim().length < 2}>Search</Button>
            </form>
          </div>

          <Card>
            <div className="storage-browser-header">
              <div className="storage-breadcrumbs">
                <button type="button" onClick={() => void openDirectory('')}>{source.name}</button>
                {breadcrumbs.map((part, index) => {
                  const path = breadcrumbs.slice(0, index + 1).join('/')
                  return <span key={path}><span className="storage-separator">/</span><button type="button" onClick={() => void openDirectory(path)}>{part}</button></span>
                })}
                {searchResults && <span className="storage-search-label">Search results for “{searchResults.query}”</span>}
              </div>
              {searchResults && <Button variant="ghost" onClick={() => void clearSearch()}>Clear search</Button>}
            </div>
            {busy || loading ? <div className="storage-empty-state">Loading Storage…</div> : currentEntries.length === 0 ? (
              <div className="storage-empty-state">{searchResults ? 'No matching file names found.' : 'This folder is empty.'}</div>
            ) : (
              <div className="storage-entry-list">
                {currentEntries.map((entry) => (
                  <button type="button" className="storage-entry" key={entry.id} onClick={() => void selectEntry(entry)}>
                    <span className="storage-entry-icon">{entry.kind === 'directory' ? <Folder size={16} /> : <File size={16} />}</span>
                    <span className="storage-entry-name">{entry.name}</span>
                    {searchResults && <code>{entry.id}</code>}
                    <span className="storage-entry-meta">{entry.kind === 'directory' ? 'Folder' : formatSize(entry.sizeBytes)}</span>
                    <span className="storage-entry-date">{new Date(entry.modifiedAt).toLocaleDateString()}</span>
                  </button>
                ))}
              </div>
            )}
            {(listing?.truncated || searchResults?.truncated) && <p className="storage-truncated">Results are limited for responsiveness. Refine the folder or search query.</p>}
          </Card>

          {selected && (
            <Card>
              <div className="storage-metadata">
                <div><strong>{selected.name}</strong><code>{selected.relativePath}</code></div>
                <span>{formatSize(selected.sizeBytes)}</span>
                <span>Modified {new Date(selected.modifiedAt).toLocaleString()}</span>
              </div>
              {noteContent && <pre className="storage-note-content">{noteContent.content}</pre>}
            </Card>
          )}
        </>
      )}
      <div className="storage-security-note"><ShieldCheck size={14} /> {source?.provider === 'obsidian' ? 'Read-only boundary: only Markdown notes up to 256 KiB can be previewed. Write, delete and sync capabilities are disabled.' : 'Local folders are metadata-only unless recognized as an Obsidian vault. Karakeep is read-only; no source data is modified.'}</div>
    </div>
  )
}
