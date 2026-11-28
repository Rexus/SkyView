import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow, Background, BackgroundVariant, MiniMap, Panel, ViewportPortal,
  getNodesBounds, useNodesInitialized, useReactFlow, useStore, useStoreApi,
  type Node, type Edge, type ReactFlowProps, type ReactFlowInstance, type NodeProps, type Rect,
} from '@xyflow/react'
import { Hand, Map, Maximize, Minus, MousePointer2, Plus } from 'lucide-react'
import SysmlNode, { GlyphNode, type SysmlNodeData } from './SysmlNode'
import NoteNode from './NoteNode'
import RelationshipEdge from './RelationshipEdge'
import { PROJECT_ID } from '../api'
import type { Point } from '../sharedViews'
import { elementDragType, readElementDrag, type DropPosition } from '../elementDrag'

function BoundaryNode({ data, selected }: NodeProps) {
  return <GlyphNode data={data as Partial<SysmlNodeData>} selected={selected} annotation />
}
const nodeTypes = { sysml: SysmlNode, note: NoteNode, boundary: BoundaryNode }
const edgeTypes = { relationship: RelationshipEdge }

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

function CanvasTools({ title, fitRevision, split, hand, onHand, includeRoutes }: {
  title?: string
  fitRevision: number
  split: boolean
  hand: boolean
  onHand: (hand: boolean) => void
  includeRoutes: boolean
}) {
  const flow = useReactFlow()
  const store = useStoreApi()
  const measured = useNodesInitialized()
  const width = useStore(state => state.width)
  const height = useStore(state => state.height)
  const [map, setMap] = useState(false)
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
    void flow.fitBounds({ ...rect, y: rect.y - 18, height: rect.height + 18 }, { padding: .08, duration: 160 })
    return true
  }, [flow, store, includeRoutes])
  const fitKey = [fitRevision, split, width, height].join(':')
  const appliedFit = useRef(fitKey)
  useEffect(() => {
    if (appliedFit.current === fitKey || !flow.viewportInitialized || !measured || !width || !height) return
    const pending = requestAnimationFrame(() => {
      const state = store.getState()
      if (state.width !== width || state.height !== height || !fit()) return
      appliedFit.current = fitKey
    })
    return () => cancelAnimationFrame(pending)
  }, [fitKey, flow.viewportInitialized, measured, width, height, bounds, fit, store])
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
        <span>{title}</span>
      </div>
    </ViewportPortal>}
    {map && <MiniMap pannable zoomable style={{ width: 130, height: 82 }}
      nodeColor={n => n.type === 'boundary' ? 'var(--border-strong)' : 'var(--accent-line)'}
      maskColor="var(--minimap-mask)" />}
  </>
}

/** One interactive canvas, viewport and scope frame for automatic and saved views. */
export default function DiagramCanvas<N extends Node = Node, E extends Edge = Edge>({
  frameTitle, fitRevision = 0, split = false, elementDrop, includeRoutes = false, ...props
}: ReactFlowProps<N, E> & {
  frameTitle?: string
  fitRevision?: number
  includeRoutes?: boolean
  split?: boolean
  elementDrop?: { file: string; place: (id: string, position: DropPosition) => void }
}) {
  const instance = useRef<ReactFlowInstance<N, E> | null>(null)
  const [hand, setHand] = useState(false)
  const nodes = useMemo(() => hand ? props.nodes?.map(node => ({
    ...node, draggable: false, connectable: false, selectable: false,
  })) : props.nodes, [hand, props.nodes])
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
    <ReactFlow<N, E> {...props} nodes={nodes}
      onInit={flow => { instance.current = flow; props.onInit?.(flow) }}
      onNodeClick={hand ? undefined : props.onNodeClick} onEdgeClick={hand ? undefined : props.onEdgeClick}
      panOnDrag={hand ? true : [1, 2]} elementsSelectable={!hand}
      nodeTypes={nodeTypes} edgeTypes={edgeTypes} fitView fitViewOptions={{ padding: .22, maxZoom: 1 }}
      minZoom={.0001} maxZoom={2.5} proOptions={{ hideAttribution: true }} deleteKeyCode={null}
      defaultEdgeOptions={{ type: 'smoothstep' }}>
      <Background variant={BackgroundVariant.Dots} gap={21} size={.8} color="var(--grid-dot)" />
      <CanvasTools split={split} title={frameTitle} fitRevision={fitRevision} hand={hand} onHand={setHand} includeRoutes={includeRoutes} />
    </ReactFlow>
  </div>
}
