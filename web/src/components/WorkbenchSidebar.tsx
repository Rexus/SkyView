import { useState, type ReactNode } from 'react'
import { ArrowRight, Box, FolderOpen, Layers, Settings2 } from 'lucide-react'
import type { FileInfo, FileResponse } from '../types'
import type { ModelViews } from '../modelViews'
import type { LayoutDraft } from '../diagramTabs'
import type { CustomViewActions } from './CustomViews'
import { displayName } from '../utils'
import ActionMenu from './ActionMenu'
import ProjectMap, { type OpenModel } from './ProjectMap'
import Sidebar from './Sidebar'
import { canPlaceElement } from '../elementDrag'

export type NavigatorPanel = 'projects' | 'elements' | 'settings'
export type SettingsPage = 'colours' | 'layout'
interface Props {
  hidden?: boolean
  canDragElements?: boolean
  panel: NavigatorPanel
  onPanel: (panel: NavigatorPanel) => void
  files: FileInfo[]
  file: FileResponse | null
  view: string | null
  catalog?: ModelViews
  catalogError?: string
  layoutDrafts?: Record<string, LayoutDraft>
  selectedId: string | null
  onSelect: (id: string) => void
  onOpenFile: OpenModel
  settingsHost: (host: HTMLDivElement | null) => void
  settingsPage: SettingsPage
  onSettingsPage: (page: SettingsPage) => void
  actions: CustomViewActions | null
  projectBar: ReactNode
  modelActions?: ReactNode
  inspector: ReactNode
  colourSettings?: ReactNode
}

const panels = [
  ['projects', 'Projects', FolderOpen], ['elements', 'Elements', Layers],
  ['settings', 'Settings', Settings2],
] as const

export default function WorkbenchSidebar({
  hidden, canDragElements, panel, onPanel, files, file, view, catalog, catalogError, layoutDrafts, selectedId, onSelect, onOpenFile,
  settingsHost, settingsPage, onSettingsPage, actions, projectBar, modelActions, inspector, colourSettings,
}: Props) {
  const [partsOnly, setPartsOnly] = useState(false)
  const selected = file?.model.elements.find(e => e.id === selectedId)
  const openElements = panel === 'elements'
  return <aside id="workbench-sidebar" className="workbench-sidebar" aria-label="Model navigator" hidden={hidden}>
    <nav className="workbench-tabs" aria-label="Navigation panels">
      {panels.map(([name, title, Icon]) => <button type="button" key={name} aria-pressed={panel === name}
        aria-label={name === 'elements' ? 'Model elements' : title} onClick={() => onPanel(name)}>
        <Icon size={14} aria-hidden="true" /><span>{title}</span>
      </button>)}
    </nav>
    <div className="workbench-panel projects-panel" hidden={panel !== 'projects'}>
      {projectBar}
      <ProjectMap files={files} file={file} view={view} actions={modelActions} views={catalog} viewError={catalogError} layoutDrafts={layoutDrafts} onOpen={onOpenFile} />
    </div>
    <div className="workbench-panel elements-panel" hidden={!openElements}>
      <Sidebar canDrag={canDragElements} model={file?.model ?? null} fileKey={file?.name ?? ''} selectedId={selectedId}
        onSelect={onSelect} partsOnly={partsOnly} controls={
          <ActionMenu label="Element actions" iconOnly>
            <button type="button" aria-pressed={partsOnly} onClick={() => setPartsOnly(value => !value)}>
              {partsOnly ? 'Show all elements' : 'Show parts and items'}
            </button>
            <button disabled={!actions || !selected || !canPlaceElement(selected)}
              onClick={() => selected && actions?.addElement(selected.id)}><Box size={14} /> Add selected to view</button>
          </ActionMenu>
        } />
      {openElements && file && <Relationships model={file.model} onSelect={onSelect} />}
    </div>
    <div className="workbench-panel settings-panel" hidden={panel !== 'settings'}>
      <div className="pane-switch" role="group" aria-label="Settings pages">
        <button type="button" aria-pressed={settingsPage === 'colours'} onClick={() => onSettingsPage('colours')}>Language colours</button>
        <button type="button" aria-pressed={settingsPage === 'layout'} onClick={() => onSettingsPage('layout')}>View layout</button>
      </div>
      <div hidden={settingsPage !== 'colours'}>{colourSettings}</div>
      <div hidden={settingsPage !== 'layout'}><div className="layout-settings-host" ref={settingsHost} />
        <p className="explorer-message layout-empty">Open a saved diagram’s View settings to edit its layout.</p>
      </div>
    </div>
    {panel !== 'settings' && <section className={'element-properties' + (inspector ? ' has-selection' : '')}
      aria-label="Element properties">{inspector || <p className="explorer-message">Select an element to see its properties.</p>}</section>}
  </aside>
}

function Relationships({ model, onSelect }: { model: FileResponse['model']; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const relationships = model.elements.filter(e => ['dependency', 'connection', 'flow'].includes(e.kind))
  const byId = new Map(model.elements.map(e => [e.id, e]))
  if (!relationships.length && !model.imports?.length) return null
  return <details className="model-links" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Relationships and imports</summary>
    {open && <div className="model-links-content">
      {relationships.map(relation => {
        const from = byId.get(relation.sourceNodeId || relation.sourceId || '')
        const to = byId.get(relation.targetNodeId || relation.targetId || '')
        return <div className="model-link" key={relation.id}>
          <small>{relation.kind} · {displayName(relation)}</small>
          <div>
            <button disabled={!from} onClick={() => from && onSelect(from.id)}>{from ? displayName(from) : relation.source || 'Unresolved source'}</button>
            {from && to ? <ArrowRight size={13} aria-label="to" /> : <span className="dim">unresolved</span>}
            <button disabled={!to} onClick={() => to && onSelect(to.id)}>{to ? displayName(to) : relation.target || 'Unresolved target'}</button>
          </div>
        </div>
      })}
      {model.imports?.map((name, index) => <div className="model-import" key={index}>{name}</div>)}
    </div>}
  </details>
}
