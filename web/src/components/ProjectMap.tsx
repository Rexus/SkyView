import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, ChevronRight, FileCode2, Folder, Network, PanelsTopLeft } from 'lucide-react'
import { getFile } from '../api'
import { useModelViews, type ModelViews } from '../modelViews'
import type { FileInfo, FileResponse, SysmlModel } from '../types'
import { displayName } from '../utils'
import { layoutDirty, type LayoutDraft } from '../diagramTabs'
import UnsavedDot from './UnsavedDot'

export type OpenModel = (file: string, view?: string | null, element?: string, newTab?: boolean) => void
type ProjectDiagram = { file: string; view?: string; element?: string }
type ProjectMenu = ProjectDiagram & { x: number; y: number; trigger: HTMLButtonElement }

function tabActions(target: ProjectDiagram, onMenu: (menu: ProjectMenu) => void) {
  return {
    onContextMenu(event: MouseEvent<HTMLButtonElement>) {
      event.preventDefault()
      onMenu({ ...target, x: event.clientX, y: event.clientY, trigger: event.currentTarget })
    },
    onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
      if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
      event.preventDefault()
      const bounds = event.currentTarget.getBoundingClientRect()
      onMenu({ ...target, x: bounds.left, y: bounds.bottom, trigger: event.currentTarget })
    },
  }
}

function ModelEntry({ name, path, active, view, views, viewError, draft, sourceDirty, onOpen, onMenu }: {
  name: string
  path: string
  active?: FileResponse
  view: string | null
  views?: ModelViews
  viewError?: string
  draft?: LayoutDraft
  sourceDirty: boolean
  onOpen: OpenModel
  onMenu: (menu: ProjectMenu) => void
}) {
  const [open, setOpen] = useState(Boolean(active))
  const [summary, setSummary] = useState<FileResponse>()
  const [error, setError] = useState('')
  useEffect(() => {
    if (active) setOpen(true)
  }, [Boolean(active)])
  useEffect(() => {
    if (!open || active || summary) return
    let current = true
    getFile(path).then(model => { if (current) setSummary(model) })
      .catch(() => { if (current) setError('Packages could not be loaded.') })
    return () => { current = false }
  }, [open, active, summary, path])
  const nestedViews = useModelViews(open && !active ? path : undefined)
  const catalog = active ? views : nestedViews.data
  const catalogError = active ? viewError : nestedViews.error
  const availableViews = draft?.config.views ?? catalog?.config.views
  const model = (active ?? summary)?.model
  return <div className="project-model">
    <div className="model-tree-line">
      <button type="button" className="tree-toggle" aria-label={(open ? 'Collapse ' : 'Expand ') + name}
        aria-expanded={open} onClick={() => setOpen(value => !value)}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      <button type="button" className="project-file explorer-row" title={path}
        data-active={Boolean(active)} onClick={() => { setOpen(true); onOpen(path) }} {...tabActions({ file: path }, onMenu)}>
        <FileCode2 size={15} /><span>{name}</span>
        {(sourceDirty || draft) && <UnsavedDot label={sourceDirty && draft ? 'Unsaved source and views'
          : sourceDirty ? 'Unsaved source edits' : 'Unsaved views'} />}
      </button>
    </div>
    {open && <div className="project-tree-level">
      <details open>
        <summary className="explorer-row"><PanelsTopLeft size={14} /> Views
          {draft && <UnsavedDot label="Unsaved views" />}
        </summary>
        <div className="project-tree-level">
          <button type="button" className="explorer-row" onClick={() => onOpen(path)} {...tabActions({ file: path }, onMenu)}
            aria-current={active && view === null ? 'page' : undefined}><Network size={14} /><span>Model diagram</span></button>
          {availableViews?.map(item => <button type="button" className="explorer-row" key={item.id}
            title={item.owner === '.' ? item.title : item.owner + ' / ' + item.title}
            aria-current={active && view === item.id ? 'page' : undefined}
            onClick={() => onOpen(path, item.id)} {...tabActions({ file: path, view: item.id }, onMenu)}>
            <PanelsTopLeft size={14} /><span>{item.title}</span>
            {layoutDirty(draft, item.id) && <UnsavedDot label="Unsaved view" />}
          </button>)}
          {catalogError && <p className="explorer-message" role="status">{catalogError}</p>}
          {!availableViews && !catalogError && <p className="explorer-message">Loading saved views…</p>}
        </div>
      </details>
      {model && <Packages model={model} file={path} onPick={id => onOpen(path, null, id)} onMenu={onMenu} />}
      {error && !model && <p className="explorer-message" role="status">{error}</p>}
    </div>}
  </div>
}

function Packages({ model, file, onPick, onMenu }: {
  model: SysmlModel
  file: string
  onPick: (id: string) => void
  onMenu: (menu: ProjectMenu) => void
}) {
  const map = new Map<string, typeof model.elements>()
  for (const element of model.elements) {
    if (element.kind !== 'package') continue
    const parent = element.parentId ?? model.rootId
    const children = map.get(parent)
    if (children) children.push(element)
    else map.set(parent, [element])
  }
  function rows(parent: string): ReactNode[] | undefined {
    return map.get(parent)?.map(element => {
      const children = rows(element.id)
      const pick = <button type="button" key={element.id} className="explorer-row" title={element.qname}
        onClick={() => onPick(element.id)} {...tabActions({ file, element: element.id }, onMenu)}><Folder size={14} /><span>{displayName(element)}</span></button>
      return children?.length ? <details key={element.id}>
        <summary className="explorer-row" title={element.qname}>{displayName(element)}</summary>
        <div className="project-tree-level">{pick}{children}</div>
      </details> : pick
    })
  }
  const packages = rows(model.rootId)
  return packages?.length ? <details open>
    <summary className="explorer-row"><Folder size={14} /> Packages</summary>
    <div className="project-tree-level">{packages}</div>
  </details> : null
}

export default function ProjectMap({ files, file, view, views, viewError, layoutDrafts, sourceDirtyFile, onOpen, actions }: {
  files: FileInfo[]
  file: FileResponse | null
  view: string | null
  views?: ModelViews
  viewError?: string
  layoutDrafts?: Record<string, LayoutDraft>
  sourceDirtyFile?: string
  onOpen: OpenModel
  actions?: ReactNode
}) {
  const [menu, setMenu] = useState<ProjectMenu | null>(null)
  const changedFiles = Object.keys(layoutDrafts ?? {})
  if (sourceDirtyFile) changedFiles.push(sourceDirtyFile)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    menuRef.current?.querySelector('button')?.focus()
    const outside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenu(null)
    }
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setMenu(null)
      menu.trigger.focus()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [menu])
  function rowsAt(prefix: string) {
    const names = files.filter(item => item.name.startsWith(prefix)).map(item => item.name.slice(prefix.length))
    const directories = [...new Set(names.filter(name => name.includes('/')).map(name => name.split('/')[0]))].sort()
    return <>
      {directories.map(name => <details key={name} open>
        <summary className="explorer-row"><Folder size={15} /> {name}
          {changedFiles.some(path => path.startsWith(prefix + name + '/')) && <UnsavedDot label="Contains unsaved changes" />}
        </summary>
        <div className="project-tree-level">{rowsAt(prefix + name + '/')}</div>
      </details>)}
      {names.filter(name => !name.includes('/')).sort().map(name => {
        const path = prefix + name
        return <ModelEntry key={path} name={name} path={path} active={file?.name === path ? file : undefined}
          view={view} views={views} viewError={viewError} draft={layoutDrafts?.[path]}
          sourceDirty={sourceDirtyFile === path} onOpen={onOpen} onMenu={setMenu} />
      })}
    </>
  }
  return <section className="project-tree" aria-label="Project map">
    <div className="project-tree-heading"><h3 className="pane-heading">Project map</h3>{actions}</div>
    {files.length ? rowsAt('') : <p className="explorer-message">No models in this project.</p>}
    {menu && createPortal(<div ref={menuRef} className="diagram-tab-menu project-tab-menu" role="menu" aria-label="Project diagram actions"
      style={{ left: Math.max(4, Math.min(menu.x, window.innerWidth - 168)), top: Math.max(4, Math.min(menu.y, window.innerHeight - 45)) }}>
      <button type="button" role="menuitem" onClick={() => {
        setMenu(null)
        onOpen(menu.file, menu.view ?? null, menu.element, true)
      }}>Open in new tab</button>
    </div>, document.body)}
  </section>
}
