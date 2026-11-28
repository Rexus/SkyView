import type { ReactNode } from 'react'
import { Network, Plus } from 'lucide-react'
import type { FileResponse } from '../types'
import type { ModelViews } from '../modelViews'
import type { SharedView, ViewConfig } from '../sharedViews'
import { layoutDirty, type LayoutDraft } from '../diagramTabs'
import CustomViews, { type CustomViewActions } from './CustomViews'
import type { AddDiagramConnection } from '../diagramConnections'

interface Props {
  file: FileResponse
  split?: boolean
  view: string | null
  catalog?: ModelViews
  catalogError?: string
  onOpen: (view: string | null) => void
  onSelected: (view: string | null, title?: string, replace?: boolean) => void
  onSaved: (catalog: ModelViews) => void
  paletteRevision?: string
  settingsHost?: HTMLElement | null
  onOpenSettings?: () => void
  onActions?: (actions: CustomViewActions | null) => void
  selectedId?: string | null
  onSelectElement?: (id: string) => void
  onAddElement?: (parent?: string) => void
  onOpenAddConnection?: (parent?: string) => void
  onAddConnection?: AddDiagramConnection
  children: (navigation: ReactNode) => ReactNode
  onDirtyChange?: (dirty: boolean) => void
  layoutDraft?: LayoutDraft
  onLayoutChange?: (update: (config: ViewConfig) => ViewConfig) => void
  onLayoutSaving?: (busy: boolean) => void
  onOpenElementDiagram?: (id: string) => void
  tabs?: ReactNode
  empty?: boolean
}

export default function DiagramWorkspace({ file, view, catalog, catalogError, onOpen, onSelected, onSaved, children, tabs, empty, ...tools }: Props) {
  const picker = (choices: SharedView[] = tools.layoutDraft?.config.views ?? catalog?.config.views ?? []) => <div className="diagram-picker">
    <Network size={15} aria-hidden="true" />
    <select className="select input-sm" aria-label="Diagram view" value={empty ? 'closed' : view === null ? 'model' : 'view:' + view}
      onChange={event => onOpen(event.target.value === 'model' ? null : event.target.value.slice(5))}>
      {empty && <option value="closed" disabled>Choose a diagram</option>}
      <option value="model">Model diagram</option>
      {view === '' && <option value="view:">New saved view</option>}
      {view && !choices.some(item => item.id === view) && <option value={'view:' + view}>Saved view</option>}
      {!!choices.length && <optgroup label="Saved views">
        {choices.map(item => <option key={item.id} value={'view:' + item.id}>{item.title}{layoutDirty(tools.layoutDraft, item.id) ? ' · Unsaved' : ''}</option>)}
      </optgroup>}
    </select>
    <button className="icon-button tooltip" type="button" disabled={!catalog} onClick={() => onOpen('')}
      aria-label="New saved view" data-tip="New saved view"><Plus size={15} /></button>
  </div>
  return <section className="diagram-workspace" aria-label="Diagram workspace">
    {tabs}
    {empty ? <div className="view-toolbar diagram-toolbar">{picker()}</div> : view === null ? children(picker()) : catalog ? (
      <CustomViews {...tools} file={file} initial={catalog} selected={view} onSelected={onSelected}
        onSaved={onSaved} navigation={picker} />
    ) : <>
      <div className="view-toolbar diagram-toolbar">{picker()}</div>
      <p className="shared-render-status" role={catalogError ? 'alert' : 'status'}>{catalogError ?? 'Loading saved views…'}</p>
    </>}
  </section>
}
