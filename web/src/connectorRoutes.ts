import { anchor, approachPoint, blocked, compactRoute, routeCost, routeOrthogonal, segments } from './sharedRouting.ts'
import type { RouteBox, RouteSegment, RouteSide } from './sharedRouting.ts'
import type { Point } from './sharedViews.ts'

export type RouteEdits = Record<string, Point[]>
export type ChangeConnectorRoute = (id: string, points: Point[]) => void
export type LabelEdits = Record<string, Point>
export type ChangeConnectorLabel = (id: string, position: Point) => void

export const samePoint = (a: Point | undefined, b: Point | undefined) =>
  !!a && !!b && a[0] === b[0] && a[1] === b[1]

export function movableSegment(a: Point, b: Point) {
  return (a[0] === b[0] && Math.abs(a[1] - b[1]) >= 24) ||
    (a[1] === b[1] && Math.abs(a[0] - b[0]) >= 24)
}

/** Move a leg across its axis and retain the approach to each native attachment. */
export function slideSegment(points: Point[], index: number, distance: number): Point[] {
  const a = points[index], b = points[index + 1]
  if (!a || !b || !movableSegment(a, b) || !Number.isFinite(distance) || !Math.round(distance)) return points
  const along = a[1] === b[1] ? 0 : 1, across = 1 - along
  const direction = Math.sign(b[along] - a[along])
  const previous = points[index - 1], next = points[index + 2]
  const bendBefore = previous && previous[along] === a[along] && previous[across] !== a[across]
  const bendAfter = next && next[along] === b[along] && next[across] !== b[across]
  const moved = (point: Point, inset: number): Point => {
    const result: Point = [...point]
    result[along] += direction * inset
    result[across] += Math.round(distance)
    return result
  }
  const start: Point = [...a], end: Point = [...b]
  const inset = Math.min(12, Math.abs(b[along] - a[along]) / 3)
  if (!bendBefore) start[along] += direction * inset
  if (!bendAfter) end[along] -= direction * inset
  return compactRoute([
    ...points.slice(0, index), ...(bendBefore ? [] : [a, start]),
    moved(a, bendBefore ? 0 : inset), moved(b, bendAfter ? 0 : -inset),
    ...(bendAfter ? [] : [end, b]), ...points.slice(index + 2),
  ])
}

export const connectorClearance = 7

export function connectorObstacles(boxes: RouteBox[]): RouteBox[] {
  return boxes.map(inflate)
}

function inflate({ x, y, width, height }: RouteBox): RouteBox {
  return { x: x - connectorClearance, y: y - connectorClearance,
    width: width + 2 * connectorClearance, height: height + 2 * connectorClearance }
}

export function clearConnector(points: Point[], boxes: RouteBox[]) {
  return points.length >= 2 && points.length <= 40 &&
    points.every(point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite)) &&
    segments(points).every(([a, b], i) => boxes.every(box => {
      const departure = i === 0 && approachesBox(a, b, box)
      const arrival = i === points.length - 2 && approachesBox(b, a, box)
      return !segmentHitsBox(a, b, departure || arrival ? box : inflate(box))
    }))
}

function approachesBox(endpoint: Point, other: Point, box: RouteBox) {
  const [x, y] = endpoint
  return (y >= box.y && y <= box.y + box.height && y === other[1] &&
      (x === box.x && other[0] < x || x === box.x + box.width && other[0] > x)) ||
    (x >= box.x && x <= box.x + box.width && x === other[0] &&
      (y === box.y && other[1] < y || y === box.y + box.height && other[1] > y))
}

function segmentHitsBox(a: Point, b: Point, box: RouteBox) {
  if (a[0] === b[0] || a[1] === b[1]) return blocked(a, b, box)
  const xs = [(box.x - a[0]) / (b[0] - a[0]), (box.x + box.width - a[0]) / (b[0] - a[0])]
  const ys = [(box.y - a[1]) / (b[1] - a[1]), (box.y + box.height - a[1]) / (b[1] - a[1])]
  return Math.max(0, Math.min(...xs), Math.min(...ys)) < Math.min(1, Math.max(...xs), Math.max(...ys))
}

export function attachmentSide([x, y]: Point, box: RouteBox): RouteSide | undefined {
  const on = (a: number, b: number) => Math.abs(a - b) < .01
  if (y >= box.y && y <= box.y + box.height) {
    if (on(x, box.x)) return 'left'
    if (on(x, box.x + box.width)) return 'right'
  }
  if (x >= box.x && x <= box.x + box.width) {
    if (on(y, box.y)) return 'top'
    if (on(y, box.y + box.height)) return 'bottom'
  }
}

const attachmentGap = 22
export const tangentAxis = (side: RouteSide) => side === 'left' || side === 'right' ? 1 : 0

function attachmentRange(box: RouteBox, axis: number): [number, number] {
  const start = axis ? box.y : box.x
  const length = axis ? box.height : box.width
  const inset = Math.min(12, length / 2)
  return [start + inset, start + length - inset]
}

function occupiedLanes(box: RouteBox, side: RouteSide, used: Point[]) {
  const axis = tangentAxis(side), across = 1 - axis
  const edge = anchor(box, side)[across]
  const start = axis ? box.y : box.x, length = axis ? box.height : box.width
  return used.filter(point => Math.abs(point[across] - edge) < .01 &&
    point[axis] >= start && point[axis] <= start + length).map(point => point[axis])
}

function freeLane(target: number, [low, high]: [number, number], taken: number[]) {
  if (low > high) return
  const clamp = (at: number) => Math.max(low, Math.min(high, at))
  const candidates = [clamp(target), ...taken.flatMap(at => [clamp(at - attachmentGap), clamp(at + attachmentGap)])]
    .sort((a, b) => Math.abs(a - target) - Math.abs(b - target))
  return candidates.find(at => taken.every(other => Math.abs(other - at) >= attachmentGap))
}

/** Keep the full marker and its stroke clear of another independent attachment. */
export function freeAttachment(box: RouteBox, side: RouteSide, desired: Point, used: Point[]): Point | undefined {
  const axis = tangentAxis(side)
  const coordinate = freeLane(desired[axis], attachmentRange(box, axis), occupiedLanes(box, side, used))
  if (coordinate === undefined) return
  const result: Point = [...desired]
  result[axis] = coordinate
  return result
}

export type ConnectorEnd = { box: RouteBox; side: RouteSide; points: Point[]; fixed?: boolean }

/** Use the narrower face's center by default, even when the card centers are far apart. */
export function alignConnectorEnds<A extends ConnectorEnd, B extends ConnectorEnd>(
  source: A, target: B, used: Point[], requestedLane?: number,
): { source: A; target: B }[] {
  const axis = tangentAxis(source.side)
  if (source.side === target.side || tangentAxis(target.side) !== axis) return []
  const a = source.points[0], b = target.points[0]
  const toward = source.side === 'right' || source.side === 'bottom' ? 1 : -1
  if ((b[1 - axis] - a[1 - axis]) * toward <= 0) return []
  const limits = (end: ConnectorEnd): [number, number] => end.fixed
    ? [end.points[0][axis], end.points[0][axis]] : attachmentRange(end.box, axis)
  const [aMin, aMax] = limits(source), [bMin, bMax] = limits(target)
  const low = Math.max(aMin, bMin), high = Math.min(aMax, bMax)
  if (requestedLane !== undefined && (requestedLane < low || requestedLane > high)) return []
  const narrower = aMax - aMin <= bMax - bMin ? source : target
  const preferred = requestedLane ?? (narrower.fixed ? narrower.points[0] : anchor(narrower.box, narrower.side))[axis]
  const taken = [source, target].flatMap(end => end.fixed ? [] : occupiedLanes(end.box, end.side, used))
  const lane = freeLane(preferred, [low, high], taken)
  if (lane === undefined || [source, target].some(end => end.fixed && end.points.some(point => point[axis] !== lane))) return []
  const move = <T extends ConnectorEnd>(end: T): T => {
    if (end.fixed) return end
    const point: Point = [...end.points[0]]
    point[axis] = lane
    return { ...end, points: approachPoint(point, end.side) }
  }
  return [{ source: move(source), target: move(target) }]
}

export function nearestAttachment([x, y]: Point, box: RouteBox): Point {
  const insetX = Math.min(12, box.width / 2), insetY = Math.min(12, box.height / 2)
  const xx = Math.min(box.x + box.width - insetX, Math.max(box.x + insetX, Math.round(x)))
  const yy = Math.min(box.y + box.height - insetY, Math.max(box.y + insetY, Math.round(y)))
  const points: Point[] = [[box.x, yy], [box.x + box.width, yy], [xx, box.y], [xx, box.y + box.height]]
  return points.reduce((best, point) =>
    Math.hypot(x - point[0], y - point[1]) < Math.hypot(x - best[0], y - best[1]) ? point : best)
}

export function snapConnectorAttachment(point: Point, box: RouteBox, peer: Point | undefined, used: Point[], tolerance: number) {
  const side = attachmentSide(point, box)
  if (!side) return
  const axis = tangentAxis(side)
  // Use the opposite endpoint first when it would straighten the connector.
  for (const at of [peer?.[axis], (axis ? box.y + box.height / 2 : box.x + box.width / 2)]) {
    if (at === undefined) continue
    if (Math.abs(at - point[axis]) > tolerance) continue
    const candidate: Point = [...point]
    candidate[axis] = at
    const snapped = freeAttachment(box, side, candidate, used)
    if (samePoint(snapped, candidate)) {
      const centerGuide: Point = [...candidate]
      centerGuide[1 - axis] = axis ? box.x + box.width / 2 : box.y + box.height / 2
      return { point: candidate, aligned: at === peer?.[axis] ? peer : centerGuide }
    }
  }
  const free = freeAttachment(box, side, point, used)
  if (free) return { point: free, aligned: undefined }
}

export function snapConnectorSegment(points: Point[], index: number, offset: number, tolerance: number) {
  if (!offset) return { offset }
  const a = points[index], b = points[index + 1]
  const axis = a[0] === b[0] ? 0 : 1
  const desired = a[axis] + offset
  const candidates = [points[index - 1], points[index + 2]].filter((point): point is Point =>
    !!point && point[axis] !== a[axis] && Math.abs(point[axis] - desired) <= tolerance)
    .sort((first, second) => Math.abs(first[axis] - desired) - Math.abs(second[axis] - desired))
  const aligned = candidates[0]
  return { offset: aligned ? aligned[axis] - a[axis] : offset, aligned }
}

export type ConnectorGeometry = {
  source: RouteBox
  target: RouteBox
  obstacles: RouteBox[]
  occupied: RouteSegment[]
  used: Point[]
}

/** Slide the segment, allowing both free attachments to follow into a clear shared lane. */
export function shiftConnectorSegment(
  points: Point[], index: number, offset: number, tolerance: number, geometry: ConnectorGeometry, moveEnds: boolean,
): { points: Point[]; aligned?: Point; straight?: boolean; offset?: number } {
  if (!offset) return { points }
  const a = points[index], b = points[index + 1]
  const axis = a[0] === b[0] ? 0 : 1
  const lane = a[axis] + offset
  const { source, target, used, obstacles } = geometry
  if (moveEnds) {
    const forward = axis === 0 ? source.y + source.height <= target.y : source.x + source.width <= target.x
    const from = axis === 0 ? forward ? 'bottom' : 'top' : forward ? 'right' : 'left'
    const to = axis === 0 ? forward ? 'top' : 'bottom' : forward ? 'left' : 'right'
    const start: ConnectorEnd = { box: source, side: from, points: [anchor(source, from)] }
    const finish: ConnectorEnd = { box: target, side: to, points: [anchor(target, to)] }
    const [requested] = alignConnectorEnds(start, finish, used, lane)
    if (requested) {
      const [centered] = alignConnectorEnds(start, finish, used)
      for (const pair of [centered, requested]) {
        if (!pair || Math.abs(pair.source.points[0][axis] - lane) > tolerance) continue
        const direct = [pair.source.points[0], pair.target.points[0]]
        if (clearConnector(direct, obstacles)) return { points: direct, aligned: direct[0], straight: true }
      }
    }
  }
  const snapped = snapConnectorSegment(points, index, offset, tolerance)
  const edited = slideSegment(points, index, snapped.offset)
  return clearConnector(edited, obstacles) ? { points: edited, aligned: snapped.aligned, offset: snapped.offset } : { points }
}

export function routingBounds(a: RouteBox, b: RouteBox): RouteBox {
  const padding = Math.max(a.width, b.width, a.height, b.height) / 2 + 64
  const x = Math.min(a.x, b.x) - padding, y = Math.min(a.y, b.y) - padding
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) + padding - x,
    height: Math.max(a.y + a.height, b.y + b.height) + padding - y }
}

export function bestConnector<T extends { source: Point[]; target: Point[] }>(
  pairs: T[], boxes: RouteBox[], bounds: RouteBox, occupied: RouteSegment[],
) {
  const clearance = connectorObstacles(boxes)
  let best: { pair: T; points: Point[]; cost: number } | undefined
  const tryPair = (pair: T, grid: number) => {
    const { source, target } = pair
    const start = source.at(-1)!, end = target.at(-1)!
    const a = source[0], b = target[0]
    const axis = a[0] === b[0] ? 0 : a[1] === b[1] ? 1 : undefined
    if (axis !== undefined && source.every(point => point[axis] === a[axis]) && target.every(point => point[axis] === a[axis])) {
      const other = 1 - axis, gap = b[other] - a[other]
      if ((start[other] - a[other]) * gap > 0 && (b[other] - end[other]) * gap > 0 && clearConnector([a, b], boxes)) {
        const cost = routeCost([a, b], occupied)
        if (!best || cost < best.cost) best = { pair, points: [a, b], cost }
        if (cost === Math.abs(gap) || Math.abs(gap) <= Math.abs(start[other] - a[other]) + Math.abs(b[other] - end[other])) return
      }
    }
    try {
      const track = samePoint(start, end) ? [start] : routeOrthogonal(start, end, clearance, bounds, occupied, grid)
      const points = compactRoute([...source.slice(0, -1), ...track, ...target.slice(0, -1).reverse()])
      if (points.some(([x, y]) => x < bounds.x || x > bounds.x + bounds.width ||
          y < bounds.y || y > bounds.y + bounds.height) || !clearConnector(points, boxes)) return
      const cost = routeCost(points, occupied)
      if (!best || cost < best.cost) best = { pair, points, cost }
    } catch {
      // Another attachment may have a clear route.
    }
  }
  for (const pair of pairs) tryPair(pair, 0)
  if (!best) {
    // Avoid growing the visibility grid for every attachment on busy diagrams.
    for (const pair of pairs) {
      tryPair(pair, 4000)
      if (best) break
    }
  }
  return best
}

export function reattachConnector(
  points: Point[], from: RouteBox, to: RouteBox, side: 'source' | 'target', point: Point,
  obstacles: RouteBox[], occupied: RouteSegment[],
): Point[] | undefined {
  const a = side === 'source' ? point : points[0]
  const b = side === 'target' ? point : points.at(-1)!
  const start = attachmentSide(a, from), end = attachmentSide(b, to)
  if (!start || !end) return undefined
  return bestConnector([{ source: approachPoint(a, start), target: approachPoint(b, end) }],
    obstacles, routingBounds(from, to), occupied)?.points
}
