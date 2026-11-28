import type { Edge } from '@xyflow/react'
import type { SceneNode } from './diagramScene'
import { anchor, facingSides, routeOrthogonal, segments } from './sharedRouting.ts'
import type { RouteBox, RouteSegment, RouteSide } from './sharedRouting.ts'
import { placeRouteLabels } from './relationshipLabels.ts'
import type { Point } from './sharedViews'

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
    group: JSON.stringify([node, realSide, port?.id]), box, base, vertical, port,
    order: vertical ? peer.y + peer.height / 2 : peer.x + peer.width / 2,
    normal: realSide === 'right' || realSide === 'bottom' ? 1 : -1,
    handle: port ? handle! : genericHandle(node, type, side),
    points: [] as Point[],
  }
}

type Endpoint = NonNullable<ReturnType<typeof endpoint>>

function distribute(ends: Endpoint[]) {
  ends.sort((a, b) => a.order - b.order)
  const { vertical, box, port } = ends[0]
  const extent = vertical ? box.height : box.width
  const step = ends.length > 1 ? Math.min(17, Math.max(0, extent - 16) / (ends.length - 1)) : 0
  const available = port || !vertical ? [] : Array.from({ length: Math.max(0, Math.floor(extent) - 15) }, (_, i) => i + 8)
    .filter(y => box.glyph.ports.every(p => Math.abs(p.y - y) >= 8))
  const reserved = new Set<number>()
  for (const [index, end] of ends.entries()) {
    let offset = (index - (ends.length - 1) / 2) * (port ? Math.min(11, 44 / Math.max(1, ends.length - 1)) : step)
    if (available.length && (ends.length > 1 || box.glyph.ports.some(p => Math.abs(p.y - extent / 2) < 8))) {
      const desired = extent / 2 + offset
      const slot = available.reduce((best, y) => !reserved.has(y) && Math.abs(y - desired) < Math.abs(best - desired) ? y : best, Infinity)
      if (Number.isFinite(slot)) { reserved.add(slot); offset = slot - extent / 2 }
    }
    const point = (normal: number, tangent: number): Point => vertical
      ? [end.base[0] + end.normal * normal, end.base[1] + tangent]
      : [end.base[0] + tangent, end.base[1] + end.normal * normal]
    // Keep a real port's exact attachment. Short angled branches then separate
    // connections that have to leave the same symbol.
    end.points = port && offset !== 0
      ? [end.base, point(8, 0), point(8 + Math.abs(offset), offset), point(14 + Math.abs(offset), offset)]
      : [point(0, offset), point(12, offset)]
  }
}

export function routeModelEdges(edges: Edge[], boxes: Map<string, NodeGeometry>, annotations: RouteBox[] = []): Edge[] {
  const occupied: RouteSegment[] = []
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
      const group = groups.get(end.group) ?? []
      group.push(end)
      groups.set(end.group, group)
    }
    return { source, target }
  })
  for (const group of groups.values()) distribute(group)
  const paths = ends.map(pair => {
    if (!pair) return []
    const { source, target } = pair
    const start = source.points.at(-1)!, end = target.points.at(-1)!
    const padding = 104
    const x = Math.min(start[0], end[0]) - padding, right = Math.max(start[0], end[0]) + padding
    const y = Math.min(start[1], end[1]) - padding, bottom = Math.max(start[1], end[1]) + padding
    const local = obstacles.filter(box => box.x < right && box.x + box.width > x && box.y < bottom && box.y + box.height > y)
    try {
      const track = routeOrthogonal(start, end, local, { x, y, width: right - x, height: bottom - y }, occupied, 4000)
      const points = [...source.points.slice(0, -1), ...track, ...target.points.slice(0, -1).reverse()]
      occupied.push(...segments(points).filter(([a, b]) => a[0] === b[0] || a[1] === b[1]))
      return points
    } catch {
      // Overlapping hand-placed cards can leave no legal path. Keep the edge
      // interactive through React Flow's fallback so the layout can be repaired.
      return []
    }
  })
  const labels = placeRouteLabels(paths.map((points, i) => ({ points, text: String(edges[i].label ?? '') })), obstacles)
  const gaps = crossingGaps(paths)
  return edges.map((edge, i) => {
    const pair = ends[i]
    const points = paths[i]
    if (!pair || points.length < 2) return edge
    return { ...edge, sourceHandle: pair.source.handle, targetHandle: pair.target.handle, data: {
      ...edge.data, points, anchors: [pair.source.base, pair.target.base], gaps: gaps[i],
      labelPosition: labels[i]?.position, labelBounds: labels[i]?.bounds, labelLeader: labels[i]?.leader,
    } }
  })
}

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
