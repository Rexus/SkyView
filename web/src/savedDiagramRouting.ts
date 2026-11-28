import { anchor, blocked, facingSides, routeLabel, routeOrthogonal, segments } from './sharedRouting.ts'
import type { RouteSegment } from './sharedRouting.ts'
import { placeRouteLabels } from './relationshipLabels.ts'
import { boxKey, boxesOf, canvasBounds } from './sharedViews.ts'
import type { SharedView } from './sharedViews.ts'

export function routeEdges(view: SharedView, previous?: SharedView, improve = false, labels?: ReadonlyMap<string, string>) {
 const nodes = new Map(view.nodes.map(n => [n.element, n]))
 const old = new Map(previous?.nodes.map(n => [n.element, n]) ?? [])
 const boxes = new Map(boxesOf(view).map(b => [boxKey(b), b]))
 const parents = (key: string) => { const result = new Set<string>(); let p = boxes.get(key)?.parent; while (p && !result.has(p)) { result.add(p); p = boxes.get(p)?.parent } return result }
 const occupied: RouteSegment[] = []
 const labelRoutes = []
 const canvas = canvasBounds(view, 8)
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
  const preserve = edge.points.length >= 2 && sameTranslation && (lockedInterior || (clear && !improve))
  if (!preserve) {
   const [from, to] = facingSides(a, b)
   edge.points = routeOrthogonal(anchor(a, from), anchor(b, to), obstacles, canvas, occupied)
   edge.label = routeLabel(edge.points)
  }
  occupied.push(...segments(edge.points))
  if (labels) {
   const headings = [...ancestors].flatMap(id => {
    const box = boxes.get(id)
    return box ? [{ x: box.x, y: box.y, width: box.width, height: 24 }] : []
   })
   labelRoutes.push({ points: edge.points, text: labels.get(edge.element) ?? '', boxes: [...obstacles, ...headings],
    fixed: preserve ? edge.label : undefined })
  }
 }
 if (labels) placeRouteLabels(labelRoutes, view.nodes, canvas).forEach((placement, i) => {
  if (placement) view.edges[i].label = placement.position
 })
}
