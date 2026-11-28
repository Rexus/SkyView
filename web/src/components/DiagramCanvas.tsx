import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow, Background, BackgroundVariant, MiniMap, Panel, ViewportPortal,
  getNodesBounds, useNodesInitialized, useReactFlow, useStore, useStoreApi,
  type Node, type Edge, type ReactFlowProps, type ReactFlowInstance, type NodeProps, type NodePositionChange, type Rect,
} from '@xyflow/react'
import { Hand, Map, Maximize, Minus, MousePointer2, Plus } from 'lucide-react'
import SysmlNode, { GlyphNode, type SysmlNodeData } from './SysmlNode'
import NoteNode from './NoteNode'
import RelationshipEdge from './RelationshipEdge'
import { PROJECT_ID } from '../api'
import type { Point } from '../sharedViews'
import { snapPlacement, type PlacementGuide } from '../layoutGuides'
import type { RouteBox } from '../sharedRouting'
import type { ChangeConnectorLabel, ChangeConnectorRoute } from '../connectorRoutes'
import { elementDragType, readElementDrag, type DropPosition } from '../elementDrag'

function BoundaryNode({ data, selected }: NodeProps) {
  return <GlyphNode data={data as Partial<SysmlNodeData>} selected={selected} annotation />
}
const nodeTypes = { sysml: SysmlNode, note: NoteNode, boundary: BoundaryNode }
const edgeTypes = { relationship: RelationshipEdge }
const overviewMapKey = 'skyview-overview-map'
const reducesMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

function boundsEqual(a: Rect, b: Rect) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
}

function scopeFrame(bounds: Rect) {
  if (bounds.width <= 0 || bounds.height <= 0) return undefined
  return { x: bounds.x - 24, y: bounds.y - 28, width: bounds.width + 48, height: bounds.height + 52 }
}

function withRouteBounds(bounds: Rect, edges: Edge[]): Rect {
  if (!bounds.width || !bounds.height) return bounds
  let { x, y } = bounds
  let right = x + bounds.width, bottom = y + bounds.height
  for (const { data } of edges) {
    const geometry = data as { points?: Point[]; labelBounds?: Rect } | undefined
    for (const [u, v] of geometry?.points ?? []) {
      x = Math.min(x, u); y = Math.min(y, v)
      right = Math.max(right, u); bottom = Math.max(bottom, v)
    }
    const label = geometry?.labelBounds
    if (label) {
      x = Math.min(x, label.x); y = Math.min(y, label.y)
      right = Math.max(right, label.x + label.width); bottom = Math.max(bottom, label.y + label.height)
    }
  }
  return { x, y, width: right - x, height: bottom - y }
}

function CanvasTools({ title, fitRevision, split, hand, onHand, includeRoutes, onClearSelection, cancelDrag, cancelConnection }: {
  title?: string
  fitRevision: number
  split: boolean
  hand: boolean
  onHand: (hand: boolean) => void
  includeRoutes: boolean
  onClearSelection?: () => void
  cancelDrag: () => boolean
  cancelConnection: () => void
}) {
  const flow = useReactFlow()
  const store = useStoreApi()
  const measured = useNodesInitialized()
  const width = useStore(state => state.width)
  const height = useStore(state => state.height)
  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      const target = event.target
      if (event.key !== 'Escape' || event.defaultPrevented ||
          (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) ||
          document.querySelector('[role="dialog"][aria-modal="true"]')) return
      if (cancelDrag()) return
      const state = store.getState()
      if (state.connection.inProgress || state.connectionClickStartHandle) {
        cancelConnection()
        state.cancelConnection()
        store.setState({ connectionClickStartHandle: null })
      } else if (hand) onHand(false)
      else {
        state.unselectNodesAndEdges()
        onClearSelection?.()
      }
    }
    document.addEventListener('keydown', onEscape)
    return () => document.removeEventListener('keydown', onEscape)
  }, [store, hand, onHand, onClearSelection, cancelDrag, cancelConnection])
  const caption = useRef<HTMLSpanElement>(null)
  const [map, setMap] = useState(() => window.sessionStorage.getItem(overviewMapKey) !== 'false')
  useEffect(() => {
    window.sessionStorage.setItem(overviewMapKey, String(map))
  }, [map])
  const bounds = useStore(state => {
    const cards = getNodesBounds(state.nodes.filter(node => !node.hidden),
      { nodeLookup: state.nodeLookup, nodeOrigin: state.nodeOrigin })
    return includeRoutes ? withRouteBounds(cards, state.edges) : cards
  }, boundsEqual)
  const frame = scopeFrame(bounds)
  const fit = useCallback(() => {
    // Layout can replace nodes between scheduling the fit and measuring the new cards.
    if (!flow.viewportInitialized || !store.getState().nodesInitialized) return false
    const visible = flow.getNodes().filter(node => !node.hidden)
    const cards = flow.getNodesBounds(visible)
    const rect = scopeFrame(includeRoutes ? withRouteBounds(cards, flow.getEdges()) : cards)
    if (!rect) return false
    const titleHeight = caption.current?.offsetHeight ?? 0
    void flow.fitBounds({ ...rect, y: rect.y - titleHeight, height: rect.height + titleHeight }, {
      padding: .08, duration: reducesMotion() ? 0 : 160,
    })
    return true
  }, [flow, store, includeRoutes])
  const fitRequest = [fitRevision, split].join(':')
  const fitKey = [fitRequest, width, height].join(':')
  const appliedFit = useRef<{ key: string; request: string } | undefined>(undefined)
  useEffect(() => {
    if (appliedFit.current?.key === fitKey || !flow.viewportInitialized || !measured || !width || !height) return
    const apply = () => {
      const state = store.getState()
      if (state.width !== width || state.height !== height || !fit()) return
      appliedFit.current = { key: fitKey, request: fitRequest }
    }
    // A sliding sidebar or dragged splitter reports a new size on every frame.
    // Fit the settled size once instead of restarting the zoom on every frame.
    if (appliedFit.current?.request === fitRequest && !reducesMotion()) {
      const pending = window.setTimeout(apply, 90)
      return () => window.clearTimeout(pending)
    }
    const pending = requestAnimationFrame(apply)
    return () => cancelAnimationFrame(pending)
  }, [fitKey, fitRequest, flow.viewportInitialized, measured, width, height, bounds, fit, store])
  return <>
    <Panel position="top-right" className="canvas-tools">
      <div role="group" aria-label="Diagram viewport tools">
        <button type="button" className="icon-button tooltip" aria-label="Select elements" data-tip="Select elements"
          aria-pressed={!hand} onClick={() => onHand(false)}><MousePointer2 size={15} /></button>
        <button type="button" className="icon-button tooltip" aria-label="Pan diagram" data-tip="Pan diagram"
          aria-pressed={hand} onClick={() => onHand(true)}><Hand size={15} /></button>
        <span className="tools-sep" aria-hidden="true" />
        <button type="button" className="icon-button tooltip" aria-label="Zoom in" data-tip="Zoom in"
          onClick={() => void flow.zoomIn({ duration: 110 })}><Plus size={15} /></button>
        <button type="button" className="icon-button tooltip" aria-label="Zoom out" data-tip="Zoom out"
          onClick={() => void flow.zoomOut({ duration: 110 })}><Minus size={15} /></button>
        <button type="button" className="icon-button tooltip" aria-label="Fit diagram to window" data-tip="Fit to window"
          onClick={() => fit()} disabled={!measured || !frame}><Maximize size={15} /></button>
        <button type="button" className="icon-button tooltip" aria-label="Overview map" data-tip="Overview map"
          aria-pressed={map} onClick={() => setMap(value => !value)}><Map size={15} /></button>
      </div>
    </Panel>
    {title && frame && <ViewportPortal>
      <div aria-hidden="true" className="diagram-scope-frame" style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}>
        <span ref={caption}>{title}</span>
      </div>
    </ViewportPortal>}
    {map && <MiniMap pannable zoomable style={{ width: 130, height: 82 }}
      nodeColor={n => n.type === 'boundary' ? 'var(--border-strong)' : 'var(--accent-line)'}
      maskColor="var(--minimap-mask)" />}
  </>
}

/** One interactive canvas, viewport and scope frame for automatic and saved views. */
export default function DiagramCanvas<N extends Node = Node, E extends Edge = Edge>({
  frameTitle, fitRevision = 0, split = false, elementDrop, includeRoutes = false, onConnectorRouteChange, onConnectorLabelChange, onClearSelection, ...props
}: ReactFlowProps<N, E> & {
  frameTitle?: string
  fitRevision?: number
  includeRoutes?: boolean
  onConnectorRouteChange?: ChangeConnectorRoute
  onConnectorLabelChange?: ChangeConnectorLabel
  onClearSelection?: () => void
  split?: boolean
  elementDrop?: { file: string; place: (id: string, position: DropPosition) => void }
}) {
  const instance = useRef<ReactFlowInstance<N, E> | null>(null)
  const [hand, setHand] = useState(false)
  const [guides, setGuides] = useState<PlacementGuide[]>([])
  const drag = useRef<{ initial: NodePositionChange[]; cancelled: boolean } | undefined>(undefined)
  const connectionCancelled = useRef(false)
  const cancelDrag = () => {
    if (!drag.current || drag.current.cancelled) return false
    drag.current.cancelled = true
    setGuides([])
    props.onNodesChange?.(drag.current.initial)
    return true
  }
  const guidedPosition = (node: N, dragged: N[], bypass: boolean) => {
    const flow = instance.current
    if (!flow || bypass || dragged.length !== 1 || (node.type !== 'sysml' && node.type !== 'boundary')) {
      return { node, guides: [] }
    }
    const boxFor = (item: N): RouteBox => ({
      ...item.position, width: item.measured?.width ?? item.width ?? 0, height: item.measured?.height ?? item.height ?? 0,
    })
    const moving = boxFor(node)
    if (!moving.width || !moving.height) return { node, guides: [] }
    const peers = flow.getNodes().filter(item => item.id !== node.id && item.parentId === node.parentId &&
      !item.hidden && (item.type === 'sysml' || item.type === 'boundary')).map(boxFor).filter(box => box.width && box.height)
    const parent = node.parentId ? flow.getNode(node.parentId) : undefined
    const parentBounds = parent ? flow.getNodesBounds([parent]) : undefined
    const result = snapPlacement(moving, peers, Math.min(26, 8 / flow.getZoom()),
      parentBounds && { ...parentBounds, x: 0, y: 0 })
    const absolute = ([x, y]: Point): Point => [x + (parentBounds?.x ?? 0), y + (parentBounds?.y ?? 0)]
    return { node: { ...node, position: result.position }, guides: result.guides.map(guide => ({
      ...guide, from: absolute(guide.from), to: absolute(guide.to),
    })) }
  }
  const applyPosition = (node: N, adjusted: N, dragging: boolean) => {
    if (adjusted.position.x !== node.position.x || adjusted.position.y !== node.position.y) {
      props.onNodesChange?.([{ id: node.id, type: 'position', position: adjusted.position, dragging }])
    }
  }
  const nodes = useMemo(() => hand ? props.nodes?.map(node => ({
    ...node, draggable: false, connectable: false, selectable: false,
  })) : props.nodes, [hand, props.nodes])
  const edges = useMemo(() => onConnectorRouteChange && !hand ? props.edges?.map(edge =>
    edge.type === 'relationship' && edge.data?.routeEditable !== false
      ? { ...edge, data: { ...edge.data, onRouteChange: onConnectorRouteChange, onLabelChange: onConnectorLabelChange } } : edge
  ) : props.edges, [props.edges, onConnectorRouteChange, onConnectorLabelChange, hand])
  return <div className={'diagram-canvas' + (hand ? ' pan-mode' : '')} aria-label="Interactive SysML diagram"
    onDragOver={event => {
      if (!elementDrop || !event.dataTransfer.types.includes(elementDragType)) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
    }}
    onDrop={event => {
      if (!elementDrop || !event.dataTransfer.types.includes(elementDragType)) return
      event.preventDefault()
      event.stopPropagation()
      const item = readElementDrag(event.dataTransfer)
      if (item?.project !== PROJECT_ID || item.file !== elementDrop.file || !instance.current) return
      const position = instance.current.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      elementDrop.place(item.id, position)
    }}>
    <ReactFlow<N, E> {...props} nodes={nodes} edges={edges}
      onInit={flow => { instance.current = flow; props.onInit?.(flow) }}
      onPaneClick={event => { props.onPaneClick?.(event); onClearSelection?.() }}
      onNodeClick={hand ? undefined : props.onNodeClick} onEdgeClick={hand ? undefined : props.onEdgeClick}
      onNodeDragStart={(event, node, dragged) => {
        drag.current = { initial: (dragged.length ? dragged : [node]).map(item => ({
          id: item.id, type: 'position', position: { ...item.position }, dragging: false,
        })), cancelled: false }
        props.onNodeDragStart?.(event, node, dragged)
      }}
      onNodeDrag={(event, node, dragged) => {
        if (drag.current?.cancelled) { props.onNodesChange?.(drag.current.initial); return }
        const adjusted = guidedPosition(node, dragged, !!event.altKey)
        setGuides(adjusted.guides)
        applyPosition(node, adjusted.node, true)
        props.onNodeDrag?.(event, adjusted.node, dragged)
      }}
      onNodeDragStop={(event, node, dragged) => {
        const completed = drag.current
        drag.current = undefined
        if (completed?.cancelled) { props.onNodesChange?.(completed.initial); return }
        const adjusted = guidedPosition(node, dragged, !!event.altKey)
        setGuides([])
        applyPosition(node, adjusted.node, false)
        props.onNodeDragStop?.(event, adjusted.node, dragged.map(item => item.id === node.id ? adjusted.node : item))
      }}
      onConnectStart={(event, params) => { connectionCancelled.current = false; props.onConnectStart?.(event, params) }}
      onClickConnectStart={(event, params) => { connectionCancelled.current = false; props.onClickConnectStart?.(event, params) }}
      onConnect={connection => { if (!connectionCancelled.current) props.onConnect?.(connection) }}
      panOnDrag={hand ? true : [1, 2]} elementsSelectable={!hand}
      nodeTypes={nodeTypes} edgeTypes={edgeTypes}
      minZoom={.0001} maxZoom={2.5} proOptions={{ hideAttribution: true }} deleteKeyCode={null}
      defaultEdgeOptions={{ type: 'smoothstep' }}>
      <Background variant={BackgroundVariant.Dots} gap={21} size={.8} color="var(--grid-dot)" />
      {!!guides.length && <ViewportPortal><svg className="placement-guides" aria-hidden="true">
        {guides.map(({ kind, from: [x1, y1], to: [x2, y2] }, index) => {
          const dx = x1 === x2 ? 4 : 0, dy = y1 === y2 ? 4 : 0
          return <g key={index} className={kind}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} vectorEffect="non-scaling-stroke" />
            {kind === 'spacing' && <>
              <line x1={x1 - dx} y1={y1 - dy} x2={x1 + dx} y2={y1 + dy} vectorEffect="non-scaling-stroke" />
              <line x1={x2 - dx} y1={y2 - dy} x2={x2 + dx} y2={y2 + dy} vectorEffect="non-scaling-stroke" />
            </>}
          </g>
        })}
      </svg></ViewportPortal>}
      <CanvasTools split={split} title={frameTitle} fitRevision={fitRevision} hand={hand} onHand={setHand} includeRoutes={includeRoutes}
        onClearSelection={onClearSelection} cancelDrag={cancelDrag} cancelConnection={() => { connectionCancelled.current = true }} />
    </ReactFlow>
  </div>
}
