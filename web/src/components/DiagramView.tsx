import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react'
import { layoutFlow } from '../flowLayout'
import { canPlaceElement, type DropPosition } from '../elementDrag'
import { visibleOwner } from '../sourceNavigation'
import { routeModelEdges } from '../modelDiagramRouting'
import { attachmentSide, clearConnector, samePoint, type RouteEdits } from '../connectorRoutes'
import type { Point } from '../sharedViews'
import { Link2, Plus } from 'lucide-react'
import { API_BASE, getLayout, putLayout } from '../api'
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
  portsOf,
} from '../utils'
import type { SysmlNodeData } from './SysmlNode'
import type { SceneNode } from '../diagramScene'
import DiagramCanvas from './DiagramCanvas'
import DiagramToolbar from './DiagramToolbar'
import { connectModelPorts, type AddDiagramConnection } from '../diagramConnections'
import { type NoteFlowNode } from './NoteNode'

type SysmlFlowNode = Node<SysmlNodeData, 'sysml'>
type DiagramFlowNode = SysmlFlowNode | NoteFlowNode



interface Props {
  split?: boolean
  navigation?: ReactNode
  historyControls?: ReactNode
  requestedScope?: { element: string }
  onOpenElementDiagram?: (id: string) => void
  paletteRevision?: string
  file: FileResponse
  selectedId: string | null
  onSelect: (id: string | null) => void
  onAddElement: (parent?: string) => void
  onAddConnection: AddDiagramConnection
  onNotice?: (message: string) => void
  onOpenAddConnection: (parent?: string) => void
  onShowInSource: (line: number) => void
}

interface EdgeData {
  connection?: SysmlElement
  [key: string]: unknown
}

const NODE_W = 224
const NOTE_W = 220
const NOTE_H = 170
const LAYOUT_VERSION = 3

function isDiagramNode(el: SysmlElement): boolean {
  return !['port', 'attribute', 'connection', 'flow', 'satisfy', 'dependency', 'message', 'succession', 'first', 'verify', 'constraint', 'entry', 'root'].includes(el.kind)
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
    height?: number
    width?: number
  }>,
  edges: Edge[],
  mode: DiagramMode,
): Record<string, { x: number; y: number }> {
  const sized = nodes.map(node => ({
    id: node.id,
    width: node.width ?? NODE_W,
    height: node.height ?? estimateHeight(node.element, node.ports.length, node.attributes.length, node.doc),
  }))
  const direction = mode === 'interconnection' ? 'LR' : 'TB'
  const gap = edges.some(edge => edge.label) ? 54 : 42
  const positions = layoutFlow(sized, edges, direction, gap, gap + 24)
  return Object.fromEntries(Object.entries(positions).map(([id, position]) => [
    id, { x: position.x + 48, y: position.y + 48 },
  ]))
}

function buildGraph(model: SysmlModel, scope: SysmlElement, mode: DiagramMode) {
  const nodeEls: SysmlElement[] = []
  const edgeEls: SysmlElement[] = []

  if (mode === 'interconnection') {
    for (const child of childrenOf(model, scope.id)) {
      if (isDiagramNode(child)) nodeEls.push(child)
    }
    for (const child of childrenOf(model, scope.id)) {
      if (['connection', 'flow', 'dependency'].includes(child.kind)) edgeEls.push(child)
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

  const edges: Array<Edge<EdgeData>> = []

  if (mode === 'interconnection') {
    for (const conn of edgeEls) {
      const source = conn.sourceNodeId || conn.sourceId
      const target = conn.targetNodeId || conn.targetId
      if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) continue
      const sourcePort = byId(model, conn.sourceId)
      const targetPort = byId(model, conn.targetId)
      const sourceMatch = sourcePort
        ? portsByNode.get(source)?.find((p) => p.id === sourcePort.id)
        : undefined
      const targetMatch = targetPort
        ? portsByNode.get(target)?.find((p) => p.id === targetPort.id)
        : undefined
      const name = conn.kind === 'connection' && conn.spans.name.start === conn.spans.name.end
        ? conn.shortName : conn.name
      const label = [name, !sourceMatch && sourcePort?.kind === 'port' && conn.source,
        !targetMatch && targetPort?.kind === 'port' && conn.target].filter(Boolean).join(' · ')
      edges.push({
        id: conn.id,
        source,
        target,
        sourceHandle: sourceMatch ? `${sourceMatch.id}-out` : `${source}-generic-out`,
        targetHandle: targetMatch ? `${targetMatch.id}-in` : `${target}-generic-in`,
        type: 'relationship',
        label,
        data: { connection: conn, kind: conn.kind },
      })
    }
  } else {
    for (const child of childrenOf(model, scope.id)) {
      if (!nodeIds.has(child.id)) continue
      edges.push({
        id: `contain-${child.id}`,
        source: scope.id,
        target: child.id,
        type: 'relationship',
        data: { kind: 'containment' },
      })
    }
  }

  return { nodes, edges }
}

export default function DiagramView({
  split,
  navigation,
  historyControls,
  requestedScope,
  onOpenElementDiagram,
  paletteRevision, file,
  selectedId,
  onSelect,
  onAddElement,
  onAddConnection,
  onOpenAddConnection,
  onNotice,
}: Props) {
  const model = file.model
  const [glyphs, setGlyphs] = useState<Record<string, SceneNode>>({})
  const [glyphError, setGlyphError] = useState('')
  const [glyphRevision, setGlyphRevision] = useState('')
  useEffect(() => {
    const stop = new AbortController();setGlyphError('')
    fetch(`${API_BASE}/files/${encodeURIComponent(file.name)}/diagram/nodes`, {signal:stop.signal,headers:{'If-Match':file.revision}})
      .then(async response => { if (!response.ok) throw new Error((await response.json()).error || 'Could not draw model elements'); return response.json() })
      .then(value => {if (!stop.signal.aborted) { setGlyphs(value); setGlyphRevision(file.revision) }})
      .catch(error => {if (!stop.signal.aborted) { setGlyphError(error.message); setGlyphRevision(file.revision) }})
    return () => stop.abort()
  }, [file.name,file.revision,paletteRevision])
  const [mode, setMode] = useState<DiagramMode>('interconnection')
  const [scopeId, setScopeId] = useState('')
  const [layout, setLayout] = useState<LayoutFile>({})
  const [layoutLoaded, setLayoutLoaded] = useState(false)
  const [fitRevision, setFitRevision] = useState(0)
  const [manual, setManual] = useState<{ key: string; positions: Record<string, DropPosition>; routes?: RouteEdits }>()
  const scopeKey = JSON.stringify([file.name, scopeId, mode])
  useEffect(() => {
    setManual(current => current?.key === scopeKey ? current : undefined)
  }, [scopeKey])
  useEffect(() => {
    if (scopeId && layoutLoaded && glyphRevision === file.revision) setFitRevision(revision => revision + 1)
  }, [scopeKey, scopeId, layoutLoaded, glyphRevision, file.revision])
  const [nodes, setNodes, onNodesChange] = useNodesState<DiagramFlowNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  const scopes = useMemo(() => {
    const scopes = diagramScopes(model)
    const requested = byId(model, requestedScope?.element)
    if (requested?.kind === 'part' && !scopes.some(item => item.id === requested.id)) return [...scopes, requested]
    return scopes
  }, [model, requestedScope])
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
    if (!requestedScope || !scopes.some(item => item.id === requestedScope.element)) return
    setScopeId(requestedScope.element)
    const hasRelationships = model.elements.some(item => item.parentId === requestedScope.element &&
      ['connection', 'flow', 'dependency'].includes(item.kind))
    setMode(hasRelationships ? 'interconnection' : 'containment')
  }, [requestedScope, scopes, model])

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
    if (!scope) return { nodes: [], edges: [] }
    const result = buildGraph(model, scope, mode)
    return {...result,nodes:result.nodes.map(node => ({...node,height:glyphs[node.id]?.height,width:glyphs[node.id]?.width}))}
  }, [model, scope, mode, glyphs])

  const persistNotes = useCallback(
    (notes: Record<string, DiagramNote>) => {
      const next: LayoutFile = { ...layout, notes }
      setLayout(next)
      putLayout(file.name, next).catch(() => {
        /* non-fatal: layout is a convenience */
      })
    },
    [file.name, layout],
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

  const highlightedId = useMemo(
    () => visibleOwner(model, selectedId, new Set(graph.nodes.map(node => node.id))),
    [model, selectedId, graph.nodes],
  )

  const saved = layout.version === LAYOUT_VERSION && scope ? layout.scopes?.[scope.id]?.[mode] : undefined
  const automaticPositions = useMemo(() => computeLayout(graph.nodes, graph.edges, mode), [graph, mode])
  const positions = useMemo(() => manual?.key === scopeKey
    ? { ...automaticPositions, ...manual.positions } : automaticPositions, [automaticPositions, manual, scopeKey])
  const manualRoutes = manual?.key === scopeKey ? manual.routes : undefined
  const savedRoutes = layout.version === LAYOUT_VERSION && scope ? layout.routes?.[scope.id]?.[mode] : undefined
  const connectorLabels = scope ? layout.connectorLabels?.[scope.id]?.[mode] : undefined
  const visibleNotes = useMemo(() => {
    const ids = new Set(graph.nodes.map(node => node.id))
    return Object.values(layout.notes ?? {}).filter(note => ids.has(note.targetId))
  }, [graph.nodes, layout.notes])

  const routeBoxes = useMemo(() => {
    const boxes = graph.nodes.flatMap(node => {
      const glyph = glyphs[node.id], position = positions[node.id]
      return glyph && position ? [[node.id, { ...position, width: glyph.width, height: glyph.height, glyph }]] as const : []
    })
    return new Map(boxes)
  }, [graph.nodes, glyphs, positions])
  const annotations = useMemo(() => visibleNotes.map(note => ({ x: note.x, y: note.y, width: NOTE_W, height: NOTE_H })), [visibleNotes])
  const routedEdges = useMemo(() => routeModelEdges(graph.edges, routeBoxes, annotations, manualRoutes, connectorLabels),
    [graph.edges, routeBoxes, annotations, manualRoutes, connectorLabels])

  // Rebuild React Flow nodes whenever the graph or saved layout changes.
  useEffect(() => {
    if (!scope) {
      setNodes([])
      setEdges([])
      return
    }
    const genericSources = new Set<string>()
    const genericTargets = new Set<string>()
    for (const e of graph.edges) {
      if (String(e.sourceHandle ?? '').endsWith('-generic-out')) genericSources.add(e.source)
      if (String(e.targetHandle ?? '').endsWith('-generic-in')) genericTargets.add(e.target)
    }

    for (const note of visibleNotes) genericTargets.add(note.targetId)

    const rfNodes: SysmlFlowNode[] = graph.nodes.map((n) => ({
      id: n.id,
      type: 'sysml',
      position: positions[n.id] ?? { x: 0, y: 0 },
      data: {
        glyph: glyphs[n.id],
        element: n.element,
        ports: n.ports,
        attributes: n.attributes,
        doc: n.doc,
        diagnostics: n.diagnostics,
        selected: n.id === highlightedId,
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
    setEdges([...routedEdges.map(edge => ({ ...edge, selected: edge.id === selectedId })), ...noteEdges])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, visibleNotes, positions, routedEdges, scope?.id, selectedId, highlightedId, onNoteChange, onNoteDelete, model, glyphs])

  // Keep selection styling in sync without resetting positions.
  useEffect(() => {
    setNodes((current) =>
      current.map((n) => {
        if (n.type === 'note') return n
        return n.data.selected === (n.id === highlightedId)
          ? n
          : { ...n, data: { ...n.data, selected: n.id === highlightedId } }
      }),
    )
  }, [highlightedId, setNodes])

  const persistLayout = useCallback(
    (positions: Record<string, DropPosition>, targetScope = scope?.id, routes?: RouteEdits) => {
      if (!targetScope) return
      const baseScopes = layout.version === LAYOUT_VERSION ? layout.scopes ?? {} : {}
      const next: LayoutFile = {
        ...layout,
        version: LAYOUT_VERSION,
        ...(routes && { routes: { ...layout.routes,
          [targetScope]: { ...layout.routes?.[targetScope], [mode]: routes },
        } }),
        scopes: {
          ...baseScopes,
          [targetScope]: {
            ...(baseScopes[targetScope] ?? {}),
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
          const position = n.id === node.id ? node.position : n.position
          positions[n.id] = { x: Math.round(position.x), y: Math.round(position.y) }
        }
      }
      setManual({ key: scopeKey, positions, routes: manualRoutes })
      persistLayout(positions)
    },
    [nodes, layout.notes, persistNotes, persistLayout, scopeKey, manualRoutes],
  )

  const rerouteConnector = (id: string, points: Point[]) => {
    const edge = routedEdges.find(item => item.id === id)
    const before = edge?.data?.points as Point[] | undefined
    const movable = edge?.data?.movableAttachments as { source: boolean; target: boolean } | undefined
    const from = edge && routeBoxes.get(edge.source), to = edge && routeBoxes.get(edge.target)
    if (!before || !from || !to || !clearConnector(points, [...routeBoxes.values(), ...annotations]) ||
        (movable?.source ? !attachmentSide(points[0], from) : !samePoint(points[0], before[0])) ||
        (movable?.target ? !attachmentSide(points.at(-1)!, to) : !samePoint(points.at(-1), before.at(-1)))) {
      onNotice?.('The connector must stay clear of diagram boxes.')
      return
    }
    const routes = { ...manualRoutes, [id]: points }
    setManual({ key: scopeKey, positions, routes })
    persistLayout(positions, scope?.id, routes)
  }

  const moveConnectorLabel = (id: string, position: Point) => {
    if (!scope) return
    const next = { ...layout, connectorLabels: { ...layout.connectorLabels,
      [scope.id]: { ...layout.connectorLabels?.[scope.id], [mode]: { ...connectorLabels, [id]: position } },
    } }
    setLayout(next)
    putLayout(file.name, next).catch(() => onNotice?.('Could not save the connector label position.'))
  }

  const autoLayout = () => {
    setManual(undefined)
    setFitRevision(revision => revision + 1)
  }

  const placeElement = (id: string, point: DropPosition) => {
    const element = byId(model, id)
    if (!element || !canPlaceElement(element)) return
    const displayed = graph.nodes.some(node => node.id === id)
    const owner = displayed ? scope : scopes.find(candidate => candidate.id === element.parentId)
    if (!owner) {
      onNotice?.('Open a saved view to place this element alongside a different model scope.')
      return
    }
    const geometry = displayed ? positions : layout.scopes?.[owner.id]?.[mode] ?? {}
    const placed = { ...geometry, [id]: { x: Math.round(point.x), y: Math.round(point.y) } }
    setManual({ key: JSON.stringify([file.name, owner.id, mode]), positions: placed, routes: displayed ? manualRoutes : undefined })
    persistLayout(placed, owner.id)
    if (owner.id !== scope?.id) setScopeId(owner.id)
    onSelect(id)
  }

  const handleConnect = async (params: Connection) => {
    const created = await connectModelPorts(model, params, onAddConnection)
    if (created && mode !== 'interconnection') {
      setMode('interconnection')
      setFitRevision(revision => revision + 1)
    }
  }

  if (!scope) {
    return (
      <>
      <DiagramToolbar navigation={navigation} historyControls={historyControls} />
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
      </>
    )
  }

  return (
    <>
      <DiagramToolbar navigation={navigation} historyControls={historyControls} onAutoLayout={autoLayout} scopeControls={<>
        <select className="select input-sm diagram-scope" aria-label="Model scope" value={scopeId} title={scope.qname}
          onChange={e => setScopeId(e.target.value)}>
          {scopes.map(item => <option key={item.id} value={item.id}>{item.qname}</option>)}
        </select>
        <select className="select input-sm diagram-projection" aria-label="Diagram projection" value={mode}
          onChange={e => setMode(e.target.value as DiagramMode)}>
          <option value="interconnection">Interconnection</option>
          <option value="containment">Containment</option>
        </select>
      </>}>
          <button onClick={() => onAddElement(scope.id)}>Add part</button>
          <button onClick={() => onOpenAddConnection(scope.id)}>Add connection</button>
          <button onClick={addNote} disabled={graph.nodes.length === 0}>Add note</button>
          {saved && <button onClick={() => {
            setManual({ key: scopeKey, positions: saved, routes: savedRoutes })
            setFitRevision(revision => revision + 1)
          }}>{savedRoutes && Object.keys(savedRoutes).length ? 'Restore saved positions and routes' : 'Restore saved positions'}</button>}
      </DiagramToolbar>

      {glyphError && <p role="alert">{glyphError}</p>}
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
            <DiagramCanvas onConnectorRouteChange={rerouteConnector} onConnectorLabelChange={moveConnectorLabel}
              elementDrop={{ file: file.name, place: placeElement }} split={split} frameTitle={displayName(scope)} fitRevision={fitRevision} includeRoutes
              nodes={nodes}
              edges={edges}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onClearSelection={() => onSelect(null)}
              onNodeClick={(_, node) => onSelect(node.type === 'sysml' ? node.id : null)}
              onNodeDoubleClick={(event, node) => {
                if (node.type !== 'sysml' || (event.target as Element).closest('button, .react-flow__handle')) return
                onOpenElementDiagram?.(node.id)
              }}
              onEdgeClick={(_, edge) => {
                const data = edge.data as EdgeData | undefined
                onSelect(data?.connection?.id ?? null)
              }}
              onNodeDragStop={onNodeDragStop}
              onConnect={handleConnect}
            />
        )}
      </div>
    </>
  )
}
