import { anchor, approachPoint, routeLabel, routeSides, segments } from './sharedRouting.ts'
import type { RouteBox, RouteSegment } from './sharedRouting.ts'
import { isLabelPosition, labelBounds, placeRouteLabels } from './relationshipLabels.ts'
import { boxKey, boxesOf, canvasBounds, expandCanvas, interiorLocked, lockedAncestor } from './sharedViews.ts'
import type { Point, SharedView } from './sharedViews.ts'
import { alignConnectorEnds, attachmentSide, bestConnector, clearConnector, freeAttachment, routingBounds } from './connectorRoutes.ts'

const boxIndex = (view: SharedView) => new Map(boxesOf(view).map(box => [boxKey(box), box]))

function endpointParents(view: SharedView, from: string, to: string) {
 const boxes = boxIndex(view)
 return new Set([...parentKeys(boxes, from), ...parentKeys(boxes, to)])
}

function parentKeys(boxes: ReturnType<typeof boxIndex>, key: string) {
 const parents = new Set<string>()
 let parent = boxes.get(key)?.parent
 while (parent && !parents.has(parent)) { parents.add(parent); parent = boxes.get(parent)?.parent }
 return parents
}

export function canEditSavedConnector(view: SharedView, from: string, to: string) {
 const lock = lockedAncestor(view, from)
 return !lock || lock !== lockedAncestor(view, to)
}

export function editSavedConnector(view: SharedView, key: string, points: Point[], labels: ReadonlyMap<string, string>) {
 const edge = view.edges.find(candidate => candidate.element === key)
 if (!edge || !canEditSavedConnector(view, edge.from, edge.to)) throw new Error('Unlock the group to move its connectors.')
 const parents = endpointParents(view, edge.from, edge.to)
 const obstacles = view.nodes.filter(node => !parents.has(node.element))
 const from = view.nodes.find(node => node.element === edge.from), to = view.nodes.find(node => node.element === edge.to)
 if ((!view.presentation && points.length > 20) || !clearConnector(points, obstacles) ||
     !from || !to || !attachmentSide(points[0], from) || !attachmentSide(points.at(-1)!, to)) {
  throw new Error('The connector must stay clear of diagram boxes.')
 }
 const next = structuredClone(view)
 const adjusted = next.edges.find(candidate => candidate.element === key)!
 adjusted.points = points
 if (adjusted.labelMoved) { expandCanvas(next); return next }
 const candidates = next.edges.map(candidate => ({
  points: candidate.points, text: labels.get(candidate.element) ?? '',
  fixed: candidate === adjusted ? undefined : candidate.label,
 }))
 expandCanvas(next)
 const label = placeRouteLabels(candidates, obstacles, canvasBounds(next))[next.edges.indexOf(adjusted)]
 adjusted.label = label?.position ?? routeLabel(points)
 expandCanvas(next, 0)
 return next
}

export function moveSavedLabel(view: SharedView, key: string, position: Point, text: string) {
 const edge = view.edges.find(candidate => candidate.element === key)
 if (!edge || !canEditSavedConnector(view, edge.from, edge.to) || !isLabelPosition(position)) return view
 const next = structuredClone(view)
 const adjusted = next.edges.find(candidate => candidate.element === key)!
 adjusted.label = position
 adjusted.labelMoved = true
 const bounds = labelBounds(text, position)
 expandCanvas(next, 12, [bounds])
 return next
}

export function routeEdges(view: SharedView, previous?: SharedView, improve = false, labels?: ReadonlyMap<string, string>) {
 const nodes = new Map(view.nodes.map(n => [n.element, n]))
 const old = new Map(previous?.nodes.map(n => [n.element, n]) ?? [])
 const boxes = boxIndex(view)
 const labelRoutes = new Map<SharedView['edges'][number], Parameters<typeof placeRouteLabels>[0][number]>()
 const distance = (edge: SharedView['edges'][number]) => {
  const a = nodes.get(edge.from)!, b = nodes.get(edge.to)!
  return Math.abs(a.x + a.width / 2 - b.x - b.width / 2) + Math.abs(a.y + a.height / 2 - b.y - b.height / 2)
 }
 const ordered = [...view.edges].sort((a, b) => distance(a) - distance(b))
 const geometry = ordered.map(edge => {
  const a = nodes.get(edge.from)!, b = nodes.get(edge.to)!
  const oa = old.get(edge.from), ob = old.get(edge.to)
  const fromParents = parentKeys(boxes, edge.from), toParents = parentKeys(boxes, edge.to)
  const ancestors = new Set([...fromParents, ...toParents])
  const obstacles = view.nodes.filter(n => !ancestors.has(n.element))
  const lockedInterior = [...fromParents].some(id => toParents.has(id) && interiorLocked(boxes.get(id)?.layout))
  const clear = clearConnector(edge.points, obstacles)
  // Preserve translated interior geometry. A moved unrelated obstacle can still
  // require rerouting an unlocked edge whose endpoints did not move.
  const sameTranslation = oa && ob && a.width === oa.width && a.height === oa.height &&
   b.width === ob.width && b.height === ob.height && a.x - oa.x === b.x - ob.x && a.y - oa.y === b.y - ob.y
  const preserve = edge.points.length >= 2 && sameTranslation && (lockedInterior || (clear && !improve))
  return { edge, a, b, ancestors, obstacles, preserve }
 })
 const preserved = geometry.filter(item => item.preserve).map(item => item.edge.points)
 const occupied: RouteSegment[] = preserved.flatMap(segments)
 const used = preserved.flatMap(points => [points[0], points.at(-1)!])
 for (const { edge, a, b, ancestors, obstacles, preserve } of geometry) {
  if (!preserve) {
   edge.points = routeWithApproach(a, b, obstacles, occupied, used)
   if (!edge.labelMoved) edge.label = routeLabel(edge.points)
   occupied.push(...segments(edge.points))
   used.push(edge.points[0], edge.points.at(-1)!)
  }
  if (labels) {
   const headings = [...ancestors].flatMap(id => {
    const box = boxes.get(id)
    return box ? [{ x: box.x, y: box.y, width: box.width, height: 24 }] : []
   })
   labelRoutes.set(edge, { points: edge.points, text: labels.get(edge.element) ?? '', boxes: [...obstacles, ...headings],
    fixed: preserve || edge.labelMoved ? edge.label : undefined })
  }
 }
 expandCanvas(view, 0)
 if (labels) placeRouteLabels(view.edges.map(edge => labelRoutes.get(edge)!), view.nodes, canvasBounds(view, 8)).forEach((placement, i) => {
  if (placement && !labelRoutes.get(view.edges[i])?.fixed) view.edges[i].label = placement.position
 })
 if (labels) expandCanvas(view, 0, view.edges.flatMap(edge =>
  edge.labelMoved ? [labelBounds(labels.get(edge.element) ?? '', edge.label)] : []))
}

function routeWithApproach(a: RouteBox, b: RouteBox, obstacles: RouteBox[], occupied: RouteSegment[], used: Point[]) {
 const bounds = routingBounds(a, b)
 const ends = routeSides(a, b).flatMap(([from, to]) => {
  const start = freeAttachment(a, from, anchor(a, from), used), finish = freeAttachment(b, to, anchor(b, to), used)
  if (!start || !finish) return []
  const source = { box: a, side: from, points: approachPoint(start, from) }
  const target = { box: b, side: to, points: approachPoint(finish, to) }
  return [...alignConnectorEnds(source, target, used), { source, target }]
 })
 const pairs = ends.map(({ source, target }) => ({ source: source.points, target: target.points }))
 const best = bestConnector(pairs, obstacles, bounds, occupied)
 if (best) return best.points
 throw new Error('No clear connector route. Move the boxes farther apart.')
}
