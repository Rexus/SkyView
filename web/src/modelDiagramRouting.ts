import type { Edge } from '@xyflow/react'
import type { SceneNode } from './diagramScene'
import { anchor, approachPoint, facingSides, routeSides, segments } from './sharedRouting.ts'
import type { RouteBox, RouteSegment, RouteSide } from './sharedRouting.ts'
import { isLabelPosition, placeRouteLabels } from './relationshipLabels.ts'
import type { Point } from './sharedViews'
import { alignConnectorEnds, attachmentSide, bestConnector, clearConnector, freeAttachment, routingBounds, samePoint, type LabelEdits, type RouteEdits } from './connectorRoutes.ts'

type NodeGeometry = RouteBox & { glyph: SceneNode }
type End = 'source' | 'target'
const sides: RouteSide[] = ['left', 'right', 'top', 'bottom']

export function genericHandle(node: string, end: End, side: RouteSide) {
  const usual = end === 'source' ? 'right' : 'left'
  const suffix = end === 'source' ? 'out' : 'in'
  return side === usual ? `${node}-generic-${suffix}` : `${node}-generic-${side}-${suffix}`
}

export const genericHandles = (node: string) => sides.flatMap(side =>
  (['source', 'target'] as const).map(type => ({ side, type, id: genericHandle(node, type, side) })),
)

function endpoint(node: string, box: NodeGeometry, handle: string | null | undefined, type: End, side: RouteSide, peer: NodeGeometry) {
  const port = box.glyph.ports.find(port => handle === `${port.id}-${type === 'source' ? 'out' : 'in'}`)
  if (handle && handle !== genericHandle(node, type, type === 'source' ? 'right' : 'left') && !port) return undefined
  const realSide = port ? type === 'source' ? 'right' : 'left' : side
  const vertical = realSide === 'left' || realSide === 'right'
  const base = anchor(box, realSide, port?.y)
  return {
    group: JSON.stringify([node, realSide, port?.id]), box, base, port, fixed: !!port, side: realSide,
    order: vertical ? peer.y + peer.height / 2 : peer.x + peer.width / 2,
    normal: realSide === 'right' || realSide === 'bottom' ? 1 : -1,
    handle: port ? handle! : genericHandle(node, type, side),
    points: approachPoint(base, realSide) as Point[],
  }
}

type Endpoint = NonNullable<ReturnType<typeof endpoint>>

function distribute(ends: Endpoint[]) {
  ends.sort((a, b) => a.order - b.order)
  for (const [index, end] of ends.entries()) {
    const offset = (index - (ends.length - 1) / 2) * Math.min(11, 44 / Math.max(1, ends.length - 1))
    if (!offset) continue
    const point = (normal: number, tangent: number): Point => [end.base[0] + end.normal * normal, end.base[1] + tangent]
    // Keep a real port's exact attachment. Short angled branches then separate
    // connections that have to leave the same symbol.
    end.points = [end.base, point(8, 0), point(8 + Math.abs(offset), offset), point(14 + Math.abs(offset), offset)]
  }
}

export function routeModelEdges(edges: Edge[], boxes: Map<string, NodeGeometry>, annotations: RouteBox[] = [], overrides: RouteEdits = {}, labelOverrides: LabelEdits = {}): Edge[] {
  const occupied: RouteSegment[] = []
  const used: Point[] = [...boxes.values()].flatMap(box => box.glyph.ports.flatMap(port =>
    [anchor(box, 'left', port.y), anchor(box, 'right', port.y)]))
  const obstacles = [...boxes.values(), ...annotations]
  const groups = new Map<string, Endpoint[]>()
  const ends = edges.map(edge => {
    const a = boxes.get(edge.source), b = boxes.get(edge.target)
    if (!a || !b) return undefined
    const [from, to] = a === b ? ['right', 'bottom'] as const : facingSides(a, b)
    const source = endpoint(edge.source, a, edge.sourceHandle, 'source', from, b)
    const target = endpoint(edge.target, b, edge.targetHandle, 'target', to, a)
    if (!source || !target) return undefined
    for (const end of [source, target]) {
      if (!end.port) continue
      const group = groups.get(end.group) ?? []
      group.push(end)
      groups.set(end.group, group)
    }
    return { source, target }
  })
  for (const group of groups.values()) distribute(group)
  const paths = ends.map((pair, i): Point[] => {
    const edge = edges[i], points = overrides[edge.id]
    if (!pair || !Array.isArray(points) || !clearConnector(points, obstacles)) return []
    const { source, target } = pair
    const from = attachmentSide(points[0], source.box), to = attachmentSide(points.at(-1)!, target.box)
    if (!from || !to || (source.port && !samePoint(points[0], source.base)) ||
        (target.port && !samePoint(points.at(-1), target.base))) return []
    ends[i] = {
      source: source.port ? source : endpoint(edge.source, source.box, edge.sourceHandle, 'source', from, target.box)!,
      target: target.port ? target : endpoint(edge.target, target.box, edge.targetHandle, 'target', to, source.box)!,
    }
    occupied.push(...orthogonalSegments(points))
    used.push(points[0], points.at(-1)!)
    return points
  })
  const order = ends.flatMap((pair, i) => pair ? [{ i, pair, distance: centerDistance(pair.source.box, pair.target.box) }] : [])
    .sort((a, b) => a.distance - b.distance)
  for (const { i, pair } of order) {
    if (paths[i].length) continue
    const edge = edges[i]
    const { source, target } = pair
    // Give shorter relationships the direct lane before routing longer branches.
    const sides = routeSides(source.box, target.box)
    const candidates = [pair, ...sides.map(([from, to]) => {
      const a = source.port ? source : endpoint(edge.source, source.box, edge.sourceHandle, 'source', from, target.box)!
      const b = target.port ? target : endpoint(edge.target, target.box, edge.targetHandle, 'target', to, source.box)!
      return { source: a, target: b }
    })]
    const reserve = (end: Endpoint) => {
      if (end.fixed) return end
      const point = freeAttachment(end.box, end.side, end.points[0], used)
      return point && { ...end, points: approachPoint(point, end.side) }
    }
    const options = candidates.flatMap(({ source, target }) => {
      const a = reserve(source), b = reserve(target)
      return a && b ? [...alignConnectorEnds(a, b, used), { source: a, target: b }] : []
    })
    const bounds = routingBounds(source.box, target.box)
    const local = obstacles.filter(box => box.x < bounds.x + bounds.width && box.x + box.width > bounds.x &&
      box.y < bounds.y + bounds.height && box.y + box.height > bounds.y)
    const best = bestConnector(options.map(ends => ({ ends, source: ends.source.points, target: ends.target.points })),
      local, bounds, occupied)
    if (!best) continue
    paths[i] = best.points
    ends[i] = best.pair.ends
    occupied.push(...orthogonalSegments(best.points))
    used.push(best.points[0], best.points.at(-1)!)
  }
  const labels = placeRouteLabels(paths.map((points, i) => ({
    points, text: String(edges[i].label ?? ''), fixed: labelOverrides[edges[i].id], showLeader: true,
  })), obstacles)
  const gaps = crossingGaps(paths)
  return edges.map((edge, i) => {
    const pair = ends[i]
    const points = paths[i]
    if (!pair || points.length < 2) return edge
    return { ...edge, sourceHandle: pair.source.handle, targetHandle: pair.target.handle, data: {
      ...edge.data, points, anchors: [pair.source.base, pair.target.base], gaps: gaps[i],
      movableAttachments: { source: !pair.source.port, target: !pair.target.port },
      labelPosition: labels[i]?.position, labelBounds: labels[i]?.bounds, labelLeader: labels[i]?.leader,
      labelMoved: isLabelPosition(labelOverrides[edge.id]),
    } }
  })
}

function centerDistance(a: RouteBox, b: RouteBox) {
 return Math.abs(a.x + a.width / 2 - b.x - b.width / 2) + Math.abs(a.y + a.height / 2 - b.y - b.height / 2)
}

const orthogonalSegments = (points: Point[]) => segments(points).filter(([a, b]) => a[0] === b[0] || a[1] === b[1])

function crossingGaps(paths: Point[][]): Point[][] {
  const vertical: { x: number; top: number; bottom: number; route: number }[] = []
  paths.forEach((points, route) => {
    for (const [[x, y], [u, v]] of segments(points)) {
      if (x === u && Math.abs(y - v) > 18) vertical.push({ x, top: Math.min(y, v), bottom: Math.max(y, v), route })
    }
  })
  vertical.sort((a, b) => a.x - b.x)
  return paths.map((points, route) => {
    const crossings: Point[] = []
    for (const [[x, y], [u, v]] of segments(points)) {
      if (y !== v || Math.abs(x - u) <= 18) continue
      const left = Math.min(x, u) + 9, right = Math.max(x, u) - 9
      let low = 0, high = vertical.length
      while (low < high) {
        const middle = (low + high) >>> 1
        if (vertical[middle].x < left) low = middle + 1
        else high = middle
      }
      for (let i = low; i < vertical.length && vertical[i].x <= right; i++) {
        const cross = vertical[i]
        if (cross.route !== route && cross.top + 9 < y && y < cross.bottom - 9 &&
          !crossings.some(([cx, cy]) => Math.abs(cx - cross.x) < 9 && cy === y)) crossings.push([cross.x, y])
      }
    }
    return crossings
  })
}
