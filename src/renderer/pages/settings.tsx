import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Download,
  PackageCheck,
  RefreshCw,
  Save,
  Settings,
  AlertTriangle,
} from 'lucide-react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Card, CardTitle, CardBody } from '../components/ui/card'
import { PageHeader } from '../components/page-header'
import { AppSettings, UpdaterInfo } from '../types'

const DEFAULT_MAX_FILE_SIZE_KB = 1024

const defaultSettings: AppSettings = {
  favorites: [],
  recents: [],
  theme: 'dark',
  maxFileSizeKB: DEFAULT_MAX_FILE_SIZE_KB,
  includeTree: true,
  respectGitignore: true,
}

interface SettingsPageProps {
  onResetSuccess: () => void
}

export default function SettingsPage({ onResetSuccess }: SettingsPageProps) {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [appVersion, setAppVersion] = useState<string>('')
  const [buildInfo, setBuildInfo] = useState<string>('')
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [loading, setLoading] = useState(true)
  const [settingsAction, setSettingsAction] = useState<'save' | 'reset' | null>(null)

  // Updater state
  const [updaterInfo, setUpdaterInfo] = useState<UpdaterInfo | null>(null)
  const [updaterLoading, setUpdaterLoading] = useState(false)
  const unsubRef = useRef<(() => void) | null>(null)

  const api = window.api as {
    getSettings: () => Promise<AppSettings>
    saveSettings: (settings: Partial<AppSettings>) => Promise<{ success: boolean }>
    resetSettings: () => Promise<{ success: boolean }>
    getAppVersion: () => Promise<string>
    updater: {
      getInfo: () => Promise<UpdaterInfo>
      check: () => Promise<UpdaterInfo>
      download: () => Promise<{ success: boolean; error?: string }>
      cancelDownload: () => Promise<{ success: boolean; error?: string }>
      install: () => Promise<{ success: boolean; error?: string }>
      onStatusChange: (callback: (payload: UpdaterInfo) => void) => () => void
    }
  }

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const [loaded, version] = await Promise.all([api.getSettings(), api.getAppVersion()])
        if (!mounted) return
        setSettings(loaded)
        setAppVersion(version)
        const mode = (import.meta as { env?: { MODE?: string } }).env?.MODE
        setBuildInfo(mode === 'production' ? 'Production build' : 'Development build')

        // Subscribe before reading the snapshot so startup events cannot be missed.
        try {
          let receivedEvent = false
          unsubRef.current = api.updater.onStatusChange((info) => {
            if (!mounted) return
            receivedEvent = true
            setUpdaterInfo(info)
          })
          const info = await api.updater.getInfo()
          if (mounted && !receivedEvent) setUpdaterInfo(info)
        } catch {
          if (mounted) setUpdaterInfo({ status: 'error', currentVersion: version, error: 'Updater status is unavailable.' })
        }
      } catch {
        if (mounted) setStatus({ kind: 'error', message: 'Failed to load settings.' })
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
      unsubRef.current?.()
    }
  }, [api])

  const updateSetting = (key: keyof AppSettings, value: unknown) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (settingsAction !== null) return
    setSettingsAction('save')
    try {
      const result = await api.saveSettings({
        maxFileSizeKB: settings.maxFileSizeKB,
        includeTree: settings.includeTree,
        respectGitignore: settings.respectGitignore,
      })
      if (!result.success) throw new Error('Settings save failed.')
      setStatus({ kind: 'success', message: 'Settings saved.' })
    } catch {
      setStatus({ kind: 'error', message: 'Failed to save settings.' })
    } finally {
      setSettingsAction(null)
    }
  }

  const handleReset = async () => {
    if (settingsAction !== null) return
    if (!window.confirm('Reset all settings to their default values? This cannot be undone.')) {
      return
    }
    setSettingsAction('reset')
    try {
      const result = await api.resetSettings()
      if (!result.success) throw new Error('Settings reset failed.')
      setSettings(defaultSettings)
      onResetSuccess()
      setStatus({ kind: 'success', message: 'Settings reset to defaults.' })
    } catch {
      setStatus({ kind: 'error', message: 'Failed to reset settings.' })
    } finally {
      setSettingsAction(null)
    }
  }

  const handleCheckUpdates = useCallback(async () => {
    setUpdaterLoading(true)
    try {
      const info = await api.updater.check()
      setUpdaterInfo(info)
    } catch {
      setUpdaterInfo({
        status: 'error',
        currentVersion: appVersion,
        error: 'Failed to check for updates.',
        lastCheck: new Date().toISOString(),
      })
    } finally {
      setUpdaterLoading(false)
    }
  }, [appVersion, api.updater])

  const handleDownloadUpdate = useCallback(async () => {
    setUpdaterLoading(true)
    try {
      const result = await api.updater.download()
      if (!result.success && result.error && result.error !== 'Download cancelled.') {
        setStatus({ kind: 'error', message: result.error })
      }
    } catch {
      setStatus({ kind: 'error', message: 'Failed to download update.' })
    } finally {
      setUpdaterLoading(false)
    }
  }, [api.updater])

  const handleCancelDownload = useCallback(async () => {
    const result = await api.updater.cancelDownload()
    if (!result.success && result.error) setStatus({ kind: 'error', message: result.error })
  }, [api.updater])

  const handleInstallUpdate = useCallback(async () => {
    try {
      await api.updater.install()
    } catch {
      setStatus({ kind: 'error', message: 'Failed to install update.' })
    }
  }, [api.updater])

  const isUpdateAvailable = updaterInfo?.status === 'update-available'
  const isDownloaded = updaterInfo?.status === 'downloaded'
  const isError = updaterInfo?.status === 'error'
  const isChecking = updaterInfo?.status === 'checking'
  const isDownloading = updaterInfo?.status === 'downloading'
  const isInstalling = updaterInfo?.status === 'installing'
  const isUnsupported = updaterInfo?.status === 'unsupported'
  const canDownload = isUpdateAvailable || (isError && Boolean(updaterInfo?.availableVersion))

  return (
    <div className="page">
      <PageHeader title="Settings" description="Manage application preferences and behavior." />

      {status && (
        <div
          role="alert"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '10px 14px',
            borderRadius: '6px',
            border: `1px solid ${status.kind === 'error' ? 'var(--accent)' : 'var(--border)'}`,
            backgroundColor:
              status.kind === 'error'
                ? 'rgba(116, 22, 46, 0.15)'
                : 'var(--surface-elevated)',
            color: status.kind === 'error' ? 'var(--accent-light)' : 'var(--text-primary)',
            marginBottom: 16,
          }}
        >
          {status.kind === 'error' ? <AlertCircle size={16} /> : <CheckCircle size={16} />}
          {status.message}
        </div>
      )}

      <Card>
        <CardTitle icon={<Settings size={16} />}>Application</CardTitle>
        <CardBody>Dev Toolbox desktop application details.</CardBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Name</span>
            <span style={{ color: 'var(--text-primary)' }}>Dev Toolbox</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Version</span>
            <span style={{ color: 'var(--text-primary)' }}>{loading ? '…' : appVersion}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Build</span>
            <span style={{ color: 'var(--text-primary)' }}>{buildInfo}</span>
          </div>
        </div>
      </Card>

      <Card>
        <CardTitle icon={<Settings size={16} />}>Theme</CardTitle>
        <CardBody>
          Dev Toolbox ships with a single Dark Burgundy theme. Theme switching is not yet
          available.
        </CardBody>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginTop: 12 }}>
          <span style={{ color: 'var(--text-secondary)' }}>Current theme</span>
          <span style={{ color: 'var(--text-primary)' }}>Dark Burgundy (read-only)</span>
        </div>
      </Card>

      <Card>
        <CardTitle icon={<Settings size={16} />}>Tool behavior</CardTitle>
        <CardBody>Defaults used by tools such as Project to Markdown.</CardBody>
        <form
          onSubmit={handleSave}
          style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
              <label style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
                Max file size (KB)
              </label>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Files larger than this are skipped.
              </span>
            </div>
            <Input
              type="number"
              min="1"
              value={settings.maxFileSizeKB}
              onChange={(e) =>
                updateSetting('maxFileSizeKB', Math.max(1, Number(e.target.value) || 1))
              }
              style={{ width: 140 }}
            />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              type="checkbox"
              checked={settings.includeTree}
              onChange={() => updateSetting('includeTree', !settings.includeTree)}
              style={{ accentColor: 'var(--accent)', width: 18, height: 18 }}
            />
            <span style={{ color: 'var(--text-primary)' }}>Include file tree</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <input
              type="checkbox"
              checked={settings.respectGitignore}
              onChange={() => updateSetting('respectGitignore', !settings.respectGitignore)}
              style={{ accentColor: 'var(--accent)', width: 18, height: 18 }}
            />
            <span style={{ color: 'var(--text-primary)' }}>Respect .gitignore</span>
          </div>
          <Button type="submit" variant="default" disabled={loading || settingsAction !== null}>
            <Save size={16} style={{ marginRight: 8 }} /> Save settings
          </Button>
        </form>
      </Card>

      <Card>
        <CardTitle icon={<Settings size={16} />}>Data</CardTitle>
        <CardBody>Stored favorites and recent items.</CardBody>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginTop: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Favorites</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
              {settings.favorites.length}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Recents</span>
            <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
              {settings.recents.length}
            </span>
          </div>
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 10 }}>
          <Button variant="danger" onClick={handleReset} disabled={loading || settingsAction !== null}>
            Reset settings
          </Button>
        </div>
      </Card>

      <Card>
        <CardTitle
          icon={<PackageCheck size={16} />}
          >Application Updates</CardTitle>
        <CardBody>
          Automatically check for and install updates from GitHub Releases.
        </CardBody>
        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Version info */}
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
            <span style={{ color: 'var(--text-secondary)' }}>Current version</span>
            <span style={{ color: 'var(--text-primary)' }}>{appVersion || '—'}</span>
          </div>
          {updaterInfo?.availableVersion && (
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
              <span style={{ color: 'var(--text-secondary)' }}>Available version</span>
              <span style={{ color: 'var(--accent-light)', fontWeight: 600 }}>
                {updaterInfo.availableVersion}
              </span>
            </div>
          )}

          {/* Status message */}
          <div style={{ marginTop: 8, padding: 10, borderRadius: 6, backgroundColor: 'var(--surface-elevated)', fontSize: 13, color: 'var(--text-secondary)' }}>
            {isInstalling ? (
              <>Preparing to restart and install the downloaded update…</>
            ) : isDownloading ? (
              <>
                <Download size={14} style={{ marginRight: 8 }} />
                {updaterInfo.cancellationRequested ? 'Cancelling download…' : 'Downloading update…'}
              </>
            ) : isChecking || updaterLoading ? (
              <>
                <RefreshCw size={14} style={{ marginRight: 8, animation: 'spin 1s linear infinite' }} />
                Checking for updates…
              </>
            ) : isUpdateAvailable ? (
              <>
                <AlertTriangle size={14} style={{ marginRight: 8, color: 'var(--accent-light)' }} />
                Update available — {updaterInfo.availableVersion}
              </>
            ) : isDownloaded ? (
              updaterInfo.error ? (
                <>
                  <AlertCircle size={14} style={{ marginRight: 8, color: 'var(--accent)' }} />
                  Installation could not start: {updaterInfo.error}
                </>
              ) : (
                <>
                  <PackageCheck size={14} style={{ marginRight: 8, color: 'var(--accent-light)' }} />
                  Update downloaded — ready to install
                </>
              )
            ) : isError ? (
              <>
                <AlertCircle size={14} style={{ marginRight: 8, color: 'var(--accent)' }} />
                {updaterInfo.error || 'Update operation failed. You can retry.'}
              </>
            ) : isUnsupported ? (
              <>
                <AlertCircle size={14} style={{ marginRight: 8 }} />
                {updaterInfo.error || 'Automatic updates are not supported in this build.'}
              </>
            ) : updaterInfo?.status === 'update-not-available' ? (
              <>
                <CheckCircle size={14} style={{ marginRight: 8, color: 'var(--accent-light)' }} />
                You are using the latest version.
              </>
            ) : (
              <>
                <Clock size={14} style={{ marginRight: 8 }} />
                Not checked yet.
              </>
            )}
          </div>

          {/* Progress bar */}
          {isDownloading && updaterInfo.downloadProgress !== undefined && (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
                <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                  Downloading update…
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-primary)' }}>
                  {updaterInfo.downloadProgress.toFixed(0)}%
                </span>
              </div>
              {updaterInfo.totalBytes && updaterInfo.downloadedBytes !== undefined && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
                  {(updaterInfo.downloadedBytes / 1_048_576).toFixed(1)} / {(updaterInfo.totalBytes / 1_048_576).toFixed(1)} MB · {((updaterInfo.downloadSpeedBytesPerSecond ?? 0) / 1_048_576).toFixed(2)} MB/s
                </div>
              )}
              <div style={{ height: 6, backgroundColor: 'var(--surface-additional)', borderRadius: 3, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${updaterInfo.downloadProgress}%`,
                    backgroundColor: 'var(--accent-light)',
                    transition: 'width 0.2s ease',
                  }}
                />
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div style={{ marginTop: 12, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button
              variant="default"
              onClick={handleCheckUpdates}
              disabled={updaterLoading || isChecking || isDownloading || isDownloaded || isInstalling}
            >
              <RefreshCw size={14} style={{ marginRight: 6 }} /> Check for updates
            </Button>
            {canDownload && (
              <Button variant="default" onClick={handleDownloadUpdate} disabled={updaterLoading}>
                <Download size={14} style={{ marginRight: 6 }} /> {isError ? 'Retry download' : 'Download update'}
              </Button>
            )}
            {isDownloading && (
              <Button variant="danger" onClick={handleCancelDownload} disabled={Boolean(updaterInfo.cancellationRequested)}>
                {updaterInfo.cancellationRequested ? 'Cancelling…' : 'Cancel download'}
              </Button>
            )}
            {isDownloaded && (
              <Button variant="danger" onClick={handleInstallUpdate} disabled={updaterLoading || isInstalling}>
                {updaterInfo.error ? 'Retry install' : 'Restart and install'}
              </Button>
            )}
          </div>

          {updaterInfo?.releaseNotes && (isUpdateAvailable || isDownloaded || isError) && (
            <div style={{ marginTop: 12, padding: 10, borderRadius: 6, backgroundColor: 'var(--surface-additional)', fontSize: 12, color: 'var(--text-secondary)' }}>
              <details style={{ cursor: 'pointer' }}>
                <summary style={{ fontWeight: 600, marginBottom: 6, color: 'var(--text-primary)' }}>
                  Release notes
                </summary>
                <div style={{ whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto' }}>
                  {updaterInfo.releaseNotes}
                </div>
              </details>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}
