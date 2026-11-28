import type { Edge } from '@xyflow/react'
import type { SceneNode } from './diagramScene'
import { anchor, facingSides, routeLabel, routeOrthogonal, segments } from './sharedRouting.ts'
import type { RouteBox, RouteSegment, RouteSide } from './sharedRouting.ts'
import type { Point } from './sharedViews'

type NodeGeometry = RouteBox & { glyph: SceneNode }
const sides: RouteSide[] = ['left', 'right', 'top', 'bottom']

export function genericHandle(node: string, end: 'source' | 'target', side: RouteSide) {
  const usual = end === 'source' ? 'right' : 'left'
  const suffix = end === 'source' ? 'out' : 'in'
  return side === usual ? `${node}-generic-${suffix}` : `${node}-generic-${side}-${suffix}`
}

export const genericHandles = (node: string) => sides.flatMap(side =>
  (['source', 'target'] as const).map(type => ({ side, type, id: genericHandle(node, type, side) })),
)

function endpoint(node: string, box: NodeGeometry, handle: string | null | undefined, type: 'source' | 'target', side: RouteSide) {
  const port = box.glyph.ports.find(port => handle === `${port.id}-${type === 'source' ? 'out' : 'in'}`)
  const suffix = type === 'source' ? 'out' : 'in'
  const ordinary = genericHandle(node, type, suffix === 'out' ? 'right' : 'left')
  if (handle && handle !== ordinary && !port) return undefined
  const realSide = port ? type === 'source' ? 'right' : 'left' : side
  const point = anchor(box, realSide, port?.y)
  const [x, y] = point
  const step = 12
  const stub: Point = [
    x + (realSide === 'left' ? -step : realSide === 'right' ? step : 0),
    y + (realSide === 'top' ? -step : realSide === 'bottom' ? step : 0),
  ]
  return { point, stub, handle: port ? handle! : genericHandle(node, type, side) }
}

export function routeModelEdges(edges: Edge[], boxes: Map<string, NodeGeometry>): Edge[] {
  const occupied: RouteSegment[] = []
  const obstacles = [...boxes.values()]
  return edges.map(edge => {
    const a = boxes.get(edge.source), b = boxes.get(edge.target)
    if (!a || !b) return edge
    const [from, to] = a === b ? ['right', 'bottom'] as const : facingSides(a, b)
    const source = endpoint(edge.source, a, edge.sourceHandle, 'source', from)
    const target = endpoint(edge.target, b, edge.targetHandle, 'target', to)
    if (!source || !target) return edge
    const [sx, sy] = source.stub, [tx, ty] = target.stub
    const padding = 84
    const x = Math.min(sx, tx) - padding, right = Math.max(sx, tx) + padding
    const y = Math.min(sy, ty) - padding, bottom = Math.max(sy, ty) + padding
    const local = obstacles.filter(box => box.x < right && box.x + box.width > x && box.y < bottom && box.y + box.height > y)
    const linked = { ...edge, sourceHandle: source.handle, targetHandle: target.handle }
    try {
      const track = routeOrthogonal(source.stub, target.stub, local, { x, y, width: right - x, height: bottom - y }, occupied, 4000)
      occupied.push(...segments(track))
      const points = [source.point, ...track, target.point]
      return { ...linked, data: { ...edge.data, points, labelPosition: routeLabel(points), followsHandles: true } }
    } catch {
      // A freehand layout can overlap or put the endpoints outside the routing area.
      // React Flow still draws the connection so it can be selected and repaired.
      return linked
    }
  })
}
