import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Search, Keyboard, Command } from 'lucide-react'
import { clsx } from 'clsx'

interface CommandPaletteResult {
  id: string
  title: string
  subtitle?: string
  icon?: React.ReactElement
  onSelect: () => void
}

interface CommandPaletteProps {
  open: boolean
  onToggle: () => void
  onClose: () => void
  results: CommandPaletteResult[]
}

export function CommandPalette({ open, onToggle, onClose, results }: CommandPaletteProps) {
  const [query, setQuery] = useState('')
  const [selectedIndex, setSelectedIndex] = useState(-1)

  const filtered = useMemo(
    () =>
      results.filter(
        (r) =>
          !query ||
          r.title.toLowerCase().includes(query.toLowerCase()) ||
          r.subtitle?.toLowerCase().includes(query.toLowerCase()),
      ),
    [results, query],
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        onToggle()
        return
      }

      if (!open) return

      if (e.key === 'Escape') {
        onClose()
        return
      }

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIndex((i) => (i >= filtered.length - 1 ? 0 : i + 1))
        return
      }

      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIndex((i) => (i <= 0 ? filtered.length - 1 : i - 1))
        return
      }

      if (e.key === 'Enter') {
        e.preventDefault()
        const result = filtered[selectedIndex]
        if (result) {
          result.onSelect()
          onClose()
        }
        return
      }
    },
    [open, filtered, selectedIndex, onClose, onToggle],
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  useEffect(() => {
    if (!open) return
    setQuery('')
    setSelectedIndex(-1)
  }, [open])

  if (!open) return null

  return (
    <div className="command-palette">
      <div className="command-palette-backdrop" onClick={onClose} />
      <div className="command-palette-panel" onClick={(e) => e.stopPropagation()}>
        <input
          className="command-palette-search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search tools and commands..."
          onKeyDown={(e) => {
            if (e.key === 'Escape') onClose()
          }}
        />
        <div className="command-palette-results">
          {filtered.length === 0 ? (
            <div className="command-palette-result" style={{ pointerEvents: 'none' }}>
              <Search className="command-palette-result-icon" />
              <span>No results found</span>
            </div>
          ) : (
            filtered.map((result, index) => {
              const active = index === selectedIndex
              return (
                <div
                  key={result.id}
                  className={clsx('command-palette-result', active && 'command-palette-result-active')}
                  onClick={() => {
                    result.onSelect()
                    onClose()
                  }}
                >
                  {result.icon ?? <Keyboard className="command-palette-result-icon" />}
                  <div>
                    <span className="command-palette-result-title">{result.title}</span>
                    {result.subtitle && (
                      <span className="command-palette-result-subtitle">{result.subtitle}</span>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
        <div className="command-palette-hint">
          <span>
            <Command className="command-palette-hint-icon" /> K
          </span>{' '}
          to open&nbsp;&bull;&nbsp;<span>Esc</span> to close
        </div>
      </div>
    </div>
  )
}

