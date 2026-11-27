import { useEffect, useRef, useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  Command,
  FileCode2,
  FilePlus2,
  History,
  Moon,
  Plus,
  Sun,
  Trash2,
  TriangleAlert,
  CircleHelp,
  Upload,
} from 'lucide-react'
import type { Diagnostic, FileInfo, FileResponse } from '../types'
import { cx, formatBytes, formatTime } from '../utils'

interface Props {
  files: FileInfo[]
  file: FileResponse | null
  saving: boolean
  sourceDirty: boolean
  theme: 'dark' | 'light'
  diagnostics: Diagnostic[]
  onOpenFile: (name: string) => void
  onNewFile: () => void
  onImport: () => void
  onDeleteFile: () => void
  onToggleTheme: () => void
  onOpenPalette: () => void
  onOpenHistory: () => void
  onOpenHelp: () => void
  onShowDiagnostics: () => void
}

function BrandMark() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M5.5 7.5h4.2M14.3 7.5h4.2M12 9.2v5.6M7 13h10"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="5" cy="7.5" r="2" fill="currentColor" />
      <circle cx="19" cy="7.5" r="2" fill="currentColor" />
      <circle cx="12" cy="16.5" r="2" fill="currentColor" />
    </svg>
  )
}

export default function Header(props: Props) {
  const {
    files,
    file,
    saving,
    sourceDirty,
    theme,
    diagnostics,
    onOpenFile,
    onNewFile,
    onImport,
    onDeleteFile,
    onToggleTheme,
    onOpenPalette,
    onOpenHistory,
    onOpenHelp,
    onShowDiagnostics,
  } = props
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menuOpen) return
    const onClick = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [menuOpen])

  const errors = diagnostics.filter((d) => d.severity === 'error').length
  const warnings = diagnostics.filter((d) => d.severity === 'warning').length
  const diagClass = errors ? 'has-errors' : warnings ? 'has-warnings' : ''
  const saveLabel = saving ? 'Saving…' : sourceDirty ? 'Unsaved source' : 'Saved'

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <BrandMark />
        </div>
        <div className="brand-text">
          <span className="brand-name">SkyView</span>
          <span className="brand-sub">SysML v2 workbench</span>
        </div>
      </div>

      <div className="topbar-divider" />

      <div className="file-switcher" ref={menuRef}>
        <button className="file-button" onClick={() => setMenuOpen((v) => !v)}>
          <FileCode2 size={15} style={{ color: 'var(--accent)' }} />
          <span className="filename">{file?.name ?? 'No model'}</span>
          <ChevronDown size={14} className="chevron" />
        </button>
        {menuOpen && (
          <div className="file-menu">
            <div className="file-menu-section">Workspace models</div>
            {files.length === 0 && (
              <div style={{ padding: '10px', color: 'var(--text-dim)', fontSize: 12 }}>
                No .sysml files yet.
              </div>
            )}
            {files.map((f) => (
              <button
                key={f.name}
                className={cx('file-menu-item', f.name === file?.name && 'active')}
                onClick={() => {
                  onOpenFile(f.name)
                  setMenuOpen(false)
                }}
              >
                <FileCode2 size={14} />
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {f.name}
                </span>
                <span className="meta">{formatBytes(f.size)}</span>
              </button>
            ))}
            <div className="file-menu-actions">
              <button className="btn btn-sm" onClick={onNewFile}>
                <FilePlus2 size={13} /> New
              </button>
              <button
                className="btn btn-sm"
                onClick={() => {
                  onImport()
                  setMenuOpen(false)
                }}
              >
                <Upload size={13} /> Import
              </button>
              <button className="btn btn-sm btn-danger" onClick={onDeleteFile} disabled={!file}>
                <Trash2 size={13} /> Delete
              </button>
            </div>
          </div>
        )}
      </div>

      <button className="icon-button tooltip" data-tip="New model file" onClick={onNewFile}>
        <Plus size={16} />
      </button>
      <button className="icon-button tooltip" data-tip="Import .sysml from desktop" onClick={onImport}>
        <Upload size={16} />
      </button>
      <button className="icon-button tooltip" data-tip="Version history" onClick={onOpenHistory}>
        <History size={16} />
      </button>

      <div className="topbar-spacer" />

      <div className="topbar-meta">
        <span className="save-state">
          <span className={cx('save-dot', saving && 'saving', sourceDirty && !saving && 'dirty')} />
          {saveLabel}
        </span>

        <button className={cx('diag-badge', diagClass)} onClick={onShowDiagnostics}>
          {errors ? (
            <CircleAlert size={13} />
          ) : warnings ? (
            <TriangleAlert size={13} />
          ) : (
            <CheckCircle2 size={13} />
          )}
          {errors || warnings ? (
            <span>
              {errors ? `${errors} error${errors === 1 ? '' : 's'}` : `${warnings} warning${warnings === 1 ? '' : 's'}`}
            </span>
          ) : (
            <span>Model clean</span>
          )}
        </button>

        <button className="cmd-trigger" onClick={onOpenPalette}>
          <Command size={13} />
          <span>Search</span>
          <span className="kbd">⌘K</span>
        </button>

        <button className="icon-button tooltip" data-tip="Toggle theme" onClick={onToggleTheme}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button className="icon-button tooltip" data-tip="Keyboard shortcuts" onClick={onOpenHelp}>
          <CircleHelp size={16} />
        </button>
      </div>
    </header>
  )
}
