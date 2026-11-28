import { useId, type CSSProperties } from 'react'
import { getSmoothStepPath, type EdgeProps } from '@xyflow/react'

type Point = [number, number]
type RelationshipGeometry = {
  kind: string; points?: Point[]; labelPosition?: Point; anchors?: [Point, Point]; gaps?: Point[]; labelLeader?: Point
}

function pathBounds(points: Point[]) {
  const xs = points.map(([x]) => x), ys = points.map(([, y]) => y)
  const x = Math.min(...xs), y = Math.min(...ys), padding = 22
  return { x: x - padding, y: y - padding, width: Math.max(...xs) - x + padding * 2, height: Math.max(...ys) - y + padding * 2 }
}

export default function RelationshipEdge(props: EdgeProps) {
  const marker = useId()
  const geometry = props.data as RelationshipGeometry
  const [automaticPath, labelX, labelY] = getSmoothStepPath({ ...props, borderRadius: 0 })
  const points = geometry.points
  const matches = (point: Point | undefined, x: number, y: number) =>
    point && Math.abs(point[0] - x) <= 10 && Math.abs(point[1] - y) <= 10
  const useRoute = points && points.length >= 2 && (!geometry.anchors ||
    (matches(geometry.anchors[0], props.sourceX, props.sourceY) && matches(geometry.anchors[1], props.targetX, props.targetY)))
  const gaps = useRoute ? geometry.gaps : undefined
  const maskBounds = gaps?.length && points ? pathBounds(points) : undefined
  const leader = useRoute ? geometry.labelLeader : undefined
  const path = useRoute
    ? points.map(([x, y], index) => `${index ? 'L' : 'M'}${x} ${y}`).join(' ')
    : automaticPath
  const [x, y] = (useRoute && geometry.labelPosition) || [labelX, labelY - 6]
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
      {leader && <path className="relationship-label-leader" d={`M${leader.join(' ')} V${y - 12}`} />}
      <path className="react-flow__edge-interaction" d={path} stroke="transparent" strokeWidth={18} fill="none" />
      {props.label && <text className="relationship-label" x={x} y={y}>{props.label}</text>}
    </g>
  )
}
