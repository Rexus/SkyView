import dagre from 'dagre'
import type { Box, Point } from './sharedViews.ts'

export type RouteBox = Pick<Box, 'x' | 'y' | 'width' | 'height'>
export type RouteSide = 'left' | 'right' | 'top' | 'bottom'
export type RouteSegment = [Point, Point]

const equal = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1]
export function blocked(a: Point, b: Point, rect: RouteBox) {
 const right = rect.x + rect.width, bottom = rect.y + rect.height
 if (a[0] === b[0]) return a[0] > rect.x && a[0] < right && Math.max(a[1], b[1]) > rect.y && Math.min(a[1], b[1]) < bottom
 return a[1] > rect.y && a[1] < bottom && Math.max(a[0], b[0]) > rect.x && Math.min(a[0], b[0]) < right
}
export function compactRoute(points: Point[]): Point[] {
 const out: Point[] = []
 for (const p of points) {
  if (out.length && equal(out.at(-1)!, p)) continue
  while (out.length > 1) {
   const a = out.at(-2)!, b = out.at(-1)!
   const axis = a[0] === b[0] && b[0] === p[0] ? 1 : a[1] === b[1] && b[1] === p[1] ? 0 : -1
   if (axis === -1 || (a[axis] - b[axis]) * (p[axis] - b[axis]) > 0) break
   out.pop()
  }
  out.push(p)
 }
 return out
}
export function segments(points: Point[]): RouteSegment[] {
 return points.slice(1).map((point, i) => [points[i], point])
}

const bendCost = 26
const distance = (a: Point, b: Point) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])
const within = (value: number, a: number, b: number) => value >= Math.min(a, b) && value <= Math.max(a, b)

function interference(a: Point, b: Point, occupied: RouteSegment[]) {
 const horizontal = a[1] === b[1]
 const along = horizontal ? 0 : 1, across = 1 - along
 let cost = 0
 for (const [c, d] of occupied) {
  if (c[across] === d[across]) {
   const separation = Math.abs(c[across] - a[across])
   if (separation >= 9) continue
   const overlap = Math.min(Math.max(a[along], b[along]), Math.max(c[along], d[along]))
    - Math.max(Math.min(a[along], b[along]), Math.min(c[along], d[along]))
   if (overlap > 0) cost += separation === 0 ? 42 + overlap * 3 : overlap * (9 - separation) / 14
  } else if (within(c[along], a[along], b[along]) && within(a[across], c[across], d[across]) &&
     !equal(a, c) && !equal(a, d) && !equal(b, c) && !equal(b, d)) {
   cost += 105
  }
 }
 return cost
}

export function routeCost(points: Point[], occupied: RouteSegment[]) {
 const legs = segments(compactRoute(points))
 return legs.reduce((cost, [a, b], i) => cost + distance(a, b) + interference(a, b, occupied) + (i ? bendCost : 0), 0)
}

export function routeOrthogonal(
 start: Point, end: Point, obstacles: RouteBox[], bounds: RouteBox, occupied: RouteSegment[] = [], maxGridCells = Infinity,
): Point[] {
 const clear = (a: Point, b: Point) => obstacles.every(box => !blocked(a, b, box))
 const xmid = (start[0] + end[0]) / 2, ymid = (start[1] + end[1]) / 2
 const candidates: Point[][] = [[start, [end[0], start[1]], end], [start, [start[0], end[1]], end]]
 const tracks = (axis: 0 | 1, middle: number) => {
  const other = 1 - axis
  const nearby = [...new Set(occupied.flatMap(([a, b]) => a[axis] === b[axis] &&
    Math.max(a[other], b[other]) >= Math.min(start[other], end[other]) &&
    Math.min(a[other], b[other]) <= Math.max(start[other], end[other]) ? [a[axis]] : []))]
    .sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle)).slice(0, 4)
  return [middle, start[axis] - 14, start[axis] + 14, end[axis] - 14, end[axis] + 14,
   middle - 24, middle + 24, ...nearby.flatMap(track => [track - 10, track + 10])]
 }
 const horizontalTracks = tracks(1, ymid), verticalTracks = tracks(0, xmid)
 for (const x of verticalTracks) {
  if (x >= bounds.x && x <= bounds.x + bounds.width) candidates.push([start, [x, start[1]], [x, end[1]], end])
 }
 for (const y of horizontalTracks) {
  if (y >= bounds.y && y <= bounds.y + bounds.height) candidates.push([start, [start[0], y], [end[0], y], end])
 }

 let best: Point[] | undefined, bestCost = Infinity
 for (const candidate of candidates) {
  const points = compactRoute(candidate)
  const lines = segments(points)
  if (lines.length < 1 || !lines.every(([a, b]) => clear(a, b))) continue
  const cost = routeCost(points, occupied)
  if (cost < bestCost) { best = points; bestCost = cost }
 }
 if (best && bestCost <= distance(start, end) + 64) return best
 // Orthogonal visibility grid; graphlib owns shortest-path search. Boundaries are
 // annotations, while unrelated native boxes are obstacles, including containers.
 const right = bounds.x + bounds.width, bottom = bounds.y + bounds.height
 const xs = [...new Set([start[0], end[0], bounds.x, right, ...obstacles.flatMap(box => [
  Math.max(bounds.x, Math.min(right, box.x - 12)), Math.max(bounds.x, Math.min(right, box.x + box.width + 12)),
 ])])].sort((a, b) => a - b)
 const ys = [...new Set([start[1], end[1], bounds.y, bottom, ...obstacles.flatMap(box => [
  Math.max(bounds.y, Math.min(bottom, box.y - 12)), Math.max(bounds.y, Math.min(bottom, box.y + box.height + 12)),
 ])])].sort((a, b) => a - b)
 if (xs.length * ys.length > maxGridCells) {
  if (best) return best
  throw new Error('The route exceeds the interactive search area.')
 }
 // Track the direction of arrival so a turn costs more than several collinear
 // grid steps. This avoids zigzags when two paths have the same length.
 const graph = new dagre.graphlib.Graph()
 const key = ([x, y]: Point, axis: string) => `${x},${y},${axis}`
 const axes = ['h', 'v']
 for (const x of xs) for (const y of ys) for (const axis of axes) graph.setNode(key([x, y], axis), {})
 const connect = (a: Point, b: Point, axis: string) => {
  if (!clear(a, b)) return
  const weight = distance(a, b) + interference(a, b, occupied)
  for (const incoming of axes) {
   const cost = weight + (incoming === axis ? 0 : bendCost)
   graph.setEdge(key(a, incoming), key(b, axis), { weight: cost })
   graph.setEdge(key(b, incoming), key(a, axis), { weight: cost })
  }
 }
 for (let x = 0; x < xs.length; x++) for (let y = 0; y < ys.length; y++) {
  if (x) connect([xs[x - 1], ys[y]], [xs[x], ys[y]], 'h')
  if (y) connect([xs[x], ys[y - 1]], [xs[x], ys[y]], 'v')
 }
 const source = 'start', target = 'finish'
 for (const axis of axes) {
  graph.setEdge(source, key(start, axis), { weight: 0 })
  graph.setEdge(key(end, axis), target, { weight: 0 })
 }
 const found = dagre.graphlib.alg.dijkstra(graph, source, e => graph.edge(e.v, e.w).weight)
 if (!Number.isFinite(found[target]?.distance)) {
  if (best) return best
  throw new Error('No clear route between these elements. Increase boundary spacing.')
 }
 const result: Point[] = []
 for (let current = found[target].predecessor; current && current !== source; current = found[current].predecessor) {
  const [x, y] = current.split(',')
  result.push([Number(x), Number(y)])
 }
 const points = compactRoute(result.reverse())
 const cost = routeCost(points, occupied)
 return best && bestCost <= cost ? best : points
}
export function facingSides(a: RouteBox, b: RouteBox): [RouteSide, RouteSide] {
 const dx = b.x + b.width / 2 - a.x - a.width / 2
 const dy = b.y + b.height / 2 - a.y - a.height / 2
 if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['right', 'left'] : ['left', 'right']
 return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

export function routeSides(a: RouteBox, b: RouteBox): [RouteSide, RouteSide][] {
 const primary = facingSides(a, b)
 const across: [RouteSide, RouteSide] = primary[0] === 'left' || primary[0] === 'right'
  ? a.y + a.height / 2 < b.y + b.height / 2 ? ['bottom', 'top'] : ['top', 'bottom']
  : a.x + a.width / 2 < b.x + b.width / 2 ? ['right', 'left'] : ['left', 'right']
 return [primary, across, [primary[0], across[1]], [across[0], primary[1]],
  ['right', 'right'], ['left', 'left'], ['top', 'top'], ['bottom', 'bottom']]
}

export function anchor(box: RouteBox, side: RouteSide, portY = box.height / 2): Point {
 if (side === 'left' || side === 'right') return [side === 'left' ? box.x : box.x + box.width, box.y + portY]
 return [box.x + box.width / 2, side === 'top' ? box.y : box.y + box.height]
}

export function approach(box: RouteBox, side: RouteSide): [Point, Point] {
 return approachPoint(anchor(box, side), side)
}
export function approachPoint(point: Point, side: RouteSide): [Point, Point] {
 return [point, [
  point[0] + (side === 'left' ? -12 : side === 'right' ? 12 : 0),
  point[1] + (side === 'top' ? -12 : side === 'bottom' ? 12 : 0),
 ]]
}
export function routeLabel(points: Point[]): Point {
 let longest: RouteSegment = [points[0], points[0]]
 for (const leg of segments(points)) {
  if (distance(...leg) > distance(...longest)) longest = leg
 }
 const [a, b] = longest
 return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 10]
}
