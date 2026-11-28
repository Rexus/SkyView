export type Point = [number, number]
export type Arrangement = { pattern?: 'flow' | 'horizontal' | 'vertical' | 'grid'; direction?: 'LR' | 'TB'; columns?: number; locked?: boolean; gap?: number; padding?: number }
export type ViewStyle = { fill?: string; stroke?: string; color?: string; dash?: string }
export type Box = { x: number; y: number; width: number; height: number; parent?: string; style?: string; layout?: Arrangement }
export type ViewNode = Box & { element: string; detail?: boolean; shape?: 'rectangle' | 'cylinder' | 'hexagon'; labels?: { text: string; x: number; y: number; size?: number }[] }
export type Boundary = Box & { id: string; label: string; kind?: string }
export type ViewEdge = { element: string; from: string; to: string; points: Point[]; label: Point; caption?: string }
export type SharedView = { id: string; title: string; owner: string; subject: string; origin?: Point; width: number; height: number; presentation?: boolean; layout?: Arrangement; nodes: ViewNode[]; boundaries?: Boundary[]; edges: ViewEdge[] }
export type ViewConfig = { version: number; styles?: Record<string, ViewStyle>; views: SharedView[] }
export const boxKey = (box: ViewNode | Boundary) => 'element' in box ? box.element : box.id
export const boxesOf = (view: SharedView) => [...view.nodes, ...(view.boundaries ?? [])]
export function canvasBounds(view: SharedView, inset = 0) {
 const [x, y] = view.origin ?? [0, 0]
 return { x: x + inset, y: y + inset, width: Math.max(0, view.width - 2 * inset), height: Math.max(0, view.height - 2 * inset) }
}

export function expandCanvas(view: SharedView, padding = 24) {
 const current = canvasBounds(view)
 let { x, y } = current
 let right = x + current.width, bottom = y + current.height
 const include = (left: number, top: number, r: number, b: number) => {
  x = Math.min(x, left - padding); y = Math.min(y, top - padding)
  right = Math.max(right, r + padding); bottom = Math.max(bottom, b + padding)
 }
 for (const box of boxesOf(view)) include(box.x, box.y, box.x + box.width, box.y + box.height)
 for (const edge of view.edges) {
  for (const [px, py] of [...edge.points, edge.label]) include(px, py, px, py)
 }
 if (x || y) view.origin = [x, y]
 else delete view.origin
 view.width = right - x; view.height = bottom - y
}
export function descendants(view: SharedView, key: string): Set<string> {
 const result = new Set([key])
 for (let changed = true; changed;) {
  changed = false
  for (const box of boxesOf(view)) if (result.has(box.parent ?? '') && !result.has(boxKey(box))) { result.add(boxKey(box)); changed = true }
 }
 return result
}
export function lockedAncestor(view: SharedView, key: string): string | undefined {
 const boxes = new Map(boxesOf(view).map(box => [boxKey(box), box]))
 let parent = boxes.get(key)?.parent
 let locked: string | undefined
 const seen = new Set<string>([key])
 while (parent && !seen.has(parent)) {
  seen.add(parent)
  const box = boxes.get(parent)
  if (box?.layout?.locked) locked = parent
  parent = box?.parent
 }
 return locked
}
export function lockedParent(view: SharedView, key: string): boolean {
 return lockedAncestor(view, key) !== undefined
}
export function translate(view: SharedView, key: string, dx: number, dy: number) {
 const members = descendants(view, key)
 for (const b of boxesOf(view)) if (members.has(boxKey(b))) { b.x += dx; b.y += dy }
 // Interior routes of a moved/locked group retain their exact local geometry.
 for (const e of view.edges) if (members.has(e.from) && members.has(e.to)) {
  e.points = e.points.map(([x, y]) => [x + dx, y + dy]); e.label = [e.label[0] + dx, e.label[1] + dy]
 }
}
