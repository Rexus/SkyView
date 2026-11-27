import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow, Background, BackgroundVariant, MiniMap, Panel, ViewportPortal,
  getNodesBounds, useReactFlow, useStore, type Node, type Edge, type ReactFlowProps, type ReactFlowInstance, type NodeProps, type Rect,
} from '@xyflow/react'
import { Hand, Map, Maximize, Minus, MousePointer2, Plus } from 'lucide-react'
import SysmlNode, { GlyphNode, type SysmlNodeData } from './SysmlNode'
import NoteNode from './NoteNode'
import RelationshipEdge from './RelationshipEdge'
import { PROJECT_ID } from '../api'
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

function CanvasTools({ title, fitRevision, split, hand, onHand }: {
  title?: string
  fitRevision: number
  split: boolean
  hand: boolean
  onHand: (hand: boolean) => void
}) {
  const flow = useReactFlow()
  const [map, setMap] = useState(false)
  const bounds = useStore(state => getNodesBounds(state.nodes.filter(node => !node.hidden),
    { nodeLookup: state.nodeLookup }), boundsEqual)
  const frame = scopeFrame(bounds)
  const fit = (rect = frame) => {
    if (rect) void flow.fitBounds({ ...rect, y: rect.y - 18, height: rect.height + 18 }, { padding: .08, duration: 160 })
  }
  const appliedFit = useRef(0)
  const previousSplit = useRef(split)
  useEffect(() => {
    if ((appliedFit.current === fitRevision && previousSplit.current === split) || !flow.viewportInitialized) return
    const pending = requestAnimationFrame(() => {
      const rect = scopeFrame(flow.getNodesBounds(flow.getNodes().filter(node => !node.hidden)))
      if (!rect) return
      appliedFit.current = fitRevision
      previousSplit.current = split
      fit(rect)
    })
    return () => cancelAnimationFrame(pending)
  }, [fitRevision, split, flow, bounds])
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
          onClick={() => fit()} disabled={!frame}><Maximize size={15} /></button>
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
  frameTitle, fitRevision = 0, split = false, elementDrop, ...props
}: ReactFlowProps<N, E> & {
  frameTitle?: string
  fitRevision?: number
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
      minZoom={.1} maxZoom={2.5} proOptions={{ hideAttribution: true }} deleteKeyCode={null}
      defaultEdgeOptions={{ type: 'smoothstep' }}>
      <Background variant={BackgroundVariant.Dots} gap={21} size={.8} color="var(--grid-dot)" />
      <CanvasTools split={split} title={frameTitle} fitRevision={fitRevision} hand={hand} onHand={setHand} />
    </ReactFlow>
  </div>
}
