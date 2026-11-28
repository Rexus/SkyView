import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { getSmoothStepPath, useReactFlow, type EdgeProps } from '@xyflow/react'
import { movableSegment, shiftConnectorSegment, type ChangeConnectorLabel, type ChangeConnectorRoute, type ConnectorGeometry } from '../connectorRoutes'
import { readConnectorGeometry } from '../diagramConnectorGeometry'
import { labelBounds, labelLeader, placeRouteLabels } from '../relationshipLabels'
import type { RouteSegment } from '../sharedRouting'
import ConnectorAttachments from './ConnectorAttachments'
import ConnectorLabel from './ConnectorLabel'

type Point = [number, number]
type RelationshipGeometry = {
  kind: string; points?: Point[]; labelPosition?: Point; anchors?: [Point, Point]; gaps?: Point[]; labelLeader?: RouteSegment
  labelMoved?: boolean; onRouteChange?: ChangeConnectorRoute; onLabelChange?: ChangeConnectorLabel
  movableAttachments?: { source: boolean; target: boolean }
}

function pathBounds(points: Point[]) {
  const xs = points.map(([x]) => x), ys = points.map(([, y]) => y)
  const x = Math.min(...xs), y = Math.min(...ys), padding = 22
  return { x: x - padding, y: y - padding, width: Math.max(...xs) - x + padding * 2, height: Math.max(...ys) - y + padding * 2 }
}

export default function RelationshipEdge(props: EdgeProps) {
  const marker = useId()
  const flow = useReactFlow()
  const [preview, setPreview] = useState<Point[]>()
  const drag = useRef<{ id: number; start: number; index: number; geometry: ConnectorGeometry;
    offset?: number; aligned?: Point; straight?: boolean } | undefined>(undefined)
  useEffect(() => {
    if (!props.selected) { drag.current = undefined; setPreview(undefined) }
  }, [props.selected])
  const geometry = props.data as RelationshipGeometry
  const [automaticPath, labelX, labelY] = getSmoothStepPath({ ...props, borderRadius: 0 })
  const points = geometry.points
  const matches = (point: Point | undefined, x: number, y: number) =>
    point && Math.abs(point[0] - x) <= 10 && Math.abs(point[1] - y) <= 10
  const useRoute = points && points.length >= 2 && (!geometry.anchors ||
    (matches(geometry.anchors[0], props.sourceX, props.sourceY) && matches(geometry.anchors[1], props.targetX, props.targetY)))
  const gaps = useRoute && !preview ? geometry.gaps : undefined
  const maskBounds = gaps?.length && points ? pathBounds(points) : undefined
  const display = useRoute ? preview ?? points : undefined
  const path = display ? display.map(([x, y], index) => `${index ? 'L' : 'M'}${x} ${y}`).join(' ') : automaticPath
  const text = String(props.label ?? '')
  const movedLabel = preview && !geometry.labelMoved && placeRouteLabels([{ points: preview, text }], [])[0]
  const [x, y] = (movedLabel && movedLabel.position) || (useRoute && geometry.labelPosition) || [labelX, labelY - 6]
  const leader = preview && geometry.labelMoved ? labelLeader(preview, labelBounds(text, [x, y]))
    : preview ? movedLabel && movedLabel.leader || undefined : useRoute ? geometry.labelLeader : undefined
  const save = (next: Point[]) => {
    if (next !== points) geometry.onRouteChange?.(props.id, next)
  }
  const markers = {
    '--flow-end': `url(#${marker}-flow)`,
    '--dependency-end': `url(#${marker}-dependency)`,
    '--ownership-start': `url(#${marker}-ownership)`,
  } as CSSProperties
  return (
    <g className="diagram-relationship" data-selected={props.selected || undefined} data-kind={geometry.kind} style={markers}>
      <defs>
        {geometry.kind === 'flow' && <marker id={`${marker}-flow`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path className="relationship-arrow" d="M0 0 L8 4 L0 8 Z" />
        </marker>}
        {geometry.kind === 'dependency' && <marker id={`${marker}-dependency`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path className="relationship-open-arrow" d="M1 1 L7 4 L1 7" />
        </marker>}
        {geometry.kind === 'containment' && <marker id={`${marker}-ownership`} markerWidth="9" markerHeight="9" refX="1" refY="4.5" orient="auto">
          <path className="relationship-ownership" d="M1 4.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0 M1 4.5H8 M4.5 1V8" />
        </marker>}
        {maskBounds && <mask id={`${marker}-crossings`} maskUnits="userSpaceOnUse" {...maskBounds}>
          <path d={path} stroke="white" strokeWidth={40} strokeLinecap="round" strokeLinejoin="round" fill="none" />
          {gaps?.map(([cx, cy]) => <circle key={`${cx},${cy}`} cx={cx} cy={cy} r={4.5} fill="black" />)}
        </mask>}
      </defs>
      <path className="relationship-line" d={path} mask={gaps?.length ? `url(#${marker}-crossings)` : undefined} />
      <path className="react-flow__edge-interaction" d={path} stroke="transparent" strokeWidth={18} fill="none" />
      {text && <ConnectorLabel text={text} position={[x, y]} points={display} leader={leader}
        onChange={props.selected && useRoute && geometry.onLabelChange
          ? position => geometry.onLabelChange?.(props.id, position) : undefined} />}
      {props.selected && useRoute && geometry.onRouteChange && points.slice(1).map((b, i) => {
        const a = points[i]
        const active = drag.current
        if (!movableSegment(a, b) || (active && active.index !== i)) return null
        const horizontal = a[1] === b[1]
        const axis = horizontal ? 'clientY' : 'clientX'
        const move = (offset: number, context: ConnectorGeometry, bypass: boolean) =>
          shiftConnectorSegment(points, i, offset, bypass ? 0 : Math.min(24, 8 / flow.getZoom()), context,
            !bypass && !!geometry.movableAttachments?.source && !!geometry.movableAttachments.target)
        const axisOffset = active?.offset ?? 0
        const aligned = active?.aligned
        const straight = active?.straight ? preview : undefined
        const cx = straight ? (straight[0][0] + straight[1][0]) / 2 : (a[0] + b[0]) / 2 + (horizontal ? 0 : axisOffset)
        const cy = straight ? (straight[0][1] + straight[1][1]) / 2 : (a[1] + b[1]) / 2 + (horizontal ? axisOffset : 0)
        return <g key={i}>
          {aligned && <g className="placement-guides"><line className="alignment" x1={aligned[0]} y1={aligned[1]}
            x2={cx} y2={cy} vectorEffect="non-scaling-stroke" /></g>}
          <rect className="connector-route-handle nodrag nopan" data-axis={horizontal ? 'vertical' : 'horizontal'}
          x={cx - 5} y={cy - 5} width={10} height={10} rx={2} role="button" tabIndex={0}
          aria-label={`Move connector segment ${i + 1}`}
          onClick={event => event.stopPropagation()}
          onPointerDown={event => {
            if (event.button !== 0) return
            event.preventDefault(); event.stopPropagation()
            event.currentTarget.setPointerCapture(event.pointerId)
            drag.current = { id: event.pointerId, start: event[axis], index: i,
              geometry: readConnectorGeometry(flow, props.id, props.source, props.target) }
          }}
          onPointerMove={event => {
            const current = drag.current
            if (current?.id !== event.pointerId || current.index !== i) return
            const next = move(Math.round((event[axis] - current.start) / flow.getZoom()), current.geometry, event.altKey)
            current.offset = next.offset
            current.aligned = next.aligned
            current.straight = next.straight
            setPreview(next.points)
          }}
          onPointerUp={event => {
            const current = drag.current
            if (current?.id !== event.pointerId || current.index !== i) return
            event.stopPropagation()
            const next = move(Math.round((event[axis] - current.start) / flow.getZoom()), current.geometry, event.altKey)
            drag.current = undefined; setPreview(undefined)
            save(next.points)
          }}
          onLostPointerCapture={() => { drag.current = undefined; setPreview(undefined) }}
          onKeyDown={event => {
            const direction = event.key === (horizontal ? 'ArrowUp' : 'ArrowLeft') ? -1
              : event.key === (horizontal ? 'ArrowDown' : 'ArrowRight') ? 1 : 0
            if (!direction) return
            event.preventDefault(); event.stopPropagation()
            const context = readConnectorGeometry(flow, props.id, props.source, props.target)
            save(move(direction * (event.shiftKey ? 24 : 8), context, event.altKey).points)
          }} />
        </g>
      })}
      {props.selected && useRoute && geometry.onRouteChange && geometry.movableAttachments &&
        <ConnectorAttachments id={props.id} source={props.source} target={props.target} points={display ?? points}
          movable={geometry.movableAttachments} onChange={save} />}
    </g>
  )
}
