import {
  Bell,
  BookOpen,
  CircleAlert,
  CircleDot,
  Info,
  Moon,
  Search,
  Sun,
  TriangleAlert,
  CircleHelp,
  UserRound,
} from 'lucide-react'
import type { BuildInfo } from '../about'
import type { Diagnostic } from '../types'
import { plural } from '../utils'
import BrandMark, { brandDescription } from './BrandMark'
import ActionMenu from './ActionMenu'
import UnsavedDot from './UnsavedDot'

interface Props {
  workspaceHost: (host: HTMLDivElement | null) => void
  saving: boolean
  sourceDirty: boolean
  theme: 'dark' | 'light'
  account?: string
  build?: BuildInfo
  useMacShortcut: boolean
  diagnostics: Diagnostic[]
  onToggleTheme: () => void
  onOpenPalette: () => void
  onOpenHelp: () => void
  onShowDiagnostic: (line: number) => void
}

const diagnosticKinds = [
  { severity: 'error', name: 'error', icon: CircleAlert },
  { severity: 'warning', name: 'warning', icon: TriangleAlert },
  { severity: 'info', name: 'note', icon: Info },
] as const

export default function Header(props: Props) {
  const {
    workspaceHost,
    saving,
    sourceDirty,
    theme,
    account,
    build,
    useMacShortcut,
    diagnostics,
    onToggleTheme,
    onOpenPalette,
    onOpenHelp,
    onShowDiagnostic,
  } = props
  const groups = diagnosticKinds.flatMap(kind => {
    const issues = diagnostics.filter(item => item.severity === kind.severity)
    return issues.length ? [{ ...kind, issues }] : []
  })
  const summary = groups.map(group => plural(group.issues.length, group.name)).join(' · ')
  const saveLabel = saving ? 'Saving…' : sourceDirty ? 'Unsaved changes' : 'Saved'
  const releaseTag = build?.official ? build.tag : undefined
  const releasesLink = build?.repository ? `${build.repository}/releases` : undefined
  const releaseLink = releaseTag && releasesLink ? `${releasesLink}/tag/${encodeURIComponent(releaseTag)}` : releasesLink

  return (
    <header className="topbar">
      <div className="brand" title={brandDescription}>
        <BrandMark />
        <div className="brand-text">
          <span className="brand-name">SkyView</span>
          <span className="brand-sub">SysML v2 design tool</span>
        </div>
      </div>

      <div className="topbar-divider" />

      <div ref={workspaceHost} />
      <div className="topbar-spacer" />

      <div className="topbar-meta">
        {(saving || sourceDirty) && <span className="save-state" role="status">
          {saving ? <span className="save-dot saving" /> : <UnsavedDot />}
          {saveLabel}
        </span>}

        <button type="button" className="cmd-trigger" aria-label="Search" aria-haspopup="dialog"
          aria-keyshortcuts="Control+K Meta+K" onClick={onOpenPalette}>
          <Search size={15} aria-hidden="true" />
          <span className="cmd-trigger-label">Search</span>
          <kbd className="kbd" aria-hidden="true">{useMacShortcut ? '⌘ K' : 'Ctrl K'}</kbd>
        </button>

        <ActionMenu className="header-menu header-issues" label={summary ? `Issues, ${summary}` : 'Issues'} iconOnly
          trigger={<><CircleDot size={16} aria-hidden="true" />{groups.length > 0 && <span className="issue-count"
            data-severity={groups[0].severity} aria-hidden="true">{diagnostics.length}</span>}</>}>
          <div className="header-menu-heading">
            <strong>Issues</strong>
            {summary && <span>{summary}</span>}
          </div>
          {groups.length ? <ul className="header-menu-list">
            {groups.flatMap(({ severity, name, issues, icon: Icon }) => issues.map((issue, index) => (
              <li key={`${severity}-${index}`}>
                <button type="button" onClick={() => onShowDiagnostic(issue.line)}>
                  <Icon className={`diag-icon ${severity}`} size={14} aria-hidden="true" />
                  <span>
                    <span className="header-menu-detail">{name}{issue.line > 0 && ` · Line ${issue.line}`}</span>
                    <span className="header-menu-message">{issue.message}</span>
                  </span>
                </button>
              </li>
            )))}
          </ul> : <p className="header-menu-empty">No model issues.</p>}
        </ActionMenu>

        <ActionMenu className="header-menu header-notices" label="Notices" iconOnly
          trigger={<Bell size={16} aria-hidden="true" />}>
          <div className="header-menu-heading"><strong>Notices</strong></div>
          {build && releaseLink ? <ul className="header-menu-list">
            <li><a href={releaseLink} target="_blank" rel="noreferrer">
              <BookOpen size={14} aria-hidden="true" />
              <span>
                <span className="header-menu-detail">SkyView {build.version}</span>
                <span className="header-menu-message">{releaseTag ? 'Release notes' : 'Browse release history'}</span>
              </span>
            </a></li>
          </ul> : <p className="header-menu-empty">Release information unavailable.</p>}
        </ActionMenu>

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
