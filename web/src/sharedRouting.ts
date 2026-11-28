import dagre from 'dagre'
import { boxKey, boxesOf } from './sharedViews.ts'
import type { Box, Point, SharedView } from './sharedViews.ts'

export type RouteBox = Pick<Box, 'x' | 'y' | 'width' | 'height'>
export type RouteSide = 'left' | 'right' | 'top' | 'bottom'
export type RouteSegment = [Point, Point]

const equal = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1]
function blocked(a: Point, b: Point, rect: RouteBox) {
 const right = rect.x + rect.width, bottom = rect.y + rect.height
 if (a[0] === b[0]) return a[0] > rect.x && a[0] < right && Math.max(a[1], b[1]) > rect.y && Math.min(a[1], b[1]) < bottom
 return a[1] > rect.y && a[1] < bottom && Math.max(a[0], b[0]) > rect.x && Math.min(a[0], b[0]) < right
}
function compact(points: Point[]): Point[] {
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

const distance = (a: Point, b: Point) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1])
const within = (value: number, a: number, b: number) => value >= Math.min(a, b) && value <= Math.max(a, b)

function interference(a: Point, b: Point, occupied: RouteSegment[]) {
 const horizontal = a[1] === b[1]
 const along = horizontal ? 0 : 1, across = 1 - along
 let cost = 0
 for (const [c, d] of occupied) {
  if (c[across] === d[across]) {
   if (c[across] !== a[across]) continue
   const overlap = Math.min(Math.max(a[along], b[along]), Math.max(c[along], d[along]))
    - Math.max(Math.min(a[along], b[along]), Math.min(c[along], d[along]))
   if (overlap > 0) cost += 20 + overlap * .7
  } else if (within(c[along], a[along], b[along]) && within(a[across], c[across], d[across]) &&
     !equal(a, c) && !equal(a, d) && !equal(b, c) && !equal(b, d)) {
   cost += 80
  }
 }
 return cost
}

export function routeOrthogonal(
 start: Point, end: Point, obstacles: RouteBox[], bounds: RouteBox, occupied: RouteSegment[] = [], maxGridCells = Infinity,
): Point[] {
 const clear = (a: Point, b: Point) => obstacles.every(box => !blocked(a, b, box))
 const xmid = (start[0] + end[0]) / 2, ymid = (start[1] + end[1]) / 2
 const candidates: Point[][] = [[start, [end[0], start[1]], end], [start, [start[0], end[1]], end]]
 const horizontalTracks = [ymid, start[1] - 14, start[1] + 14, end[1] - 14, end[1] + 14, ymid - 24, ymid + 24]
 const verticalTracks = [xmid, start[0] - 14, start[0] + 14, end[0] - 14, end[0] + 14, xmid - 24, xmid + 24]
 for (const x of verticalTracks) {
  if (x >= bounds.x && x <= bounds.x + bounds.width) candidates.push([start, [x, start[1]], [x, end[1]], end])
 }
 for (const y of horizontalTracks) {
  if (y >= bounds.y && y <= bounds.y + bounds.height) candidates.push([start, [start[0], y], [end[0], y], end])
 }

 const costOf = (a: Point, b: Point) => distance(a, b) + interference(a, b, occupied)
 let best: Point[] | undefined, bestCost = Infinity
 for (const candidate of candidates) {
  const points = compact(candidate)
  const lines = segments(points)
  if (lines.length < 1 || !lines.every(([a, b]) => clear(a, b))) continue
  const cost = lines.reduce((total, [a, b]) => total + costOf(a, b) + 8, 0)
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
 const graph = new dagre.graphlib.Graph()
 const key = (x: number, y: number) => `${x},${y}`
 for (const x of xs) for (const y of ys) graph.setNode(key(x, y), {})
 const connect = (a: Point, b: Point) => {
  if (!clear(a, b)) return
  const weight = costOf(a, b) + 1
  graph.setEdge(key(...a), key(...b), { weight })
  graph.setEdge(key(...b), key(...a), { weight })
 }
 for (let x = 0; x < xs.length; x++) for (let y = 0; y < ys.length; y++) {
  if (x) connect([xs[x - 1], ys[y]], [xs[x], ys[y]])
  if (y) connect([xs[x], ys[y - 1]], [xs[x], ys[y]])
 }
 const source = key(...start), target = key(...end)
 const found = dagre.graphlib.alg.dijkstra(graph, source, e => graph.edge(e).weight as number)
 if (!Number.isFinite(found[target]?.distance)) {
  if (best) return best
  throw new Error('No clear route between these elements. Increase boundary spacing.')
 }
 const result: Point[] = []; let current: string | undefined = target
 while (current) { result.push(current.split(',').map(Number) as Point); if (current === source) break; current = found[current].predecessor }
 const points = compact(result.reverse())
 const cost = segments(points).reduce((total, [a, b]) => total + costOf(a, b) + 8, 0)
 return best && bestCost <= cost ? best : points
}
export function facingSides(a: RouteBox, b: RouteBox): [RouteSide, RouteSide] {
 const dx = b.x + b.width / 2 - a.x - a.width / 2
 const dy = b.y + b.height / 2 - a.y - a.height / 2
 if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? ['right', 'left'] : ['left', 'right']
 return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom']
}

export function anchor(box: RouteBox, side: RouteSide, portY = box.height / 2): Point {
 if (side === 'left' || side === 'right') return [side === 'left' ? box.x : box.x + box.width, box.y + portY]
 return [box.x + box.width / 2, side === 'top' ? box.y : box.y + box.height]
}

export function routeLabel(points: Point[]): Point {
 let longest: RouteSegment = [points[0], points[0]]
 for (const leg of segments(points)) {
  if (distance(...leg) > distance(...longest)) longest = leg
 }
 const [a, b] = longest
 return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 10]
}

export function routeEdges(view: SharedView, previous?: SharedView, improve = false) {
 const nodes = new Map(view.nodes.map(n => [n.element, n]))
 const old = new Map(previous?.nodes.map(n => [n.element, n]) ?? [])
 const boxes = new Map(boxesOf(view).map(b => [boxKey(b), b]))
 const parents = (key: string) => { const result = new Set<string>(); let p = boxes.get(key)?.parent; while (p && !result.has(p)) { result.add(p); p = boxes.get(p)?.parent } return result }
 const occupied: RouteSegment[] = []
 for (const edge of view.edges) {
  const a = nodes.get(edge.from)!, b = nodes.get(edge.to)!
  const oa = old.get(edge.from), ob = old.get(edge.to)
  const fromParents = parents(edge.from), toParents = parents(edge.to)
  const ancestors = new Set([...fromParents, ...toParents])
  const obstacles = view.nodes.filter(n => !ancestors.has(n.element))
  const lockedInterior = [...fromParents].some(id => toParents.has(id) && boxes.get(id)?.layout?.locked)
  const clear = edge.points.every((point, i) => !i || obstacles.every(n => !blocked(edge.points[i - 1], point, n)))
  // Preserve translated interior geometry. A moved unrelated obstacle can still
  // require rerouting an unlocked edge whose endpoints did not move.
  const sameTranslation = oa && ob && a.width === oa.width && a.height === oa.height &&
   b.width === ob.width && b.height === ob.height && a.x - oa.x === b.x - ob.x && a.y - oa.y === b.y - ob.y
  if (edge.points.length >= 2 && sameTranslation && (lockedInterior || (clear && !improve))) {
   occupied.push(...segments(edge.points))
   continue
  }
  const [from, to] = facingSides(a, b)
  const start = anchor(a, from), end = anchor(b, to)
  edge.points = routeOrthogonal(start, end, obstacles, { x: 8, y: 8, width: view.width - 16, height: view.height - 16 }, occupied)
  edge.label = routeLabel(edge.points)
  occupied.push(...segments(edge.points))
 }
}
