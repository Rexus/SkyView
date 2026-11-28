import { useEffect, useRef, useState } from 'react'
import { useReactFlow } from '@xyflow/react'
import { labelBounds, labelLeader } from '../relationshipLabels'
import type { RouteSegment } from '../sharedRouting'
import type { Point } from '../sharedViews'

export default function ConnectorLabel({ text, position, points, leader, onChange }: {
  text: string
  position: Point
  points?: Point[]
  leader?: RouteSegment
  onChange?: (position: Point) => void
}) {
  const flow = useReactFlow()
  const drag = useRef<{ id: number; x: number; y: number } | undefined>(undefined)
  const [preview, setPreview] = useState<Point>()
  const cancel = () => { drag.current = undefined; setPreview(undefined) }
  const editable = !!onChange
  useEffect(() => { if (!editable) cancel() }, [editable])
  const offset = (x: number, y: number): Point => {
    const start = drag.current
    const zoom = flow.getZoom()
    return start ? [Math.round(position[0] + (x - start.x) / zoom),
      Math.round(position[1] + (y - start.y) / zoom)] : position
  }
  const [x, y] = preview ?? position
  const line = preview && points ? labelLeader(points, labelBounds(text, preview)) : leader
  const directions: Record<string, Point> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }
  return <>
    {line && <path className="relationship-label-leader" d={`M${line[0].join(' ')} L${line[1].join(' ')}`} />}
    <text className={editable ? 'relationship-label connector-label-editable nodrag nopan' : 'relationship-label'}
      x={x} y={y} role={editable ? 'button' : undefined} tabIndex={editable ? 0 : undefined}
      aria-label={editable ? `Move connector label ${text}` : undefined}
      onPointerDown={event => {
        if (!editable || event.button !== 0) return
        event.stopPropagation()
        event.currentTarget.focus()
        event.currentTarget.setPointerCapture(event.pointerId)
        drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY }
      }}
      onPointerMove={event => {
        if (drag.current?.id === event.pointerId) setPreview(offset(event.clientX, event.clientY))
      }}
      onPointerUp={event => {
        const start = drag.current
        if (start?.id !== event.pointerId) return
        if (Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 3) {
          onChange?.(offset(event.clientX, event.clientY))
        }
        cancel()
      }}
      onLostPointerCapture={cancel}
      onClick={event => { if (editable) event.stopPropagation() }}
      onKeyDown={event => {
        const direction = directions[event.key]
        if (!direction || !onChange) return
        event.preventDefault()
        event.stopPropagation()
        const step = event.shiftKey ? 12 : 3
        onChange([position[0] + step * direction[0], position[1] + step * direction[1]])
      }}>
      {text}
    </text>
  </>
}
