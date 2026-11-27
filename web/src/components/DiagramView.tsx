import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react'
import dagre from 'dagre'
import { Link2, Plus, StickyNote, Wand2 } from 'lucide-react'
import { getLayout, putLayout } from '../api'
import type {
  DiagramMode,
  DiagramNote,
  FileResponse,
  LayoutFile,
  SysmlElement,
  SysmlModel,
} from '../types'
import {
  attributesOf,
  byId,
  childrenOf,
  cx,
  defaultScope,
  diagnosticsFor,
  displayName,
  diagramScopes,
  docFor,
  kindColor,
  plural,
  portsOf,
} from '../utils'
import SysmlNode, { type SysmlNodeData } from './SysmlNode'
import NoteNode, { type NoteFlowNode } from './NoteNode'

type SysmlFlowNode = Node<SysmlNodeData, 'sysml'>
type DiagramFlowNode = SysmlFlowNode | NoteFlowNode

const nodeTypes = { sysml: SysmlNode, note: NoteNode }

interface Props {
  file: FileResponse
  selectedId: string | null
  onSelect: (id: string) => void
  onAddElement: (parent?: string) => void
  onAddConnection: (conn: { parent: string; name?: string; source: string; target: string }) => Promise<void>
  onOpenAddConnection: (parent?: string) => void
  onShowInSource: (line: number) => void
}

interface EdgeData {
  connection: SysmlElement
  [key: string]: unknown
}

const NODE_W = 224
const NOTE_W = 220
const NOTE_H = 170
const LAYOUT_VERSION = 3

function isDiagramNode(el: SysmlElement): boolean {
  return !['port', 'attribute', 'connection', 'satisfy', 'root'].includes(el.kind)
}

function estimateHeight(
  el: SysmlElement,
  ports: number,
  attributes: number,
  doc: string,
): number {
  const docLines = doc ? Math.min(3, Math.max(1, Math.ceil(doc.length / 42))) : 0
  const attrRows = Math.min(attributes, 4)
  return (
    58 +
    (el.type ? 22 : 0) +
    (doc ? 18 + docLines * 14 : 0) +
    (attributes > 0 ? 18 + attrRows * 18 + (attributes > 4 ? 14 : 0) : 0) +
    Math.max(ports, 1) * 23 +
    24
  )
}

function computeLayout(
  nodes: Array<{
    id: string
    element: SysmlElement
    ports: SysmlElement[]
    attributes: SysmlElement[]
    doc: string
  }>,
  edges: Array<{ source: string; target: string }>,
  mode: DiagramMode,
): Record<string, { x: number; y: number }> {
  const positions: Record<string, { x: number; y: number }> = {}
  if (nodes.length === 0) return positions

  const g = new dagre.graphlib.Graph()
  g.setGraph({
    rankdir: mode === 'interconnection' ? 'LR' : 'TB',
    nodesep: mode === 'interconnection' ? 64 : 44,
    ranksep: mode === 'interconnection' ? 110 : 82,
    marginx: 48,
    marginy: 48,
  })
  g.setDefaultEdgeLabel(() => ({}))

  for (const n of nodes) {
    g.setNode(n.id, {
      width: NODE_W,
      height: estimateHeight(n.element, n.ports.length, n.attributes.length, n.doc),
    })
  }
  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target)
  }
  dagre.layout(g)

  for (const n of nodes) {
    const p = g.node(n.id)
    if (p) {
      positions[n.id] = {
        x: Math.round(p.x - NODE_W / 2),
        y: Math.round(p.y - p.height / 2),
      }
    }
  }

  // Dagre can place connected nodes in the same rank closer than their real
  // rendered height (especially now that nodes carry doc/attribute
  // compartments). Resolve any residual overlaps by pushing the lower node
  // down, preserving the left-to-right structure.
  const boxes = nodes
    .filter((n) => positions[n.id])
    .map((n) => ({
      id: n.id,
      x: positions[n.id].x,
      y: positions[n.id].y,
      w: NODE_W,
      h: estimateHeight(n.element, n.ports.length, n.attributes.length, n.doc),
    }))
  const gap = 24
  for (let iter = 0; iter < 40; iter++) {
    let moved = false
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]
        const b = boxes[j]
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
        if (overlapX > 0 && overlapY > 0) {
          const lower = a.y >= b.y ? a : b
          lower.y += overlapY + gap
          moved = true
        }
      }
    }
    if (!moved) break
  }
  for (const box of boxes) {
    positions[box.id] = { x: Math.round(box.x), y: Math.round(box.y) }
  }
  return positions
}

function buildGraph(model: SysmlModel, scope: SysmlElement, mode: DiagramMode) {
  const nodeEls: SysmlElement[] = []
  const edgeEls: SysmlElement[] = []

  if (mode === 'interconnection') {
    for (const child of childrenOf(model, scope.id)) {
      if (isDiagramNode(child)) nodeEls.push(child)
    }
    for (const child of childrenOf(model, scope.id)) {
      if (child.kind === 'connection') edgeEls.push(child)
    }
  } else {
    nodeEls.push(scope)
    for (const child of childrenOf(model, scope.id)) {
      if (isDiagramNode(child)) nodeEls.push(child)
    }
  }

  const nodeIds = new Set(nodeEls.map((e) => e.id))
  const nodes = nodeEls.map((element) => {
    const ports = portsOf(model, element)
    const attributes = attributesOf(model, element)
    const doc = docFor(model, element)
    return {
      id: element.id,
      element,
      ports,
      attributes,
      doc,
      diagnostics: diagnosticsFor(model, element.id),
    }
  })
  const portsByNode = new Map(nodes.map((n) => [n.id, n.ports]))

  const edgePairs: Array<{ source: string; target: string }> = []
  const edges: Array<Edge<EdgeData>> = []

  if (mode === 'interconnection') {
    for (const conn of edgeEls) {
      if (!conn.sourceNodeId || !conn.targetNodeId) continue
      if (!nodeIds.has(conn.sourceNodeId) || !nodeIds.has(conn.targetNodeId)) continue
      const sourcePort = byId(model, conn.sourceId)
      const targetPort = byId(model, conn.targetId)
      const sourceMatch = sourcePort
        ? portsByNode.get(conn.sourceNodeId)?.find((p) => p.name === sourcePort.name)
        : undefined
      const targetMatch = targetPort
        ? portsByNode.get(conn.targetNodeId)?.find((p) => p.name === targetPort.name)
        : undefined
      edgePairs.push({ source: conn.sourceNodeId, target: conn.targetNodeId })
      edges.push({
        id: conn.id,
        source: conn.sourceNodeId,
        target: conn.targetNodeId,
        sourceHandle: sourceMatch ? `${sourceMatch.id}-out` : `${conn.sourceNodeId}-generic-out`,
        targetHandle: targetMatch ? `${targetMatch.id}-in` : `${conn.targetNodeId}-generic-in`,
        type: 'smoothstep',
        label: conn.name,
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        labelStyle: { fill: 'var(--text-muted)', fontSize: 9 },
        labelBgStyle: { fill: 'var(--bg-elev)', fillOpacity: 0.9 },
        labelBgPadding: [4, 2],
        labelBgBorderRadius: 4,
        data: { connection: conn },
      })
    }
  } else {
    for (const child of childrenOf(model, scope.id)) {
      if (!nodeIds.has(child.id)) continue
      edgePairs.push({ source: scope.id, target: child.id })
      edges.push({
        id: `contain-${child.id}`,
        source: scope.id,
        target: child.id,
        type: 'smoothstep',
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12 },
        style: { stroke: 'var(--border-strong)', strokeDasharray: '4 4' },
      })
    }
  }

  return { nodes, edges, edgePairs }
}

export default function DiagramView({
  file,
  selectedId,
  onSelect,
  onAddElement,
  onAddConnection,
  onOpenAddConnection,
}: Props) {
  const model = file.model
  const [mode, setMode] = useState<DiagramMode>('interconnection')
  const [scopeId, setScopeId] = useState('')
  const [layout, setLayout] = useState<LayoutFile>({})
  const [layoutLoaded, setLayoutLoaded] = useState(false)
  const [nodes, setNodes, onNodesChange] = useNodesState<DiagramFlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const nodesRef = useRef<DiagramFlowNode[]>([])
  nodesRef.current = nodes

  const scopes = useMemo(() => diagramScopes(model), [model])
  const scope = useMemo(() => byId(model, scopeId), [model, scopeId])

  // Initialise scope/mode for a newly opened file.
  useEffect(() => {
    const preferred = defaultScope(model, 'interconnection')
    setScopeId(preferred)
    const hasConnections = model.elements.some(
      (e) => e.kind === 'connection' && e.parentId === preferred,
    )
    setMode(hasConnections ? 'interconnection' : 'containment')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file.name])

  useEffect(() => {
    let cancelled = false
    setLayoutLoaded(false)
    getLayout(file.name)
      .then((l) => {
        if (!cancelled) {
          setLayout(l ?? {})
          setLayoutLoaded(true)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLayout({})
          setLayoutLoaded(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [file.name])

  const graph = useMemo(() => {
    if (!scope) return { nodes: [], edges: [], edgePairs: [] }
    return buildGraph(model, scope, mode)
  }, [model, scope, mode])

  const persistNotes = useCallback(
    (notes: Record<string, DiagramNote>) => {
      const currentPositions: Record<string, { x: number; y: number }> = {}
      for (const n of nodesRef.current) {
        if (n.type === 'sysml') {
          currentPositions[n.id] = {
            x: Math.round(n.position.x),
            y: Math.round(n.position.y),
          }
        }
      }
      const baseScopes = layout.version === LAYOUT_VERSION ? layout.scopes ?? {} : {}
      const next: LayoutFile = {
        ...layout,
        version: LAYOUT_VERSION,
        scopes: scope
          ? {
              ...baseScopes,
              [scope.id]: {
                ...(baseScopes[scope.id] ?? {}),
                [mode]: currentPositions,
              },
            }
          : baseScopes,
        notes,
      }
      setLayout(next)
      putLayout(file.name, next).catch(() => {
        /* non-fatal: layout is a convenience */
      })
    },
    [file.name, layout, scope, mode],
  )

  const findNotePosition = useCallback(
    (targetId: string, allNodes: DiagramFlowNode[], notes: Record<string, DiagramNote>) => {
      const target = allNodes.find((n) => n.id === targetId)
      if (!target) return { x: 80, y: 80 }
      const nodeRects = allNodes
        .filter((n) => n.type === 'sysml')
        .map((n) => ({
          x: n.position.x,
          y: n.position.y,
          w: NODE_W,
          h: n.measured?.height ?? 220,
        }))
      const noteRects = Object.values(notes).map((n) => ({ x: n.x, y: n.y, w: NOTE_W, h: NOTE_H }))
      const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
        a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
      const candidates = [
        { x: target.position.x + NODE_W + 28, y: target.position.y },
        { x: target.position.x, y: target.position.y - NOTE_H - 28 },
        {
          x: target.position.x,
          y: target.position.y + (target.measured?.height ?? 220) + 28,
        },
        { x: target.position.x - NOTE_W - 28, y: target.position.y },
      ]
      for (const c of candidates) {
        const rect = { ...c, w: NOTE_W, h: NOTE_H }
        if (!nodeRects.some((r) => overlaps(rect, r)) && !noteRects.some((r) => overlaps(rect, r))) {
          return c
        }
      }
      return candidates[0]
    },
    [],
  )

  const onNoteChange = useCallback(
    (id: string, text: string) => {
      const note = layout.notes?.[id]
      if (!note) return
      persistNotes({ ...(layout.notes ?? {}), [id]: { ...note, text } })
    },
    [layout.notes, persistNotes],
  )

  const onNoteDelete = useCallback(
    (id: string) => {
      const nextNotes = { ...(layout.notes ?? {}) }
      delete nextNotes[id]
      persistNotes(nextNotes)
    },
    [layout.notes, persistNotes],
  )

  const addNote = useCallback(() => {
    if (!scope) return
    const targetId =
      selectedId && graph.nodes.some((n) => n.id === selectedId)
        ? selectedId
        : graph.nodes[0]?.id ?? scope.id
    const existingNotes = layout.notes ?? {}
    const position = findNotePosition(targetId, nodes, existingNotes)
    const note: DiagramNote = {
      id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      targetId,
      text: 'Note',
      x: Math.round(position.x),
      y: Math.round(position.y),
    }
    persistNotes({ ...existingNotes, [note.id]: note })
  }, [
    scope,
    selectedId,
    graph.nodes,
    nodes,
    layout.notes,
    persistNotes,
    findNotePosition,
  ])

  // Rebuild React Flow nodes whenever the graph or saved layout changes.
  useEffect(() => {
    if (!scope) {
      setNodes([])
      setEdges([])
      return
    }
    const saved =
      layout.version === LAYOUT_VERSION ? layout.scopes?.[scope.id]?.[mode] : undefined
    const allSaved = saved && graph.nodes.every((n) => saved[n.id])
    const computed = computeLayout(graph.nodes, graph.edgePairs, mode)
    // Keep the user's arrangement for known nodes; only place newly added
    // nodes with dagre instead of re-laying out the whole diagram.
    const positions = allSaved
      ? (saved as Record<string, { x: number; y: number }>)
      : { ...computed, ...(saved ?? {}) }

    const genericSources = new Set<string>()
    const genericTargets = new Set<string>()
    for (const e of graph.edges) {
      if (String(e.sourceHandle ?? '').endsWith('-generic-out')) genericSources.add(e.source)
      if (String(e.targetHandle ?? '').endsWith('-generic-in')) genericTargets.add(e.target)
    }

    const nodeIds = new Set(graph.nodes.map((n) => n.id))
    const visibleNotes = Object.values(layout.notes ?? {}).filter((n) => nodeIds.has(n.targetId))
    for (const note of visibleNotes) genericTargets.add(note.targetId)

    const rfNodes: SysmlFlowNode[] = graph.nodes.map((n) => ({
      id: n.id,
      type: 'sysml',
      position: positions[n.id] ?? { x: 0, y: 0 },
      data: {
        element: n.element,
        ports: n.ports,
        attributes: n.attributes,
        doc: n.doc,
        diagnostics: n.diagnostics,
        selected: n.id === selectedId,
        genericSource: genericSources.has(n.id),
        genericTarget: genericTargets.has(n.id),
      },
    }))

    const noteNodes: NoteFlowNode[] = visibleNotes.map((note) => ({
      id: note.id,
      type: 'note',
      position: { x: note.x, y: note.y },
      zIndex: 10,
      data: {
        note,
        targetName: displayName(byId(model, note.targetId)),
        onChange: onNoteChange,
        onDelete: onNoteDelete,
      },
    }))

    const noteEdges: Edge[] = visibleNotes.map((note) => ({
      id: `note-edge-${note.id}`,
      source: note.id,
      target: note.targetId,
      sourceHandle: `${note.id}-out`,
      targetHandle: `${note.targetId}-generic-in`,
      type: 'straight',
      style: {
        stroke: 'var(--warning)',
        strokeDasharray: '5 4',
        strokeWidth: 1.2,
        opacity: 0.8,
      },
      data: { note },
    }))

    setNodes([...rfNodes, ...noteNodes])
    setEdges([...graph.edges, ...noteEdges] as Edge[])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, layout, scope?.id, mode, layoutLoaded, selectedId, onNoteChange, onNoteDelete, model])

  // Keep selection styling in sync without resetting positions.
  useEffect(() => {
    setNodes((current) =>
      current.map((n) => {
        if (n.type === 'note') return n
        return n.data.selected === (n.id === selectedId)
          ? n
          : { ...n, data: { ...n.data, selected: n.id === selectedId } }
      }),
    )
  }, [selectedId, setNodes])

  const persistLayout = useCallback(
    (positions: Record<string, { x: number; y: number }>) => {
      if (!scope) return
      const baseScopes = layout.version === LAYOUT_VERSION ? layout.scopes ?? {} : {}
      const next: LayoutFile = {
        ...layout,
        version: LAYOUT_VERSION,
        scopes: {
          ...baseScopes,
          [scope.id]: {
            ...(baseScopes[scope.id] ?? {}),
            [mode]: positions,
          },
        },
      }
      setLayout(next)
      putLayout(file.name, next).catch(() => {
        /* non-fatal: layout is a convenience */
      })
    },
    [file.name, layout, mode, scope],
  )

  const onNodeDragStop = useCallback(
    (_event: unknown, node: Node) => {
      if (node.type === 'note') {
        const note = layout.notes?.[node.id]
        if (!note) return
        persistNotes({
          ...(layout.notes ?? {}),
          [node.id]: {
            ...note,
            x: Math.round(node.position.x),
            y: Math.round(node.position.y),
          },
        })
        return
      }
      const positions: Record<string, { x: number; y: number }> = {}
      for (const n of nodes) {
        if (n.type === 'sysml') {
          positions[n.id] = { x: Math.round(n.position.x), y: Math.round(n.position.y) }
        }
      }
      persistLayout(positions)
    },
    [nodes, layout.notes, persistNotes, persistLayout],
  )

  const autoLayout = () => {
    if (!scope) return
    const positions = computeLayout(graph.nodes, graph.edgePairs, mode)
    setNodes((current) =>
      current.map((n) => ({ ...n, position: positions[n.id] ?? n.position })),
    )
    persistLayout(positions)
  }

  const handleConnect = async (params: Connection) => {
    if (!scope || !params.source || !params.target) return
    const sourcePortId = params.sourceHandle?.endsWith('-out')
      ? params.sourceHandle.slice(0, -4)
      : null
    const targetPortId = params.targetHandle?.endsWith('-in')
      ? params.targetHandle.slice(0, -3)
      : null
    if (!sourcePortId || !targetPortId) return
    const sourcePort = byId(model, sourcePortId)
    const targetPort = byId(model, targetPortId)
    if (!sourcePort || !targetPort) return
    const sourceNode = byId(model, params.source)
    const targetNode = byId(model, params.target)
    if (!sourceNode || !targetNode) return
    await onAddConnection({
      parent: scope.id,
      source: `${sourceNode.name}.${sourcePort.name}`,
      target: `${targetNode.name}.${targetPort.name}`,
    })
  }

  const selectedConnection = edges.find((e) => e.id === selectedId)
  const modelNodeCount = nodes.filter((n) => n.type === 'sysml').length
  const noteCount = nodes.filter((n) => n.type === 'note').length
  const connectionCount = edges.filter((e) => !String(e.id).startsWith('note-edge-')).length

  if (!scope) {
    return (
      <div className="empty-state">
        <div className="icon-wrap">
          <Link2 size={22} />
        </div>
        <h2>Nothing to draw yet</h2>
        <p>Add a package or part with children to create a diagram scope.</p>
        <button className="btn btn-primary" onClick={() => onAddElement()}>
          <Plus size={13} /> Add element
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="view-toolbar">
        <span className="section-title">Scope</span>
        <select
          className="select input-sm"
          style={{ width: 310 }}
          value={scopeId}
          onChange={(e) => setScopeId(e.target.value)}
        >
          {scopes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.qname}
            </option>
          ))}
        </select>
        <div className="segmented">
          <button
            className={cx(mode === 'interconnection' && 'active')}
            onClick={() => setMode('interconnection')}
          >
            Interconnection
          </button>
          <button
            className={cx(mode === 'containment' && 'active')}
            onClick={() => setMode('containment')}
          >
            Containment
          </button>
        </div>
        <div className="grow" />
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          {plural(modelNodeCount, 'node')} · {plural(connectionCount, 'edge')} · {noteCount} note
          {noteCount === 1 ? '' : 's'}
        </span>
        <button className="btn btn-sm" onClick={autoLayout}>
          <Wand2 size={13} /> Auto layout
        </button>
        <button className="btn btn-sm" onClick={addNote} disabled={graph.nodes.length === 0}>
          <StickyNote size={13} /> Note
        </button>
        <button className="btn btn-sm" onClick={() => onAddElement(scope.id)}>
          <Plus size={13} /> Part
        </button>
        <button className="btn btn-sm" onClick={() => onOpenAddConnection(scope.id)}>
          <Link2 size={13} /> Connect
        </button>
      </div>

      <div className="diagram-wrap">
        {nodes.length === 0 ? (
          <div className="empty-state">
            <div className="icon-wrap">
              <Link2 size={22} />
            </div>
            <h2>Empty scope</h2>
            <p>This element has no drawable children. Add a part or pick another scope.</p>
            <button className="btn btn-primary" onClick={() => onAddElement(scope.id)}>
              <Plus size={13} /> Add part
            </button>
          </div>
        ) : (
          <>
            <ReactFlow
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onNodeClick={(_, node) => {
                if (node.type === 'sysml') onSelect(node.id)
              }}
              onEdgeClick={(_, edge) => {
                const data = edge.data as EdgeData | undefined
                if (data?.connection) onSelect(data.connection.id)
              }}
              onNodeDragStop={onNodeDragStop}
              onConnect={handleConnect}
              nodeTypes={nodeTypes}
              fitView
              fitViewOptions={{ padding: 0.22 }}
              minZoom={0.15}
              maxZoom={1.8}
              proOptions={{ hideAttribution: true }}
              defaultEdgeOptions={{ type: 'smoothstep' }}
            >
              <Background variant={BackgroundVariant.Dots} gap={22} size={1} />
              <Controls showInteractive={false} />
              <MiniMap
                pannable
                zoomable
                nodeColor={(n) =>
                  n.type === 'note'
                    ? 'var(--warning)'
                    : kindColor((n.data as SysmlNodeData).element)
                }
                maskColor="rgba(3, 7, 12, 0.6)"
              />
            </ReactFlow>
            <div className="diagram-hint">
              <Link2 size={12} />
              {mode === 'interconnection'
                ? 'Drag from a port handle to another port to create a connection. Add a note to annotate a node.'
                : 'Containment view — switch to Interconnection to see ports and links. Notes attach with a dashed line.'}
            </div>
            <div className="diagram-legend">
              <div className="legend-row">
                <span className="legend-dot" style={{ background: '#38bdf8' }} /> part
              </div>
              <div className="legend-row">
                <span className="legend-dot" style={{ background: '#f59e0b' }} /> port
              </div>
              <div className="legend-row">
                <span className="legend-dot" style={{ background: '#f472b6' }} /> requirement
              </div>
              <div className="legend-row">
                <span className="legend-dot" style={{ background: '#22d3ee' }} /> connection
              </div>
              <div className="legend-row">
                <span className="legend-dot" style={{ background: 'var(--warning)' }} /> note
              </div>
            </div>
            {selectedConnection && (
              <div className="diagram-hint" style={{ left: 'auto', right: 14, bottom: 14 }}>
                Selected: {selectedConnection.label ?? 'connection'}
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}
