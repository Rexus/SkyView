export type Point = [number, number]
export type Arrangement = { pattern?: 'flow' | 'horizontal' | 'vertical' | 'grid'; direction?: 'LR' | 'TB'; columns?: number; locked?: boolean; gap?: number; padding?: number }
export type ViewStyle = { fill?: string; stroke?: string; color?: string; dash?: string }
export type Box = { x: number; y: number; width: number; height: number; parent?: string; style?: string; layout?: Arrangement }
export type ViewNode = Box & { element: string; detail?: boolean; shape?: 'rectangle' | 'cylinder' | 'hexagon'; labels?: { text: string; x: number; y: number; size?: number }[] }
export type Boundary = Box & { id: string; label: string; kind?: string }
export type ViewEdge = { element: string; from: string; to: string; points: Point[]; label: Point; caption?: string }
export type SharedView = { id: string; title: string; owner: string; subject: string; width: number; height: number; presentation?: boolean; layout?: Arrangement; nodes: ViewNode[]; boundaries?: Boundary[]; edges: ViewEdge[] }
export type ViewConfig = { version: number; styles?: Record<string, ViewStyle>; views: SharedView[] }
export const boxKey = (box: ViewNode | Boundary) => 'element' in box ? box.element : box.id
export const boxesOf = (view: SharedView) => [...view.nodes, ...(view.boundaries ?? [])]
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
