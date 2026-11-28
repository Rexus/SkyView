import { useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { attachmentSide, nearestAttachment, reattachConnector, snapConnectorAttachment, tangentAxis } from '../connectorRoutes'
import { anchor, approachPoint, type RouteSide } from '../sharedRouting'
import type { Point } from '../sharedViews'
import { readConnectorGeometry } from '../diagramConnectorGeometry'
import type { ConnectorGeometry } from '../connectorRoutes'

type End = 'source' | 'target'
type Props = {
  source: string
  target: string
  id: string
  points: Point[]
  movable: { source: boolean; target: boolean }
  onChange: (points: Point[]) => void
}

export default function ConnectorAttachments({ source, target, id, points, movable, onChange }: Props) {
  const flow = useReactFlow()
  const [preview, setPreview] = useState<{ end: End; point: Point; aligned?: Point }>()
  const drag = useRef<{ end: End; pointer: number; x: number; y: number; geometry: ConnectorGeometry } | undefined>(undefined)
  const boxFor = (end: End) => flow.getNodesBounds([end === 'source' ? source : target])
  const snap = (end: End, point: Point, bypass: boolean, geometry: ConnectorGeometry) => {
    const box = geometry[end], side = attachmentSide(point, box)
    const opposite = end === 'source' ? geometry.target : geometry.source
    const other = end === 'source' ? points.at(-1)! : points[0]
    const otherSide = attachmentSide(other, opposite)
    const peer = side && otherSide && side !== otherSide && tangentAxis(side) === tangentAxis(otherSide) ? other : undefined
    return snapConnectorAttachment(point, box, peer, geometry.used, bypass ? 0 : Math.min(24, 8 / flow.getZoom()))
  }
  const world = (x: number, y: number): Point => {
    const at = flow.screenToFlowPosition({ x, y })
    return [at.x, at.y]
  }
  const apply = (end: End, point: Point, geometry: ConnectorGeometry) => {
    const { source, target, obstacles, occupied } = geometry
    onChange(reattachConnector(points, source, target, end, point, obstacles, occupied) ?? [])
  }
  const cancel = () => { drag.current = undefined; setPreview(undefined) }
  const keyboardSides: Record<string, RouteSide> = {
    ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'top', ArrowDown: 'bottom',
  }
  return <>{(['source', 'target'] as const).map(end => {
    if (!movable[end]) return null
    const box = boxFor(end)
    const original = end === 'source' ? points[0] : points.at(-1)!
    const shown = preview?.end === end ? preview.point : original
    const side = attachmentSide(shown, box)
    if (!side) return null
    const [, outside] = approachPoint(shown, side)
    const aligned = preview?.end === end ? preview.aligned : undefined
    return <g key={end}>
      {aligned && <g className="placement-guides"><line className="alignment" x1={shown[0]} y1={shown[1]}
        x2={aligned[0]} y2={aligned[1]} vectorEffect="non-scaling-stroke" /></g>}
      <circle className="connector-route-handle connector-attachment nodrag nopan"
      cx={(shown[0] + outside[0]) / 2} cy={(shown[1] + outside[1]) / 2} r={5}
      role="button" tabIndex={0} aria-label={end === 'source' ? 'Move connector start attachment' : 'Move connector end attachment'}
      onClick={event => event.stopPropagation()}
      onPointerDown={event => {
        if (event.button !== 0) return
        event.preventDefault(); event.stopPropagation()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { end, pointer: event.pointerId, x: event.clientX, y: event.clientY,
          geometry: readConnectorGeometry(flow, id, source, target) }
      }}
      onPointerMove={event => {
        if (drag.current?.pointer !== event.pointerId || drag.current.end !== end) return
        const desired = nearestAttachment(world(event.clientX, event.clientY), box)
        const next = snap(end, desired, event.altKey, drag.current.geometry)
        setPreview(next && { end, ...next })
      }}
      onPointerUp={event => {
        const start = drag.current
        if (start?.pointer !== event.pointerId || start.end !== end) return
        event.stopPropagation()
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 3) {
          const next = snap(end, nearestAttachment(world(event.clientX, event.clientY), box), event.altKey, start.geometry)
          if (next) apply(end, next.point, start.geometry)
        }
        cancel()
      }}
      onLostPointerCapture={cancel}
      onKeyDown={event => {
        const next = keyboardSides[event.key]
        if (!next) return
        event.preventDefault(); event.stopPropagation()
        const geometry = readConnectorGeometry(flow, id, source, target)
        const desired = snap(end, anchor(box, next), false, geometry)
        if (desired) apply(end, desired.point, geometry)
      }}>
      <title>Drag to another side of the box</title>
      </circle>
    </g>
  })}</>
}
