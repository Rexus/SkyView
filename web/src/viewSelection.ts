import type { SysmlElement, SysmlModel } from './types'
import type { SharedView } from './sharedViews.ts'
import { boxesOf, lockedAncestor, expandCanvas } from './sharedViews.ts'
import { routeEdges } from './savedDiagramRouting.ts'
import { canPlaceElement, type DropPosition } from './elementDrag.ts'

export function viewReference(model: SysmlModel, element: SysmlElement) {
 const short = element.shortName
 return short && !model.elements.some(other => other.id !== element.id &&
  (other.shortName === short || other.qname === short)) ? short : element.qname
}

export function viewKeyFor(view: SharedView, model: SysmlModel, element: SysmlElement) {
 const key = viewReference(model, element)
 return view.nodes.find(node => node.element === key || node.element === element.qname)?.element ?? key
}

/** Select an existing native element and preserve the placement of other boxes. */
export function addViewElement(view: SharedView, model: SysmlModel, id: string, drop?: DropPosition): SharedView {
 const element = model.elements.find(item => item.id === id)
 if (!element || !canPlaceElement(element)) throw new Error('Choose a part, item, package or requirement.')
 const key = viewKeyFor(view, model, element)
 if (view.nodes.some(node => node.element === key)) return view

 const width = 220, height = 110, margin = 24
 const boxes = boxesOf(view).filter(box => !box.parent)
 const right = Math.max(0, ...boxes.map(box => box.x + box.width))
 const start = drop && Number.isFinite(drop.x) && Number.isFinite(drop.y) ?
  { x: Math.round(drop.x), y: Math.round(drop.y) } :
  { x: right + 40, y: 80 }
 const candidates = [start, { x: right + 40, y: start.y }]
 for (const box of boxes) {
  candidates.push({ x: box.x + box.width + margin, y: start.y }, { x: start.x, y: box.y + box.height + margin })
 }
 const distance = ({ x, y }: DropPosition) => Math.abs(start.x - x) + Math.abs(start.y - y)
 const place = candidates.sort((a, b) => distance(a) - distance(b)).find(({ x, y }) =>
  boxes.every(box => x + width <= box.x || x >= box.x + box.width || y + height <= box.y || y >= box.y + box.height),
 )
 if (!place) throw new Error('No clear space for this element. Arrange the view before adding it.')
 const next = structuredClone(view)
 next.nodes.push({ element: key, ...place, width, height })
 expandCanvas(next)
 routeEdges(next, view)
 return next
}

export function addViewConnection(view: SharedView, relation: string, from: string, to: string) {
 const lock = lockedAncestor(view, from)
 if (lock && lock === lockedAncestor(view, to)) throw new Error('Unlock the containing group before adding an internal connection.')
 const next = structuredClone(view)
 next.edges.push({ element: relation, from, to, points: [], label: [0, 0] })
 routeEdges(next, view)
 return next
}
