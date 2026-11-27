import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, CornerDownLeft, Search } from 'lucide-react'
import { cx, score } from '../utils'

export interface PaletteCommand {
  id: string
  label: string
  hint?: string
  group: string
  icon?: ReactNode
  run: () => void
}

interface Props {
  open: boolean
  commands: PaletteCommand[]
  onClose: () => void
}

export default function CommandPalette({ open, commands, onClose }: Props) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setActive(0)
      setTimeout(() => inputRef.current?.focus(), 20)
    }
  }, [open])

  const filtered = useMemo(() => {
    if (!query.trim()) return commands
    return commands
      .map((c) => ({ c, s: score(query, `${c.label} ${c.hint ?? ''} ${c.group}`) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.c)
  }, [commands, query])

  useEffect(() => {
    setActive(0)
  }, [query])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setActive((a) => Math.min(a + 1, filtered.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setActive((a) => Math.max(a - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const cmd = filtered[active]
        if (cmd) {
          cmd.run()
          onClose()
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, filtered, active, onClose])

  if (!open) return null

  let lastGroup = ''

  return (
    <div className="palette-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="palette" role="dialog" aria-modal="true">
        <div className="palette-input">
          <Search size={17} style={{ color: 'var(--text-dim)' }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search commands, elements, types…"
            spellCheck={false}
          />
          <span className="kbd">Esc</span>
        </div>

        <div className="palette-list">
          {filtered.length === 0 && <div className="palette-empty">No matches for “{query}”.</div>}
          {filtered.map((cmd, i) => {
            const showGroup = cmd.group !== lastGroup
            lastGroup = cmd.group
            return (
              <div key={cmd.id}>
                {showGroup && <div className="palette-group">{cmd.group}</div>}
                <button
                  className={cx('palette-item', i === active && 'active')}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => {
                    cmd.run()
                    onClose()
                  }}
                >
                  {cmd.icon && <span className="icon">{cmd.icon}</span>}
                  <span>{cmd.label}</span>
                  {cmd.hint && <span className="meta">{cmd.hint}</span>}
                </button>
              </div>
            )
          })}
        </div>

        <div className="palette-foot">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <ArrowUp size={11} /> <ArrowDown size={11} /> navigate
          </span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <CornerDownLeft size={11} /> open
          </span>
          <span style={{ marginLeft: 'auto' }}>{filtered.length} results</span>
        </div>
      </div>
    </div>
  )
}
