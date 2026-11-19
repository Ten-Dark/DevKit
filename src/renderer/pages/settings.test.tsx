// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SettingsPage from './settings'
import type { AppSettings, UpdaterInfo } from '../types'

const defaults: AppSettings = {
  favorites: [],
  recents: [],
  theme: 'dark',
  maxFileSizeKB: 1024,
  includeTree: true,
  respectGitignore: true,
}
const updaterInfo: UpdaterInfo = { status: 'idle', currentVersion: '1.0.0' }
const api = {
  getSettings: vi.fn<() => Promise<AppSettings>>(),
  saveSettings: vi.fn<(patch: Partial<AppSettings>) => Promise<{ success: boolean }>>(),
  resetSettings: vi.fn<() => Promise<{ success: boolean }>>(),
  getAppVersion: vi.fn<() => Promise<string>>(),
  updater: {
    getInfo: vi.fn<() => Promise<UpdaterInfo>>(),
    check: vi.fn<() => Promise<UpdaterInfo>>(),
    download: vi.fn<() => Promise<{ success: boolean; error?: string }>>(),
    cancelDownload: vi.fn<() => Promise<{ success: boolean; error?: string }>>(),
    install: vi.fn<() => Promise<{ success: boolean; error?: string }>>(),
    onStatusChange: vi.fn<(callback: (info: UpdaterInfo) => void) => () => void>(),
  },
}

beforeEach(() => {
  api.getSettings.mockResolvedValue({ ...defaults })
  api.saveSettings.mockResolvedValue({ success: true })
  api.resetSettings.mockResolvedValue({ success: true })
  api.getAppVersion.mockResolvedValue('1.0.0')
  api.updater.getInfo.mockResolvedValue(updaterInfo)
  api.updater.cancelDownload.mockResolvedValue({ success: true })
  api.updater.onStatusChange.mockReturnValue(vi.fn())
  Object.defineProperty(window, 'api', { configurable: true, value: api })
  window.confirm = vi.fn().mockReturnValue(true)
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SettingsPage persistence actions', () => {
  it('calls the Reset callback only after resetSettings succeeds', async () => {
    const onResetSuccess = vi.fn()
    render(<SettingsPage onResetSuccess={onResetSuccess} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reset settings' }))
    await waitFor(() => expect(onResetSuccess).toHaveBeenCalledTimes(1))
    expect(api.resetSettings).toHaveBeenCalledTimes(1)
  })

  it('does not call the Reset callback when resetSettings returns success:false', async () => {
    api.resetSettings.mockResolvedValueOnce({ success: false })
    const onResetSuccess = vi.fn()
    render(<SettingsPage onResetSuccess={onResetSuccess} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reset settings' }))
    expect(await screen.findByText('Failed to reset settings.')).toBeTruthy()
    expect(onResetSuccess).not.toHaveBeenCalled()
  })

  it('does not call the Reset callback when resetSettings rejects', async () => {
    api.resetSettings.mockRejectedValueOnce(new Error('disk unavailable'))
    const onResetSuccess = vi.fn()
    render(<SettingsPage onResetSuccess={onResetSuccess} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Reset settings' }))
    expect(await screen.findByText('Failed to reset settings.')).toBeTruthy()
    expect(onResetSuccess).not.toHaveBeenCalled()
  })

  it('submits the settings form and reports save errors', async () => {
    api.saveSettings.mockRejectedValueOnce(new Error('disk unavailable'))
    render(<SettingsPage onResetSuccess={vi.fn()} />)
    const save = await screen.findByRole('button', { name: 'Save settings' })
    expect(save.getAttribute('type')).toBe('submit')
    fireEvent.click(save)
    expect(await screen.findByText('Failed to save settings.')).toBeTruthy()
    expect(api.saveSettings).toHaveBeenCalledTimes(1)
  })

  it('disables Save and Reset while either mutation is pending', async () => {
    let resolveReset!: (value: { success: boolean }) => void
    api.resetSettings.mockReturnValueOnce(new Promise((resolve) => { resolveReset = resolve }))
    render(<SettingsPage onResetSuccess={vi.fn()} />)
    const reset = await screen.findByRole('button', { name: 'Reset settings' })
    const save = await screen.findByRole('button', { name: 'Save settings' })
    fireEvent.click(reset)
    await waitFor(() => {
      expect((reset as HTMLButtonElement).disabled).toBe(true)
      expect((save as HTMLButtonElement).disabled).toBe(true)
    })
    resolveReset({ success: true })
    await waitFor(() => expect((reset as HTMLButtonElement).disabled).toBe(false))
  })
})

describe('SettingsPage updater lifecycle UI', () => {
  it('renders unsupported packaged updater mode without claiming the app is up to date', async () => {
    api.updater.getInfo.mockResolvedValueOnce({
      status: 'unsupported',
      currentVersion: '1.0.0',
      error: 'Updates are available only in packaged Windows NSIS builds.',
    })
    render(<SettingsPage onResetSuccess={vi.fn()} />)
    expect(await screen.findByText(/Updates are available only in packaged Windows NSIS builds/)).toBeTruthy()
  })

  it('shows retry download after a failed download while retaining the available version', async () => {
    api.updater.getInfo.mockResolvedValueOnce({
      status: 'error',
      currentVersion: '1.0.0',
      availableVersion: '1.0.2',
      error: 'Connection dropped',
    })
    render(<SettingsPage onResetSuccess={vi.fn()} />)
    expect(await screen.findByRole('button', { name: 'Retry download' })).toBeTruthy()
    expect(screen.getByText('Connection dropped')).toBeTruthy()
  })

  it('shows cancellation state and invokes the explicit cancel action', async () => {
    let updateStatus: ((info: UpdaterInfo) => void) | undefined
    api.updater.onStatusChange.mockImplementation((callback) => {
      updateStatus = callback
      return vi.fn()
    })
    render(<SettingsPage onResetSuccess={vi.fn()} />)
    await screen.findByText('Not checked yet.')
    updateStatus?.({
      status: 'downloading',
      currentVersion: '1.0.0',
      availableVersion: '1.0.2',
      downloadProgress: 25,
    })
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel download' }))
    await waitFor(() => expect(api.updater.cancelDownload).toHaveBeenCalledTimes(1))
  })

  it('shows installation preparation and disables conflicting actions', async () => {
    let updateStatus: ((info: UpdaterInfo) => void) | undefined
    api.updater.onStatusChange.mockImplementation((callback) => {
      updateStatus = callback
      return vi.fn()
    })
    render(<SettingsPage onResetSuccess={vi.fn()} />)
    await screen.findByText('Not checked yet.')
    updateStatus?.({ status: 'installing', currentVersion: '1.0.0', availableVersion: '1.0.2' })
    expect(await screen.findByText(/Preparing to restart and install/)).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Check for updates' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
