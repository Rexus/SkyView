import { useCallback, useEffect, useRef, useState, type ReactNode, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import { addViewConnection, addViewElement, viewKeyFor, viewReference } from '../viewSelection'
import { canPlaceElement, type DropPosition } from '../elementDrag'
import { API_BASE } from '../api'
import type { FileResponse } from '../types'
import { boxKey, boxesOf, lockedParent } from '../sharedViews'
import type { SharedView, ViewConfig } from '../sharedViews'
import { autoLayout, moveBox } from '../sharedLayout'
import DiagramCanvas from './DiagramCanvas'
import type { DiagramScene } from '../diagramScene'
import { relativePosition } from '../diagramScene'
import { useSavedDiagram } from '../useSavedDiagram'
import { connectModelPorts, type AddDiagramConnection } from '../diagramConnections'
import SharedSettings from './SharedSettings'
import ActionMenu from './ActionMenu'
import type { Connection } from '@xyflow/react'
import { Wand2 } from 'lucide-react'
import { useModelViews, type ModelViews } from '../modelViews'
import { discardLayouts, layoutDirty, type LayoutDraft } from '../diagramTabs'

export interface CustomViewActions { addElement: (id: string) => void }
interface Props { split?: boolean; initial?: ModelViews; selected?: string; onSelected?: (view: string | null, title?: string, replace?: boolean) => void; onSaved?: (catalog: ModelViews) => void; navigation?: (views?: SharedView[]) => ReactNode; paletteRevision?: string; selectedId?: string | null; onAddElement?: (parent?: string) => void; onOpenAddConnection?: (parent?: string) => void; onAddConnection?: AddDiagramConnection; file: FileResponse; onDirtyChange?: (value: boolean) => void; settingsHost?: HTMLElement | null; onOpenSettings?: () => void; onActions?: (actions: CustomViewActions | null) => void; onSelectElement?: (id: string) => void; onOpenElementDiagram?: (id: string) => void; layoutDraft?: LayoutDraft; onLayoutChange?: (update: (config: ViewConfig) => ViewConfig) => void; onLayoutSaving?: (busy: boolean) => void }
export default function CustomViews({ split, initial, selected: controlled, onSelected, onSaved, navigation, paletteRevision, selectedId, file, onDirtyChange, settingsHost, onOpenSettings, onActions, onSelectElement, onAddElement, onOpenAddConnection, onAddConnection, onOpenElementDiagram, layoutDraft, onLayoutChange, onLayoutSaving }: Props) {
 const [localConfig, setLocalConfig] = useState<ViewConfig | null>(initial?.config ?? null)
 const [localSaved, setLocalSaved] = useState<ViewConfig | null>(initial?.config ?? null)
 const [localEtag, setLocalEtag] = useState(initial?.etag ?? '')
 const config = onLayoutChange ? layoutDraft?.config ?? initial?.config ?? null : localConfig
 const saved = onLayoutChange ? layoutDraft?.base.config ?? initial?.config ?? null : localSaved
 const etag = onLayoutChange ? layoutDraft?.base.etag ?? initial?.etag ?? '' : localEtag
 const setConfig = (next: SetStateAction<ViewConfig | null>) => {
  if (onLayoutChange) onLayoutChange(current => (typeof next === 'function' ? next(current) : next) ?? current)
  else setLocalConfig(next)
 }
 const [localSelection, setLocalSelection] = useState('')
 const selected = controlled ?? localSelection
 const setSelected: NonNullable<Props['onSelected']> = onSelected ?? ((id: string | null) => setLocalSelection(id ?? ''))
 const standalone = useModelViews(initial ? undefined : file.name)
 const [picked, setPicked] = useState<string[]>([])
 const [settings, setSettings] = useState<string | null>(null)
 const [error, setError] = useState('')
 const [svg, setSvg] = useState('')
 const [scene, setScene] = useState<DiagramScene | null>(null)
 const [previewView, setPreviewView] = useState<SharedView | null>(null)
 const [rendered, setRendered] = useState<ViewConfig | null>(null)
 const [saving, setSaving] = useState(false)
 const [scope, setScope] = useState('')
 const upload = useRef<HTMLInputElement>(null)
 const fitAfterPreview = useRef<string | undefined>(undefined)
 const [fitRevision, setFitRevision] = useState(0)
 const base = `${API_BASE}/files/${encodeURIComponent(file.name)}/views`
 const dirty = !!config && JSON.stringify(config) !== JSON.stringify(saved)
 const view = config?.views.find(v => v.id === selected)
 const currentView = useRef(view)
 currentView.current = view
 const connectionPending = useRef(false)
 useEffect(() => { onDirtyChange?.(dirty); return () => onDirtyChange?.(false) }, [dirty, onDirtyChange])
 useEffect(() => {
  const leave = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
  window.addEventListener('beforeunload', leave)
  return () => window.removeEventListener('beforeunload', leave)
 }, [dirty])
 useEffect(() => {
  if (!standalone.data) return
  const { config, etag } = standalone.data
  setLocalConfig(config)
  setLocalSaved(config)
  setLocalEtag(etag)
  const requested = new URLSearchParams(location.search).get('view')
  setLocalSelection(config.views.find(item => item.id === requested)?.id ?? config.views[0]?.id ?? '')
 }, [standalone.data])
 useEffect(() => {
  setPicked([])
  setSettings(null)
  setError('')
 }, [selected])
 useEffect(() => {
  if (!config || !view) return
  const stop = new AbortController(); setRendered(null)
  if (previewView?.id !== selected) setSvg('')
  const timer = setTimeout(() => {
   fetch(`${base}/preview?format=scene&view=${encodeURIComponent(selected)}`, { method: 'POST', signal: stop.signal, headers: { 'Content-Type': 'application/json', 'If-Match': file.revision }, body: JSON.stringify(config) })
    .then(async r => { if (!r.ok) { const d = await r.json(); throw new Error(d.error || 'This layout cannot be rendered.') }; return r.json() })
    .then((drawing: DiagramScene) => {
     if (stop.signal.aborted) return
     setSvg(drawing.svg); setScene(drawing); setPreviewView(view); setError(''); setRendered(config)
     if (fitAfterPreview.current === selected) {
      fitAfterPreview.current = undefined
      setFitRevision(revision => revision + 1)
     }
    })
    .catch(e => { if (!stop.signal.aborted) { setError(e.message); setSvg('') } })
  }, 120)
  return () => { clearTimeout(timer); stop.abort() }
 }, [base, config, selected, file.name, file.revision, paletteRevision, view])
 const change = (next: SharedView) => { setConfig(c => c && ({ ...c, version: 2, views: c.views.map(v => v.id === next.id ? next : v) })); setError('') }
 const openSettings = useCallback((key: string) => { setSettings(key); onOpenSettings?.() }, [onOpenSettings])
 const currentScene = previewView?.id === selected ? scene : null
 const graph = useSavedDiagram(currentScene, previewView ?? undefined, file.model, picked, config !== rendered, openSettings, selectedId, settings)
 const subject = file.model.elements.find(e => e.shortName === view?.subject || e.qname === view?.subject)
 const pick = (key: string, multiple: boolean) => {
  setPicked(previous => multiple ? previous.includes(key) ? previous.filter(k => k !== key) : [...previous, key] : [key])
  if (!multiple && settings !== null) setSettings(key)
  const element = currentScene?.nodes.find(n => n.key === key)?.elementId
  if (element) onSelectElement?.(element)
 }
 const placeElement = (id: string, position?: DropPosition) => {
  const active = currentView.current
  if (!active || connectionPending.current) return
  try {
   const next = addViewElement(active, file.model, id, position)
   const element = file.model.elements.find(e => e.id === id)!
   if (next !== active) change(next)
   setPicked([viewKeyFor(next, file.model, element)])
   onSelectElement?.(id)
  } catch (error) { setError(String(error)) }
 }
 useEffect(() => {
  onActions?.(view ? { addElement: id => placeElement(id) } : null)
  return () => onActions?.(null)
 }, [view, file.model, onActions, onSelectElement])

 const connect = async (params: Connection) => {
  if (!view || !onAddConnection || !currentScene || connectionPending.current) return
  if (config !== rendered) {
   setError('Wait for the preview to update before connecting ports.')
   return
  }
  const from = currentScene.nodes.find(node => node.elementId === params.source)?.key
  const to = currentScene.nodes.find(node => node.elementId === params.target)?.key
  if (!from || !to) return
  connectionPending.current = true
  let created
  try {
   const staged = addViewConnection(view, '', from, to)
   created = await connectModelPorts(file.model, params, onAddConnection)
   const latest = currentView.current
   if (!created || !latest || latest.id !== view.id) return
   const reference = viewReference(file.model, created)
   if (latest === view) {
    staged.edges[staged.edges.length - 1].element = reference
    change(staged)
   } else {
    change(addViewConnection(latest, reference, from, to))
   }
  } catch (error) {
   const message = error instanceof Error ? error.message : String(error)
   setError(created ? 'The connection is saved in SysML. ' + message : message)
  } finally { connectionPending.current = false }
 }
 const arrange = (key?: string) => {
  if (!view) return
  try {
   const next = autoLayout(view, key)
   fitAfterPreview.current = selected
   change(next)
  } catch (error) { setError(String(error)) }
 }
 const save = async () => {
  if (!config || config !== rendered) return
  setSaving(true)
  onLayoutSaving?.(true)
  try {
   const response = await fetch(base, { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': file.revision, ...(etag ? { 'If-View-Match': etag } : {}) }, body: JSON.stringify(config, null, 2) + '\n' })
   if (!response.ok) throw new Error((await response.json()).error)
   const revision = response.headers.get('ETag') ?? ''
   setLocalSaved(config); setLocalEtag(revision); onSaved?.({ config, etag: revision })
  } catch (e) { setError(String(e)) } finally { setSaving(false); onLayoutSaving?.(false) }
 }
 const download = (text: string, name: string, type: string) => { const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
 const boundary = () => {
  if (!view || !picked.length) return
  const next = structuredClone(view), members = boxesOf(next).filter(b => picked.includes(boxKey(b)))
  const parent = members[0]?.parent
  if (members.some(b => b.parent !== parent || lockedParent(next, boxKey(b)))) { setError('Choose elements in the same unlocked boundary.'); return }
  const id = `boundary-${crypto.randomUUID()}`
  next.boundaries ??= []
  next.boundaries.push({ id, label: 'Boundary', kind: 'group', parent, x: 0, y: 0, width: 300, height: 200, layout: { pattern: 'flow' } })
  for (const member of members) member.parent = id
  try { change(autoLayout(next)); setPicked([id]); setSettings(id) } catch (e) { setError(String(e)) }
 }
 const scopes = file.model.elements.filter(e => ['part', 'package'].includes(e.kind) && file.model.elements.some(c => c.parentId === e.id && canPlaceElement(c)))
 const createView = async () => {
  const owner = file.model.elements.find(e => e.id === scope) ?? scopes[0]
  if (!owner) return
  let glyphs: Record<string, import('../diagramScene').SceneNode>
  setSaving(true)
  onLayoutSaving?.(true)
  try {
   const response = await fetch(`${API_BASE}/files/${encodeURIComponent(file.name)}/diagram/nodes`, {headers:{'If-Match':file.revision}})
   if (!response.ok) throw new Error('Could not load native diagram elements.')
   glyphs = await response.json()
  } catch (e) { setError(String(e)); return }
  finally { setSaving(false); onLayoutSaving?.(false) }
  const nodes = file.model.elements.filter(e => e.parentId === owner.id && canPlaceElement(e))
  const key = (id: string) => { const e = file.model.elements.find(e => e.id === id); return e ? viewReference(file.model, e) : '' }
  const ids = new Set(nodes.map(n => n.id))
  const next: SharedView = { id: `view-${crypto.randomUUID()}`, title: `${owner.name} | Design`, owner: '.', subject: owner.shortName || owner.qname, width: 800, height: 600, presentation: true, layout: { pattern: 'flow', gap: nodes.length <= 20 ? 86 : 40 },
   nodes: nodes.map((n, i) => ({ element: key(n.id), x: 40 + i * 240, y: 80, width: glyphs[n.id]?.width || 224, height: glyphs[n.id]?.height || 160 })),
   edges: file.model.elements.filter(e => ['connection', 'flow', 'dependency'].includes(e.kind) && ids.has(e.sourceNodeId || e.sourceId || '') && ids.has(e.targetNodeId || e.targetId || '')).map(e => ({ element: key(e.id), from: key(e.sourceNodeId || e.sourceId!), to: key(e.targetNodeId || e.targetId!), points: [], label: [0, 0] })) }
  try { const laidOut = autoLayout(next); setConfig(c => ({ version: 2, views: [...(c?.views ?? []), laidOut] })); setSelected(next.id, next.title, true); setPicked([]) } catch (e) { setError(String(e)) }
 }
 const settingsPanel = view && settings !== null && <SharedSettings view={view} model={file.model}
  scene={currentScene} target={settings} onChange={change} onArrange={arrange}
  onClose={() => setSettings(null)} onTarget={setSettings} />
 return <section className="shared-views">
  <div className="view-toolbar diagram-toolbar">
   {navigation?.(config?.views)}
   <span className="grow" />
   {view && <>
    <button className="btn btn-sm" onClick={() => arrange()}><Wand2 size={14} /> Auto layout</button>
    <button className="btn btn-sm" onClick={() => openSettings('')}>View settings</button>
    {dirty && <>
     <button className="btn btn-sm btn-primary" disabled={config !== rendered || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save views'}</button>
     {(!onLayoutChange || layoutDirty(layoutDraft, selected)) && <button className="btn btn-sm" disabled={saving} onClick={() => {
      if (!saved) return
      if (onLayoutChange) {
       setConfig(current => current && discardLayouts(current, saved, new Set([selected])))
       if (!saved.views.some(item => item.id === selected)) setSelected(null, undefined, true)
      } else {
       setConfig(saved)
       setSelected(saved.views.some(item => item.id === selected) ? selected : saved.views[0]?.id ?? '')
      }
      setPicked([]); setSettings(null)
     }}>Revert</button>}
    </>}
   </>}
   <ActionMenu label="Diagram actions" iconOnly>
    {view && onAddElement && <button onClick={() => onAddElement(subject?.id)}>Add part</button>}
    {view && onOpenAddConnection && <button onClick={() => onOpenAddConnection(subject?.id)}>Add connection</button>}
    {view && <button disabled={!picked.length} onClick={boundary}>Group selected elements</button>}
    {view && <button disabled={!svg || config !== rendered} onClick={() => download(svg, selected + '.svg', 'image/svg+xml')}>Download SVG</button>}
    {view && <button onClick={() => download(JSON.stringify(config, null, 2) + '\n', file.name.replace(/\.sysml$/, '.views.json'), 'application/json')}>Download view definitions</button>}
    <button onClick={() => upload.current?.click()}>Import view file</button>
   </ActionMenu>
   <input ref={upload} hidden type="file" accept=".json" onChange={async e => { const f = e.target.files?.[0]; if (!f) return; try { const c = JSON.parse(await f.text()) as ViewConfig; if (!Array.isArray(c.views) || !c.views.length) throw new Error('View file must contain selected views.'); setConfig(c); setSelected(c.views[0].id, c.views[0].title); setPicked([]); setSettings(null) } catch (err) { setError(String(err)) }; e.target.value = '' }} />
  </div>
  {config && selected === '' && <div className="shared-create">
   <label htmlFor="new-view-scope">Model scope</label>
   <select id="new-view-scope" className="select" value={scope || scopes[0]?.id || ''} onChange={e => setScope(e.target.value)}>
    {scopes.map(s => <option key={s.id} value={s.id}>{s.qname}</option>)}
   </select>
   <button className="btn btn-primary" disabled={!scopes.length || saving} onClick={createView}>Create view</button>
  </div>}

  {view && config !== rendered && !error && <p className="shared-render-status" role="status">Updating preview…</p>}
  {error && <p role="alert" className="shared-error">{error}</p>}
  <div className="shared-workbench">
   {view && scene && previewView?.id === selected && <DiagramCanvas elementDrop={{ file: file.name, place: placeElement }} split={split} key={selected} frameTitle={previewView.title} fitRevision={fitRevision} nodes={graph.nodes} edges={graph.edges} onNodesChange={graph.onNodesChange} onEdgesChange={graph.onEdgesChange}
    onNodeClick={(event, node) => pick(String(node.data.viewKey), event.shiftKey || event.ctrlKey || event.metaKey)}
    onNodeDoubleClick={(event, node) => {
     if (node.type !== 'sysml' || (event.target as Element).closest('button, .react-flow__handle')) return
     onOpenElementDiagram?.(node.id)
    }}
    onEdgeClick={(_, edge) => onSelectElement?.(edge.id)}
    onNodeDragStop={(_, node) => {
     const original = scene.nodes.find(n => n.key === node.data.viewKey)
     if (!original) return
     const position = relativePosition(original, scene)
     try { change(moveBox(view, original.key, node.position.x - position.x, node.position.y - position.y)) } catch (e) { setError(String(e)) }
    }}
    onConnect={params => void connect(params)}
   />}
   {settingsPanel && (settingsHost ? createPortal(settingsPanel, settingsHost) : settingsPanel)}
  </div>
  {!view && selected && !error && <p className="shared-error" role="alert">This saved view is unavailable. Choose a different diagram view.</p>}
  {standalone.error && <p className="shared-error" role="alert">{standalone.error}</p>}
 </section>
}
