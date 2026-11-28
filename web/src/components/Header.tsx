import {
  CircleAlert,
  Command,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  TriangleAlert,
  CircleHelp,
  UserRound,
} from 'lucide-react'
import type { Diagnostic } from '../types'
import { cx } from '../utils'
import BrandMark from './BrandMark'

interface Props {
  sidebarVisible: boolean
  sidebarShortcut: string
  onToggleSidebar: () => void
  workspaceHost: (host: HTMLDivElement | null) => void
  saving: boolean
  sourceDirty: boolean
  theme: 'dark' | 'light'
  account?: string
  diagnostics: Diagnostic[]
  onToggleTheme: () => void
  onOpenPalette: () => void
  onOpenHelp: () => void
  onShowDiagnostics: () => void
}

export default function Header(props: Props) {
  const {
    sidebarVisible,
    sidebarShortcut,
    onToggleSidebar,
    workspaceHost,
    saving,
    sourceDirty,
    theme,
    account,
    diagnostics,
    onToggleTheme,
    onOpenPalette,
    onOpenHelp,
    onShowDiagnostics,
  } = props
  const errors = diagnostics.filter((d) => d.severity === 'error').length
  const warnings = diagnostics.filter((d) => d.severity === 'warning').length
  const diagClass = errors ? 'has-errors' : warnings ? 'has-warnings' : ''
  const sidebarLabel = sidebarVisible ? 'Hide sidebar' : 'Show sidebar'
  const sidebarKeys = sidebarShortcut === 'Meta+B' ? 'Cmd+B' : 'Ctrl+B'
  const saveLabel = saving ? 'Saving…' : sourceDirty ? 'Unsaved changes' : 'Saved'

  return (
    <header className="topbar">
      <button id="sidebar-toggle" type="button" className="icon-button tooltip sidebar-toggle"
        aria-label={sidebarLabel} aria-expanded={sidebarVisible} aria-controls="workbench-sidebar"
        aria-keyshortcuts={sidebarShortcut} data-tip={sidebarLabel + ' (' + sidebarKeys + ')'} onClick={onToggleSidebar}>
        {sidebarVisible ? <PanelLeftClose size={16} aria-hidden="true" /> : <PanelLeftOpen size={16} aria-hidden="true" />}
      </button>
      <div className="brand">
        <BrandMark />
        <div className="brand-text">
          <span className="brand-name">SkyView</span>
          <span className="brand-sub">SysML v2 workbench</span>
        </div>
      </div>

      <div className="topbar-divider" />

      <div ref={workspaceHost} />
      <div className="topbar-spacer" />

      <div className="topbar-meta">
        {(saving || sourceDirty) && <span className="save-state" role="status">
          <span className={cx('save-dot', saving && 'saving', sourceDirty && !saving && 'dirty')} />
          {saveLabel}
        </span>}

        {!!(errors || warnings) && <button className={cx('diag-badge', diagClass)} onClick={onShowDiagnostics}>
          {errors ? <CircleAlert size={13} /> : <TriangleAlert size={13} />}
          <span>{errors ? errors + (errors === 1 ? ' error' : ' errors') : warnings + (warnings === 1 ? ' warning' : ' warnings')}</span>
        </button>}

        <button className="cmd-trigger" onClick={onOpenPalette}>
          <Command size={13} />
          <span>Search</span>
        </button>

        <button className="icon-button tooltip" data-tip="Toggle theme" aria-label="Toggle theme" onClick={onToggleTheme}>
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        <button className="icon-button tooltip" data-tip="Keyboard shortcuts" aria-label="Keyboard shortcuts" onClick={onOpenHelp}>
          <CircleHelp size={16} />
        </button>
        {account && <span className="header-account" title={'Current user: ' + account}>
          <UserRound size={15} aria-hidden="true" /> <span>{account}</span>
        </span>}
      </div>
    </header>
  )
}
