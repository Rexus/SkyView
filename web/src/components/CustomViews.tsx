import { useCallback, useEffect, useRef, useState, type ReactNode, type SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import { addViewConnection, addViewElement, viewKeyFor, viewReference } from '../viewSelection'
import { canPlaceElement, type DropPosition } from '../elementDrag'
import { API_BASE } from '../api'
import type { FileResponse } from '../types'
import { boxKey, boxesOf, descendants, interiorLocked, lockedParent } from '../sharedViews'
import type { Point, SharedView, ViewConfig } from '../sharedViews'
import { canEditSavedConnector, editSavedConnector, moveSavedLabel } from '../savedDiagramRouting'
import { autoLayout, moveBox } from '../sharedLayout'
import DiagramCanvas from './DiagramCanvas'
import type { DiagramScene } from '../diagramScene'
import { relativePosition, sceneNodeId } from '../diagramScene'
import { useSavedDiagram } from '../useSavedDiagram'
import { connectModelPorts, type AddDiagramConnection } from '../diagramConnections'
import SharedSettings from './SharedSettings'
import DiagramToolbar from './DiagramToolbar'
import type { Connection, Node } from '@xyflow/react'
import { Loader2, RotateCcw, Save } from 'lucide-react'
import { useModelViews, type ModelViews } from '../modelViews'
import { discardLayouts, type LayoutDraft } from '../diagramTabs'

import { emptyMoves, sameLayout, stepMoves, type HistoryStep, type LayoutMove, type ViewHistories } from '../layoutMoveHistory'

export interface CustomViewActions {
 addElement: (id: string) => void
 undoMove?: () => Promise<void>
 redoMove?: () => Promise<void>
 moveHistoryBusy?: boolean
}

function replaceView(config: ViewConfig, view: SharedView): ViewConfig {
 return { ...config, version: 2, views: config.views.some(item => item.id === view.id)
  ? config.views.map(item => item.id === view.id ? view : item)
  : [...config.views, view] }
}

interface Props { split?: boolean; historyControls?: ReactNode; initial?: ModelViews; selected?: string; onSelected?: (view: string | null, title?: string, replace?: boolean) => void; onSaved?: (catalog: ModelViews) => void; navigation?: (views?: SharedView[]) => ReactNode; paletteRevision?: string; selectedId?: string | null; onAddElement?: (parent?: string) => void; onOpenAddConnection?: (parent?: string) => void; onAddConnection?: AddDiagramConnection; file: FileResponse; onDirtyChange?: (value: boolean) => void; settingsHost?: HTMLElement | null; layoutSettingsVisible?: boolean; onOpenSettings?: () => void; onActions?: (actions: CustomViewActions | null) => void; onSelectElement?: (id: string | null) => void; onOpenElementDiagram?: (id: string) => void; layoutDraft?: LayoutDraft; moveHistory?: ViewHistories; onMoveHistoryChange?: (update: (history: ViewHistories) => ViewHistories) => void; onLayoutChange?: (update: (config: ViewConfig) => ViewConfig) => void; onLayoutSaving?: (busy: boolean) => void }
export default function CustomViews({ split, historyControls, initial, selected: controlled, onSelected, onSaved, navigation, paletteRevision, selectedId, file, onDirtyChange, settingsHost, layoutSettingsVisible, onOpenSettings, onActions, onSelectElement, onAddElement, onOpenAddConnection, onAddConnection, onOpenElementDiagram, layoutDraft, moveHistory: sharedHistory, onMoveHistoryChange, onLayoutChange, onLayoutSaving }: Props) {
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
 const [inlineSettings, setInlineSettings] = useState(false)
 const [targetOverride, setTargetOverride] = useState<{ key: string; selection: typeof selectedId }>()
 const [error, setError] = useState('')
 const [svg, setSvg] = useState('')
 const [scene, setScene] = useState<DiagramScene | null>(null)
 const [previewView, setPreviewView] = useState<SharedView | null>(null)
 const [rendered, setRendered] = useState<ViewConfig | null>(null)
 const [saving, setSaving] = useState(false)
 const savingNow = useRef(false)
 const [localHistory, setLocalHistory] = useState<ViewHistories>({})
 const moveHistory = sharedHistory ?? localHistory
 const setMoveHistory = onMoveHistoryChange ?? setLocalHistory
 const replayMove = useRef<(step: 'undo' | 'redo') => Promise<void>>(async () => {})
 const [scope, setScope] = useState('')
 const upload = useRef<HTMLInputElement>(null)
 const fitAfterPreview = useRef<string | undefined>(undefined)
 const [fitRevision, setFitRevision] = useState(0)
 const base = `${API_BASE}/files/${encodeURIComponent(file.name)}/views`
 const dirty = !!config && JSON.stringify(config) !== JSON.stringify(saved)
 const view = config?.views.find(v => v.id === selected)
 const savedView = saved?.views.find(v => v.id === selected)
 const canReset = !!view && !!savedView && !sameLayout(view, savedView)
 const currentView = useRef(view)
 currentView.current = view
 const connectionPending = useRef(false)
 const toggleLockAction = useRef<(key: string) => void>(() => {})
 const toggleLock = useCallback((key: string) => toggleLockAction.current(key), [])
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
  setTargetOverride(undefined)
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
 const applyView = (next: SharedView, refit = false) => {
  if (refit) fitAfterPreview.current = next.id
  setConfig(current => current && (saved && sameLayout(next, savedView)
   ? discardLayouts(current, saved, new Set([next.id]))
   : replaceView(current, next)))
  setError('')
 }
 const change = (next: SharedView, refit = false) => {
  if (!view || currentView.current !== view || savingNow.current || connectionPending.current ||
      sameLayout(next, view)) return
  applyView(next, refit)
  rememberMove({ before: view, after: next, refit }, 'record')
 }
 toggleLockAction.current = key => {
  if (!view) return
  const next = structuredClone(view)
  const box = boxesOf(next).find(candidate => boxKey(candidate) === key)
  if (!box) return
  const layout = { ...box.layout }
  if (interiorLocked(layout)) { delete layout.positionLocked; delete layout.locked }
  else layout.positionLocked = true
  if (Object.keys(layout).length) box.layout = layout
  else delete box.layout
  next.presentation = true
  change(next)
 }
 const openSettings = () => { setInlineSettings(true); onOpenSettings?.() }
 const currentScene = previewView?.id === selected ? scene : null
 useEffect(() => {
  if (selectedId !== null || !currentScene) return
  setPicked(previous => {
   const annotations = previous.filter(key => currentScene.nodes.some(node => node.key === key && node.annotation))
   return annotations.length === previous.length ? previous : annotations
  })
 }, [currentScene, selectedId])
 const selectedTarget = selectedId ? currentScene?.nodes.find(node => node.elementId === selectedId)?.key : picked.at(-1)
 const target = targetOverride && targetOverride.selection === selectedId ? targetOverride.key : selectedTarget
 const settingsTarget = target && view && boxesOf(view).some(box => boxKey(box) === target) ? target : ''
 const chooseSettingsTarget = (key: string) => setTargetOverride({ key, selection: selectedId })
 const graph = useSavedDiagram(currentScene, previewView ?? undefined, file.model, picked, saving || config !== rendered,
  toggleLock, selectedId, layoutSettingsVisible || (!settingsHost && inlineSettings) ? settingsTarget : undefined, view)
 const subject = file.model.elements.find(e => e.shortName === view?.subject || e.qname === view?.subject)
 const pick = (key: string, multiple: boolean) => {
  const next = multiple ? picked.includes(key) ? picked.filter(k => k !== key) : [...picked, key] : [key]
  setPicked(next)
  setTargetOverride(undefined)
  const nativeElement = (value: string) => currentScene?.nodes.find(node => node.key === value)?.elementId
  const primary = next.includes(key) ? nativeElement(key) : undefined
  onSelectElement?.(primary ?? next.map(nativeElement).filter(Boolean).at(-1) ?? null)
 }
 const selectDiagramElement = (id: string | null) => {
  setPicked([])
  setTargetOverride(undefined)
  onSelectElement?.(id)
 }
 const placeElement = (id: string, position?: DropPosition) => {
  const active = currentView.current
  if (!active || connectionPending.current || savingNow.current) return
  try {
   const next = addViewElement(active, file.model, id, position)
   const element = file.model.elements.find(e => e.id === id)!
   if (next !== active) change(next)
   setPicked([viewKeyFor(next, file.model, element)])
   setTargetOverride(undefined)
   onSelectElement?.(id)
  } catch (error) { setError(String(error)) }
 }
 const latestMove = moveHistory[selected]?.undo.at(-1)
 const nextMove = moveHistory[selected]?.redo.at(-1)
 const moveHistoryBusy = saving
 useEffect(() => {
  onActions?.(view ? { addElement: id => placeElement(id), moveHistoryBusy,
   undoMove: latestMove ? () => replayMove.current('undo') : undefined,
   redoMove: nextMove ? () => replayMove.current('redo') : undefined } : null)
  return () => onActions?.(null)
 }, [view, file.model, onActions, onSelectElement, latestMove, nextMove, moveHistoryBusy])

 const connect = async (params: Connection) => {
  if (!view || !onAddConnection || !currentScene || connectionPending.current || savingNow.current) return
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
   connectionPending.current = false
   if (latest === view) {
    staged.edges[staged.edges.length - 1].element = reference
    applyView(staged)
    rememberMove({ before: latest, after: staged, refit: false }, 'record')
   } else {
    const next = addViewConnection(latest, reference, from, to)
    applyView(next)
    rememberMove({ before: latest, after: next, refit: false }, 'record')
   }
  } catch (error) {
   const message = error instanceof Error ? error.message : String(error)
   setError(created ? 'The connection is saved in SysML. ' + message : message)
  } finally { connectionPending.current = false }
 }
 const arrange = (key?: string) => {
  if (!view || savingNow.current || connectionPending.current) return
  try {
   const labels = currentScene && new Map(currentScene.edges.map(edge => [edge.key, edge.label]))
   const next = autoLayout(view, key, labels ?? undefined)
   if (JSON.stringify(next) === JSON.stringify(view)) {
    if (config === rendered) setFitRevision(revision => revision + 1)
    else fitAfterPreview.current = selected
   } else change(next, true)
  } catch (error) { setError(String(error)) }
 }
 const writeViews = async (next: ViewConfig): Promise<ModelViews> => {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'If-Match': file.revision }
  if (etag) headers['If-View-Match'] = etag
  else headers['If-None-Match'] = '*'
  const response = await fetch(base, { method: 'PUT', headers, body: JSON.stringify(next, null, 2) + '\n' })
  if (!response.ok) throw new Error((await response.json()).error)
  return { config: next, etag: response.headers.get('ETag') ?? '' }
 }
 const acceptSave = (catalog: ModelViews) => {
  if (!onLayoutChange) {
   setLocalConfig(catalog.config); setLocalSaved(catalog.config); setLocalEtag(catalog.etag)
  }
  onSaved?.(catalog)
 }
 const markSaving = (pending: boolean) => {
  savingNow.current = pending
  setSaving(pending)
  onLayoutSaving?.(pending)
 }
 const save = async () => {
  if (!dirty || !config || config !== rendered || savingNow.current || connectionPending.current) return
  markSaving(true)
  try {
   acceptSave(await writeViews(config))
   setError('')
  }
  catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  finally { markSaving(false) }
 }
 const rememberMove = (entry: LayoutMove, step: HistoryStep) => {
  setMoveHistory(history => ({ ...history, [selected]: stepMoves(history[selected] ?? emptyMoves, entry, step) }))
 }
 replayMove.current = async step => {
  const entry = step === 'undo' ? latestMove : nextMove
  if (!entry || !view || savingNow.current || connectionPending.current) return
  const from = step === 'undo' ? entry.after : entry.before
  const next = step === 'undo' ? entry.before : entry.after
  if (!sameLayout(view, from)) {
   setError('This view has changed since that edit.')
   return
  }
  applyView(next, entry.refit)
  rememberMove(entry, step)
 }
 const rerouteConnector = (id: string, points: Point[]) => {
  if (!view || !currentScene || config !== rendered || savingNow.current || connectionPending.current) return
  const edge = currentScene.edges.find(candidate => candidate.elementId === id)
  const index = view.edges.findIndex(candidate => candidate.element === edge?.key)
  if (index < 0) return
  try {
   const next = editSavedConnector(view, view.edges[index].element, points, new Map(currentScene.edges.map(item => [item.key, item.label])))
   change(next)
  } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
 }
 const moveConnectorLabel = (id: string, position: Point) => {
  if (!view || config !== rendered || savingNow.current || connectionPending.current) return
  const edge = currentScene?.edges.find(candidate => candidate.elementId === id)
  if (edge) change(moveSavedLabel(view, edge.key, position, edge.label))
 }
 const finishDrag = (node: Node, dragged: Node[]) => {
  if (!currentScene) return
  const original = currentScene.nodes.find(item => item.key === node.data.viewKey)
  if (!original) return
  const position = relativePosition(original, currentScene)
  const reset = (nodes: Node[]) => graph.onNodesChange(nodes.flatMap(draggedNode => {
   const before = currentScene.nodes.find(item => item.key === draggedNode.data.viewKey)
   return before ? [{ id: sceneNodeId(before), type: 'position', position: relativePosition(before, currentScene), dragging: false }] : []
  }))
  reset(dragged.filter(item => item.id !== node.id))
  try {
   if (view && config === rendered && !savingNow.current && !connectionPending.current) {
    const dx = Math.round(node.position.x - position.x), dy = Math.round(node.position.y - position.y)
    const after = moveBox(view, original.key, dx, dy)
    if (after !== view) { change(after); return }
   }
  } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
  reset([node])
 }
 const resetToSaved = () => {
  if (!savedView || !canReset || savingNow.current || connectionPending.current) return
  change(savedView, true)
  setPicked([])
  setTargetOverride(undefined)
 }
 const discardNewView = () => {
  if (!view || !saved || savedView || savingNow.current || connectionPending.current) return
  setConfig(current => current && discardLayouts(current, saved, new Set([selected])))
  setMoveHistory(({ [selected]: removed, ...remaining }) => remaining)
  setSelected(onLayoutChange ? null : saved.views[0]?.id ?? '', undefined, true)
 }
 const download = (text: string, name: string, type: string) => { const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }
 const boundary = () => {
  if (!view || !picked.length || savingNow.current) return
  const next = structuredClone(view), members = boxesOf(next).filter(b => picked.includes(boxKey(b)))
  const parent = members[0]?.parent
  if (members.some(b => b.parent !== parent || b.layout?.positionLocked || lockedParent(next, boxKey(b)))) {
   setError('Choose elements with unlocked placement in the same group.'); return
  }
  const id = `boundary-${crypto.randomUUID()}`
  next.boundaries ??= []
  next.boundaries.push({ id, label: 'Boundary', kind: 'group', parent, x: 0, y: 0, width: 300, height: 200, layout: { pattern: 'flow' } })
  for (const member of members) member.parent = id
  try { change(autoLayout(next)); setPicked([id]); chooseSettingsTarget(id) } catch (e) { setError(String(e)) }
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
  const next: SharedView = { id: `view-${crypto.randomUUID()}`, title: `${owner.name} | Design`, owner: '.', subject: owner.shortName || owner.qname, width: 800, height: 600, presentation: true, layout: { pattern: 'flow', gap: 54 },
   nodes: nodes.map((n, i) => ({ element: key(n.id), x: 40 + i * 240, y: 80, width: glyphs[n.id]?.width || 224, height: glyphs[n.id]?.height || 160 })),
   edges: file.model.elements.filter(e => ['connection', 'flow', 'dependency'].includes(e.kind) && ids.has(e.sourceNodeId || e.sourceId || '') && ids.has(e.targetNodeId || e.targetId || '')).map(e => ({ element: key(e.id), from: key(e.sourceNodeId || e.sourceId!), to: key(e.targetNodeId || e.targetId!), points: [], label: [0, 0] })) }
  try { const laidOut = autoLayout(next); setConfig(c => ({ version: 2, views: [...(c?.views ?? []), laidOut] })); setSelected(next.id, next.title, true); setPicked([]) } catch (e) { setError(String(e)) }
 }
 const settingsPanel = view && (settingsHost || inlineSettings) && <SharedSettings view={view} model={file.model}
  scene={currentScene} target={settingsTarget} onChange={change} onArrange={arrange}
  onClose={settingsHost ? undefined : () => setInlineSettings(false)} onTarget={chooseSettingsTarget} />
 return <section className="shared-views">
  <DiagramToolbar navigation={navigation?.(config?.views)} historyControls={historyControls} onAutoLayout={view ? () => arrange() : undefined}
   resetControl={view && <button type="button" className="icon-button tooltip" aria-label="Reset to last save"
    data-tip="Reset to last save" disabled={!canReset || saving} onClick={resetToSaved}><RotateCcw size={15} /></button>}
   saveControl={view && <button type="button" className={'icon-button tooltip' + (dirty || saving ? ' active' : '')} aria-label="Save views"
    data-tip={saving ? 'Saving…' : 'Save views'} aria-busy={saving} disabled={!dirty || config !== rendered || saving}
    onClick={() => void save()}>{saving ? <Loader2 className="spin" size={15} /> : <Save size={15} />}</button>}>
    {view && <button onClick={openSettings}>Layout properties</button>}
    {view && onAddElement && <button onClick={() => onAddElement(subject?.id)}>Add part</button>}
    {view && onOpenAddConnection && <button onClick={() => onOpenAddConnection(subject?.id)}>Add connection</button>}
    {view && <button disabled={!picked.length || saving} onClick={boundary}>Group selected elements</button>}
    {view && !historyControls && <button disabled={!latestMove || moveHistoryBusy} onClick={() => void replayMove.current('undo')}>Undo last move</button>}
    {view && !historyControls && <button disabled={!nextMove || moveHistoryBusy} onClick={() => void replayMove.current('redo')}>Redo last move</button>}
    {view && <button disabled={!svg || config !== rendered} onClick={() => download(svg, selected + '.svg', 'image/svg+xml')}>Download SVG</button>}
    {view && <button onClick={() => download(JSON.stringify(config, null, 2) + '\n', file.name.replace(/\.sysml$/, '.views.json'), 'application/json')}>Download view definitions</button>}
    <button disabled={saving} onClick={() => upload.current?.click()}>Import view file</button>
    {view && !savedView && <button disabled={saving} onClick={discardNewView}>Discard new view</button>}
  </DiagramToolbar>
  <input ref={upload} hidden type="file" accept=".json" onChange={async e => { const f = e.target.files?.[0]; if (!f) return; try { const c = JSON.parse(await f.text()) as ViewConfig; if (!Array.isArray(c.views) || !c.views.length) throw new Error('View file must contain selected views.'); setConfig(c); setSelected(c.views[0].id, c.views[0].title); setPicked([]); setTargetOverride(undefined) } catch (err) { setError(String(err)) }; e.target.value = '' }} />
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
   {view && scene && previewView?.id === selected && <DiagramCanvas onConnectorRouteChange={rerouteConnector} onConnectorLabelChange={moveConnectorLabel} includeRoutes elementDrop={{ file: file.name, place: placeElement }} split={split} key={selected} frameTitle={previewView.title} fitRevision={fitRevision} nodes={graph.nodes} edges={graph.edges} onNodesChange={graph.onNodesChange} onEdgesChange={graph.onEdgesChange}
    onClearSelection={() => selectDiagramElement(null)}
    onNodeClick={(event, node) => pick(String(node.data.viewKey), event.shiftKey || event.ctrlKey || event.metaKey)}
    onNodeDoubleClick={(event, node) => {
     if (node.type !== 'sysml' || (event.target as Element).closest('button, .react-flow__handle')) return
     onOpenElementDiagram?.(node.id)
    }}
    onEdgeClick={(_, edge) => selectDiagramElement(edge.id)}
    onNodeDragStop={(_, node, dragged) => void finishDrag(node, dragged)}
    onConnect={params => void connect(params)}
   />}
   {settingsPanel && (settingsHost ? createPortal(settingsPanel, settingsHost) : settingsPanel)}
  </div>
  {!view && selected && !error && <p className="shared-error" role="alert">This saved view is unavailable. Choose a different diagram view.</p>}
  {standalone.error && <p className="shared-error" role="alert">{standalone.error}</p>}
 </section>
}
