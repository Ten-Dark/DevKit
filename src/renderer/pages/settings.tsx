import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle, Save, Settings } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Card, CardTitle, CardBody } from '../components/ui/card'
import { PageHeader } from '../components/page-header'
import { AppSettings } from '../types'

const DEFAULT_MAX_FILE_SIZE_KB = 1024

const defaultSettings: AppSettings = {
  favorites: [],
  recents: [],
  theme: 'dark',
  maxFileSizeKB: DEFAULT_MAX_FILE_SIZE_KB,
  includeTree: true,
  respectGitignore: true,
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(defaultSettings)
  const [appVersion, setAppVersion] = useState<string>('')
  const [buildInfo, setBuildInfo] = useState<string>('')
  const [status, setStatus] = useState<{ kind: 'success' | 'error'; message: string } | null>(null)
  const [loading, setLoading] = useState(true)

  const api = window.api as {
    getSettings: () => Promise<AppSettings>
    saveSettings: (settings: Partial<AppSettings>) => Promise<{ success: boolean }>
    resetSettings: () => Promise<{ success: boolean }>
    getAppVersion: () => Promise<string>
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
      } catch {
        if (mounted) setStatus({ kind: 'error', message: 'Failed to load settings.' })
      } finally {
        if (mounted) setLoading(false)
      }
    })()
    return () => {
      mounted = false
    }
  }, [])

  const updateSetting = (key: keyof AppSettings, value: unknown) => {
    setSettings((prev) => ({ ...prev, [key]: value }))
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.saveSettings({
        maxFileSizeKB: settings.maxFileSizeKB,
        includeTree: settings.includeTree,
        respectGitignore: settings.respectGitignore,
      })
      setStatus({ kind: 'success', message: 'Settings saved.' })
    } catch {
      setStatus({ kind: 'error', message: 'Failed to save settings.' })
    }
  }

  const handleReset = async () => {
    if (!window.confirm('Reset all settings to their default values? This cannot be undone.')) {
      return
    }
    try {
      await api.resetSettings()
      setSettings(defaultSettings)
      setStatus({ kind: 'success', message: 'Settings reset to defaults.' })
    } catch {
      setStatus({ kind: 'error', message: 'Failed to reset settings.' })
    }
  }

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
          <Button type="submit" variant="default" disabled={loading}>
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
          <Button variant="danger" onClick={handleReset} disabled={loading}>
            Reset settings
          </Button>
        </div>
      </Card>
    </div>
  )
}
