// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { AppSettings } from './types'

const defaults: AppSettings = {
  favorites: [],
  recents: [],
  theme: 'dark',
  maxFileSizeKB: 1024,
  includeTree: true,
  respectGitignore: true,
}
const api = {
  getSettings: vi.fn<() => Promise<AppSettings>>(),
  saveSettings: vi.fn<(patch: Partial<AppSettings>) => Promise<{ success: boolean }>>(),
  resetSettings: vi.fn<() => Promise<{ success: boolean }>>(),
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

vi.mock('./components/sidebar', () => ({
  Sidebar: ({ onSelect }: { onSelect: (id: string) => void }) => (
    <nav>{['home', 'tools', 'settings'].map((id) => <button key={id} onClick={() => onSelect(id)}>{id}</button>)}</nav>
  ),
}))
vi.mock('./pages/home', () => ({
  default: ({ favorites, onToggleFavorite, recents, onSelect, onRemoveRecent }: {
    favorites: string[]
    onToggleFavorite: (id: 'project-to-markdown' | 'xmind-to-markdown') => void
    recents: ('project-to-markdown' | 'xmind-to-markdown')[]
    onSelect: (id: string) => void
    onRemoveRecent: (id: 'project-to-markdown' | 'xmind-to-markdown') => void
  }) => (
    <section data-testid="home-page">
      <output data-testid="home-favorites">{favorites.join(',')}</output>
      <output data-testid="home-recents">{recents.join(',')}</output>
      <button onClick={() => onToggleFavorite('project-to-markdown')}>Toggle Project favorite</button>
      <button onClick={() => onToggleFavorite('xmind-to-markdown')}>Toggle XMind favorite</button>
      <button onClick={() => onSelect('project-to-markdown')}>Open Project from Home</button>
      <button onClick={() => onSelect('xmind-to-markdown')}>Open XMind from Home</button>
      <button onClick={() => recents[0] && onRemoveRecent(recents[0])}>Remove first recent</button>
    </section>
  ),
}))
vi.mock('./pages/settings', () => ({
  default: ({ onResetSuccess }: { onResetSuccess: () => void }) => (
    <section data-testid="settings-page">
      <button onClick={async () => {
        try {
          const result = await window.api.resetSettings()
          if (result.success) onResetSuccess()
        } catch { /* modeled by the real SettingsPage tests */ }
      }}>Reset saved settings</button>
    </section>
  ),
}))
vi.mock('./pages/project-to-markdown', () => ({ default: () => <div data-testid="project-page">Project page</div> }))
vi.mock('./pages/xmind-to-markdown', () => ({ default: () => <div data-testid="xmind-page">XMind page</div> }))

beforeEach(() => {
  api.getSettings.mockResolvedValue({ ...defaults })
  api.saveSettings.mockResolvedValue({ success: true })
  api.resetSettings.mockResolvedValue({ success: true })
  Object.defineProperty(window, 'api', { configurable: true, value: api })
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('App navigation and recents', () => {
  it('records Home navigation and persists the recent tool', async () => {
    render(<App />)
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled())
    fireEvent.click(screen.getByText('Open Project from Home'))
    expect(screen.getByTestId('project-page')).toBeTruthy()
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ favorites: [], recents: ['project-to-markdown'] }))
  })

  it('records Tools and Command Palette navigation, newest first, with deduplication', async () => {
    render(<App />)
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'tools' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open Project to Markdown' }))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ favorites: [], recents: ['project-to-markdown'] }))
    fireEvent.click(screen.getByRole('button', { name: 'home' }))
    fireEvent.click(screen.getByText('Open XMind from Home'))
    await waitFor(() => expect(api.saveSettings).toHaveBeenLastCalledWith({ favorites: [], recents: ['xmind-to-markdown', 'project-to-markdown'] }))
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    fireEvent.change(screen.getByPlaceholderText('Search tools and commands...'), { target: { value: 'Project to Markdown' } })
    fireEvent.click(screen.getByText('Project to Markdown').closest('.command-palette-result')!)
    await waitFor(() => expect(api.saveSettings).toHaveBeenLastCalledWith({ favorites: [], recents: ['project-to-markdown', 'xmind-to-markdown'] }))
  })

  it('restores persisted recents and filters unknown IDs and duplicates', async () => {
    api.getSettings.mockResolvedValue({ ...defaults, recents: ['xmind-to-markdown', 'gone', 'xmind-to-markdown', 'project-to-markdown'] })
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('home-recents').textContent).toBe('xmind-to-markdown,project-to-markdown'))
  })

  it('removes a recent entry and persists the new list', async () => {
    api.getSettings.mockResolvedValue({ ...defaults, recents: ['xmind-to-markdown', 'project-to-markdown'] })
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('home-recents').textContent).toBe('xmind-to-markdown,project-to-markdown'))
    fireEvent.click(screen.getByText('Remove first recent'))
    expect(screen.getByTestId('home-recents').textContent).toBe('project-to-markdown')
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ favorites: [], recents: ['project-to-markdown'] }))
  })

  it('waits for late settings load before persisting early navigation and preserves untouched data', async () => {
    const pending = deferred<AppSettings>()
    api.getSettings.mockReturnValue(pending.promise)
    render(<App />)
    fireEvent.click(screen.getByText('Open XMind from Home'))
    expect(api.saveSettings).not.toHaveBeenCalled()
    await act(async () => pending.resolve({ ...defaults, favorites: ['project-to-markdown'], recents: ['project-to-markdown'] }))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({
      favorites: ['project-to-markdown'],
      recents: ['xmind-to-markdown', 'project-to-markdown'],
    }))
    fireEvent.click(screen.getByRole('button', { name: 'home' }))
    expect(screen.getByTestId('home-recents').textContent).toBe('xmind-to-markdown,project-to-markdown')
  })

  it('keeps the save queue usable after a rejected recents write', async () => {
    api.saveSettings.mockRejectedValueOnce(new Error('disk full'))
    render(<App />)
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled())
    fireEvent.click(screen.getByText('Open Project from Home'))
    expect(await screen.findByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'home' }))
    expect(screen.getByTestId('home-recents').textContent).toBe('project-to-markdown')
    fireEvent.click(screen.getByText('Open XMind from Home'))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('serializes rapid favorites and recents writes with the latest combined state', async () => {
    const first = deferred<{ success: boolean }>()
    api.saveSettings.mockImplementationOnce(async (patch) => {
      expect(patch).toEqual({ favorites: [], recents: ['project-to-markdown'] })
      await first.promise
      return { success: true }
    })
    render(<App />)
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled())
    fireEvent.click(screen.getByText('Open Project from Home'))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'home' }))
    fireEvent.click(screen.getByText('Toggle XMind favorite'))
    fireEvent.click(screen.getByText('Open XMind from Home'))
    first.resolve({ success: true })
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledTimes(3))
    expect(api.saveSettings).toHaveBeenNthCalledWith(2, { favorites: ['xmind-to-markdown'], recents: ['xmind-to-markdown', 'project-to-markdown'] })
    expect(api.saveSettings).toHaveBeenNthCalledWith(3, { favorites: ['xmind-to-markdown'], recents: ['xmind-to-markdown', 'project-to-markdown'] })
  })

  it('shows an empty recent state when no tools have been opened', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('home-recents').textContent).toBe(''))
  })

  it('clears Favorites and Recents after a successful Reset without duplicate writes', async () => {
    api.getSettings.mockResolvedValue({ ...defaults, favorites: ['project-to-markdown'], recents: ['xmind-to-markdown'] })
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('home-recents').textContent).toBe('xmind-to-markdown'))
    fireEvent.click(screen.getByRole('button', { name: 'settings' }))
    await waitFor(() => expect(screen.getByTestId('settings-page')).toBeTruthy())
    fireEvent.click(screen.getByText('Reset saved settings'))
    await waitFor(() => expect(api.resetSettings).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'home' }))
    await waitFor(() => {
      expect(screen.getByTestId('home-recents').textContent).toBe('')
      expect(screen.getByTestId('home-favorites').textContent).toBe('')
    })
    expect(api.saveSettings).not.toHaveBeenCalled()
  })
})


describe('App Favorites compatibility', () => {
  it('loads only known favorite IDs and shares the state with Tools', async () => {
    api.getSettings.mockResolvedValue({ ...defaults, favorites: ['xmind-to-markdown', 'removed-tool', 'xmind-to-markdown'] })
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('home-favorites').textContent).toBe('xmind-to-markdown'))
    fireEvent.click(screen.getByRole('button', { name: 'tools' }))
    expect(screen.getByRole('button', { name: 'Remove XMind to Markdown from favorites' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Add Project to Markdown to favorites' })).toBeTruthy()
  })

  it('waits for late settings load before persisting an early favorite and preserves untouched Recents', async () => {
    const pending = deferred<AppSettings>()
    api.getSettings.mockReturnValue(pending.promise)
    render(<App />)
    fireEvent.click(screen.getByText('Toggle Project favorite'))
    expect(api.saveSettings).not.toHaveBeenCalled()
    await act(async () => pending.resolve({ ...defaults, favorites: ['xmind-to-markdown'], recents: ['xmind-to-markdown'] }))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({
      favorites: ['xmind-to-markdown', 'project-to-markdown'],
      recents: ['xmind-to-markdown'],
    }))
    expect(screen.getByTestId('home-favorites').textContent).toBe('xmind-to-markdown,project-to-markdown')
    expect(screen.getByTestId('home-recents').textContent).toBe('xmind-to-markdown')
  })

  it('keeps favorite state after a save rejection and recovers on the next toggle', async () => {
    api.saveSettings.mockRejectedValueOnce(new Error('disk unavailable'))
    render(<App />)
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled())
    fireEvent.click(screen.getByText('Toggle Project favorite'))
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByTestId('home-favorites').textContent).toBe('project-to-markdown')
    fireEvent.click(screen.getByText('Toggle XMind favorite'))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('preserves favorites when Reset fails and allows a new favorite after successful Reset', async () => {
    api.getSettings.mockResolvedValue({ ...defaults, favorites: ['project-to-markdown'] })
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('home-favorites').textContent).toBe('project-to-markdown'))
    fireEvent.click(screen.getByRole('button', { name: 'settings' }))
    await waitFor(() => expect(screen.getByTestId('settings-page')).toBeTruthy())
    api.resetSettings.mockResolvedValueOnce({ success: false })
    fireEvent.click(screen.getByText('Reset saved settings'))
    await waitFor(() => expect(api.resetSettings).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'home' }))
    expect(screen.getByTestId('home-favorites').textContent).toBe('project-to-markdown')

    fireEvent.click(screen.getByRole('button', { name: 'settings' }))
    await waitFor(() => expect(screen.getByTestId('settings-page')).toBeTruthy())
    api.resetSettings.mockResolvedValueOnce({ success: true })
    fireEvent.click(screen.getByText('Reset saved settings'))
    await waitFor(() => expect(api.resetSettings).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'home' }))
    await waitFor(() => expect(screen.getByTestId('home-favorites').textContent).toBe(''))
    fireEvent.click(screen.getByText('Toggle XMind favorite'))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ favorites: ['xmind-to-markdown'], recents: [] }))
  })
})


describe('App Recents lifecycle and failure handling', () => {
  it('restores the last saved recents after remounting the App', async () => {
    let persisted = { ...defaults, recents: [] as string[] }
    api.getSettings.mockImplementation(async () => ({ ...persisted }))
    api.saveSettings.mockImplementation(async (patch) => {
      persisted = { ...persisted, ...patch }
      return { success: true }
    })
    const first = render(<App />)
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled())
    fireEvent.click(screen.getByText('Open XMind from Home'))
    await waitFor(() => expect(persisted.recents).toEqual(['xmind-to-markdown']))
    first.unmount()
    cleanup()
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('home-recents').textContent).toBe('xmind-to-markdown'))
  })

  it('does not duplicate a tool when it is opened repeatedly', async () => {
    render(<App />)
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled())
    fireEvent.click(screen.getByText('Open Project from Home'))
    fireEvent.click(screen.getByRole('button', { name: 'home' }))
    fireEvent.click(screen.getByText('Open Project from Home'))
    await waitFor(() => expect(api.saveSettings).toHaveBeenLastCalledWith({ favorites: [], recents: ['project-to-markdown'] }))
    fireEvent.click(screen.getByRole('button', { name: 'home' }))
    expect(screen.getByTestId('home-recents').textContent).toBe('project-to-markdown')
  })

  it('waits for pending app-data writes before entering Settings', async () => {
    const pending = deferred<{ success: boolean }>()
    api.saveSettings.mockReturnValueOnce(pending.promise)
    render(<App />)
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled())
    fireEvent.click(screen.getByText('Open Project from Home'))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'settings' }))
    expect(screen.queryByTestId('settings-page')).toBeNull()
    pending.resolve({ success: true })
    expect(await screen.findByTestId('settings-page')).toBeTruthy()
  })

  it('preserves both Favorites and Recents when Reset rejects', async () => {
    api.getSettings.mockResolvedValue({ ...defaults, favorites: ['project-to-markdown'], recents: ['xmind-to-markdown'] })
    api.resetSettings.mockRejectedValueOnce(new Error('disk unavailable'))
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('home-favorites').textContent).toBe('project-to-markdown'))
    fireEvent.click(screen.getByRole('button', { name: 'settings' }))
    await waitFor(() => expect(screen.getByTestId('settings-page')).toBeTruthy())
    fireEvent.click(screen.getByText('Reset saved settings'))
    await waitFor(() => expect(api.resetSettings).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'home' }))
    expect(screen.getByTestId('home-favorites').textContent).toBe('project-to-markdown')
    expect(screen.getByTestId('home-recents').textContent).toBe('xmind-to-markdown')
  })

  it('treats success:false as a persistence failure and retries on the next recent change', async () => {
    api.saveSettings.mockResolvedValueOnce({ success: false }).mockResolvedValueOnce({ success: true })
    render(<App />)
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled())
    fireEvent.click(screen.getByText('Open Project from Home'))
    expect(await screen.findByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'home' }))
    fireEvent.click(screen.getByText('Open XMind from Home'))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('removing the final recent item returns the list to its empty state', async () => {
    api.getSettings.mockResolvedValue({ ...defaults, recents: ['project-to-markdown'] })
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('home-recents').textContent).toBe('project-to-markdown'))
    fireEvent.click(screen.getByText('Remove first recent'))
    await waitFor(() => expect(screen.getByTestId('home-recents').textContent).toBe(''))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({ favorites: [], recents: [] }))
  })

  it('keeps unknown recent IDs out of runtime navigation and UI', async () => {
    api.getSettings.mockResolvedValue({ ...defaults, recents: ['missing-tool'] })
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('home-recents').textContent).toBe(''))
    fireEvent.click(screen.getByRole('button', { name: 'tools' }))
    expect(screen.getByText('Project to Markdown')).toBeTruthy()
  })
})


describe('App combined Favorites and Recents persistence', () => {
  it('retries a failed Recents save with the current Favorites and Recents after a Favorite toggle', async () => {
    api.saveSettings.mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce({ success: true })
    render(<App />)
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled())

    fireEvent.click(screen.getByText('Open Project from Home'))
    expect(await screen.findByRole('alert')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'home' }))
    fireEvent.click(screen.getByText('Toggle XMind favorite'))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledTimes(2))

    expect(api.saveSettings).toHaveBeenNthCalledWith(2, {
      favorites: ['xmind-to-markdown'],
      recents: ['project-to-markdown'],
    })
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('retries a failed Favorites save with the current Favorites and Recents after a Recent removal', async () => {
    api.getSettings.mockResolvedValue({
      ...defaults,
      favorites: ['project-to-markdown'],
      recents: ['xmind-to-markdown', 'project-to-markdown'],
    })
    api.saveSettings.mockRejectedValueOnce(new Error('disk full')).mockResolvedValueOnce({ success: true })
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('home-recents').textContent).toBe('xmind-to-markdown,project-to-markdown'))

    fireEvent.click(screen.getByText('Toggle Project favorite'))
    expect(await screen.findByRole('alert')).toBeTruthy()

    fireEvent.click(screen.getByText('Remove first recent'))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledTimes(2))
    expect(api.saveSettings).toHaveBeenNthCalledWith(2, {
      favorites: [],
      recents: ['project-to-markdown'],
    })
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('keeps persistence errors visible until a successful combined write completes', async () => {
    const first = deferred<{ success: boolean }>()
    api.saveSettings.mockImplementationOnce(() => first.promise).mockResolvedValueOnce({ success: true })
    render(<App />)
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled())

    fireEvent.click(screen.getByText('Open Project from Home'))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledTimes(1))
    first.resolve({ success: false })
    expect(await screen.findByRole('alert')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'home' }))
    fireEvent.click(screen.getByText('Toggle XMind favorite'))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledTimes(2))
    expect(api.saveSettings).toHaveBeenNthCalledWith(2, {
      favorites: ['xmind-to-markdown'],
      recents: ['project-to-markdown'],
    })
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('does not let a delayed Settings navigation override a later page selection', async () => {
    const pending = deferred<{ success: boolean }>()
    api.saveSettings.mockReturnValueOnce(pending.promise)
    render(<App />)
    await waitFor(() => expect(api.getSettings).toHaveBeenCalled())

    fireEvent.click(screen.getByText('Open Project from Home'))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'settings' }))
    fireEvent.click(screen.getByRole('button', { name: 'home' }))
    pending.resolve({ success: true })

    await waitFor(() => expect(screen.getByTestId('home-page')).toBeTruthy())
    expect(screen.queryByTestId('settings-page')).toBeNull()
  })
})

describe('App Settings load recovery', () => {
  it('does not save an incomplete snapshot after load failure and Favorite changes until retry succeeds', async () => {
    api.getSettings.mockRejectedValueOnce(new Error('temporary read failure')).mockRejectedValueOnce(new Error('still unavailable')).mockResolvedValueOnce({
      ...defaults,
      favorites: ['xmind-to-markdown'],
      recents: ['project-to-markdown'],
    })
    render(<App />)
    expect(await screen.findByRole('alert')).toBeTruthy()

    fireEvent.click(screen.getByText('Toggle Project favorite'))
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(2))
    expect(api.saveSettings).not.toHaveBeenCalled()
    expect(screen.getByTestId('home-favorites').textContent).toBe('project-to-markdown')
    expect(screen.getByRole('alert')).toBeTruthy()

    fireEvent.click(screen.getByText('Toggle XMind favorite'))
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({
      favorites: ['project-to-markdown'],
      recents: ['project-to-markdown'],
    }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('does not save an incomplete snapshot after load failure and Recent changes until retry succeeds', async () => {
    api.getSettings.mockRejectedValueOnce(new Error('temporary read failure')).mockRejectedValueOnce(new Error('still unavailable')).mockResolvedValueOnce({
      ...defaults,
      favorites: ['project-to-markdown'],
      recents: ['xmind-to-markdown'],
    })
    render(<App />)
    expect(await screen.findByRole('alert')).toBeTruthy()

    fireEvent.click(screen.getByText('Open Project from Home'))
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(2))
    expect(api.saveSettings).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'home' }))
    expect(screen.getByTestId('home-recents').textContent).toBe('project-to-markdown')

    fireEvent.click(screen.getByRole('button', { name: 'home' }))
    fireEvent.click(screen.getByText('Open XMind from Home'))
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({
      favorites: ['project-to-markdown'],
      recents: ['xmind-to-markdown', 'project-to-markdown'],
    }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('replays multiple pending updates in order over the recovered Settings snapshot', async () => {
    api.getSettings.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({
      ...defaults,
      favorites: ['project-to-markdown'],
      recents: ['xmind-to-markdown'],
    })
    render(<App />)
    expect(await screen.findByRole('alert')).toBeTruthy()

    fireEvent.click(screen.getByText('Toggle XMind favorite'))
    fireEvent.click(screen.getByText('Toggle XMind favorite'))
    fireEvent.click(screen.getByText('Open Project from Home'))
    fireEvent.click(screen.getByRole('button', { name: 'home' }))
    fireEvent.click(screen.getByText('Open XMind from Home'))

    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({
      favorites: ['project-to-markdown'],
      recents: ['xmind-to-markdown', 'project-to-markdown'],
    }))
    fireEvent.click(screen.getByRole('button', { name: 'home' }))
    expect(screen.getByTestId('home-favorites').textContent).toBe('project-to-markdown')
    expect(screen.getByTestId('home-recents').textContent).toBe('xmind-to-markdown,project-to-markdown')
  })

  it('keeps Settings inaccessible after repeated load failures and retries on a later action', async () => {
    api.getSettings.mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('still offline')).mockResolvedValueOnce({
      ...defaults,
      favorites: ['project-to-markdown'],
      recents: ['xmind-to-markdown'],
    })
    render(<App />)
    expect(await screen.findByRole('alert')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'settings' }))
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('settings-page')).toBeNull()
    expect(api.resetSettings).not.toHaveBeenCalled()
    expect(api.saveSettings).not.toHaveBeenCalled()

    fireEvent.click(screen.getByText('Toggle Project favorite'))
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(3))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({
      favorites: [],
      recents: ['xmind-to-markdown'],
    }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })

  it('does not overwrite unknown collections while retry is pending and persists after recovery', async () => {
    const retry = deferred<AppSettings>()
    api.getSettings.mockRejectedValueOnce(new Error('offline')).mockReturnValueOnce(retry.promise)
    render(<App />)
    expect(await screen.findByRole('alert')).toBeTruthy()

    fireEvent.click(screen.getByText('Toggle Project favorite'))
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(2))
    expect(api.saveSettings).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('Toggle XMind favorite'))
    expect(api.saveSettings).not.toHaveBeenCalled()

    await act(async () => retry.resolve({
      ...defaults,
      favorites: ['project-to-markdown'],
      recents: ['xmind-to-markdown'],
    }))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({
      favorites: ['xmind-to-markdown'],
      recents: ['xmind-to-markdown'],
    }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})

  it('persists early updates after Settings navigation successfully recovers a failed initial load', async () => {
    const initial = deferred<AppSettings>()
    api.getSettings.mockReturnValueOnce(initial.promise).mockResolvedValueOnce({
      ...defaults,
      favorites: ['xmind-to-markdown'],
      recents: ['project-to-markdown'],
    })
    render(<App />)
    fireEvent.click(screen.getByText('Toggle Project favorite'))
    expect(api.saveSettings).not.toHaveBeenCalled()
    await act(async () => initial.reject(new Error('initial read failed')))
    expect(await screen.findByRole('alert')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'settings' }))
    await waitFor(() => expect(api.getSettings).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(api.saveSettings).toHaveBeenCalledWith({
      favorites: ['xmind-to-markdown', 'project-to-markdown'],
      recents: ['project-to-markdown'],
    }))
    expect(await screen.findByTestId('settings-page')).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
