import { layoutFlow } from './flowLayout.ts'
import { boxesOf, boxKey, descendants, translate, lockedParent, interiorLocked, expandCanvas } from './sharedViews.ts'
import type { Arrangement, Box, SharedView } from './sharedViews.ts'
import { routeEdges } from './savedDiagramRouting.ts'

/** Slide a preferred slot past occupied rectangles along a row or column. */
function openSlot(box: Box, point: { x: number; y: number }, blockers: Box[], gap: number, pattern: Arrangement['pattern']) {
 const slide = (axis: 'x' | 'y', size: 'width' | 'height', across: 'x' | 'y', breadth: 'width' | 'height') => {
  let at = point[axis]
  const lane = blockers.filter(peer => peer[across] < point[across] + box[breadth] + gap &&
   peer[across] + peer[breadth] + gap > point[across]).sort((a, b) => a[axis] - b[axis])
  for (const peer of lane) {
   if (at + box[size] + gap <= peer[axis]) break
   if (at < peer[axis] + peer[size] + gap) at = Math.ceil(peer[axis] + peer[size] + gap)
  }
  return at
 }
 const x = slide('x', 'width', 'y', 'height'), y = slide('y', 'height', 'x', 'width')
 return pattern === 'horizontal' || (pattern !== 'vertical' && x - point.x <= y - point.y)
  ? { x, y: point.y } : { x: point.x, y }
}

/** Arrange from the inside out, keeping pinned boxes in their parent coordinate system. */
export function autoLayout(input: SharedView, only?: string, labels?: ReadonlyMap<string, string>): SharedView {
 const view = structuredClone(input)
 view.presentation = true
 const all = boxesOf(view), map = new Map(all.map(b => [boxKey(b), b]))
 const old = structuredClone(view)
 const active = new Set<string>()
 function arrange(parent: string, recurse = true) {
  if (active.has(parent)) throw new Error('Boundary nesting contains a cycle.')
  active.add(parent)
  const container = map.get(parent)
  const opts: Arrangement = container?.layout ?? (parent ? {} : view.layout ?? {})
  if (interiorLocked(opts)) { active.delete(parent); return }
  const children = all.filter(b => (b.parent ?? '') === parent)
  // Retain visual ordering when switching between row, column and grid patterns.
  if (opts.pattern === 'horizontal') children.sort((a, b) => a.x - b.x || a.y - b.y)
  if (opts.pattern === 'vertical' || (opts.pattern === 'grid' && !children.some(child => child.layout?.positionLocked))) {
   children.sort((a, b) => a.y - b.y || a.x - b.x)
  }
  if (recurse) for (const child of children) arrange(boxKey(child))
  const pinned = children.filter(child => child.layout?.positionLocked)
  const movable = children.filter(child => !child.layout?.positionLocked)
  const pattern = opts.pattern ?? 'flow', gap = opts.gap || 40, pad = opts.padding || 24
  const placements = new Map<string, { x: number; y: number }>()
  if (pattern === 'flow') {
   const owner = new Map<string, string>()
   for (const child of children) {
    const id = boxKey(child)
    for (const key of descendants(view, id)) owner.set(key, id)
   }
   const links = view.edges.flatMap(edge => {
    const source = owner.get(edge.from), target = owner.get(edge.to)
    return source && target ? [{ source, target }] : []
   })
   const sized = movable.map(child => ({ id: boxKey(child), width: child.width, height: child.height }))
   const positions = layoutFlow(sized, links, opts.direction ?? 'LR', gap)
   for (const child of sized) placements.set(child.id, positions[child.id])
  } else {
   const columns = pattern === 'horizontal' ? movable.length : pattern === 'vertical' ? 1 : opts.columns || Math.ceil(Math.sqrt(movable.length))
   let y = 0
   for (let i = 0; i < movable.length; i += Math.max(1, columns)) {
    const row = movable.slice(i, i + columns); let x = 0
    for (const child of row) { placements.set(boxKey(child), { x, y }); x += child.width + gap }
    y += Math.max(...row.map(c => c.height)) + gap
   }
  }
  const [x, y] = pinned.length ? (view.origin ?? [0, 0]) : [0, 0]
  const left = (container?.x ?? x) + pad, top = (container?.y ?? y) + pad + (container ? 24 : 40)
  const occupied = [...pinned]
  let last: Box | undefined
  for (const child of movable) {
   const p = placements.get(boxKey(child))!
   if (!pinned.length) {
    translate(view, boxKey(child), Math.round(left + p.x - child.x), Math.round(top + p.y - child.y))
    continue
   }
   const desired = { x: Math.round(left + p.x), y: Math.round(top + p.y) }
   if (last && pattern === 'horizontal') desired.x = Math.max(desired.x, Math.ceil(last.x + last.width + gap))
   if (last && pattern === 'vertical') desired.y = Math.max(desired.y, Math.ceil(last.y + last.height + gap))
   const next = openSlot(child, desired, occupied, gap, pattern)
   translate(view, boxKey(child), next.x - child.x, next.y - child.y)
   occupied.push(child)
   last = child
  }
  if (children.length) {
   const right = Math.max(...children.map(c => c.x + c.width)) + pad
   const bottom = Math.max(...children.map(c => c.y + c.height)) + pad
   if (container) {
    const width = right - container.x, height = bottom - container.y
    if ('element' in container) for (const label of container.labels ?? []) { label.x *= width / container.width; label.y = Math.min(label.y, height) }
    container.width = width; container.height = height
   }
   else {
    if (!pinned.length) delete view.origin
    view.width = Math.max(300, right - x); view.height = Math.max(200, bottom - y)
   }
  }
  active.delete(parent)
 }
 if (only && lockedParent(view, only)) throw new Error('Unlock the containing boundary before arranging its contents.')
 if (only) {
  if (!map.has(only)) throw new Error('Select a boundary first.')
  arrange(only)
  // Fit the changed boundary through its ancestors. Peers move as opaque groups;
  // their own internal layouts are left alone by this local operation.
  let parent = map.get(only)?.parent ?? ''
  const fitted = new Set([only])
  for (;;) {
   if (fitted.has(parent)) throw new Error('Boundary nesting contains a cycle.')
   fitted.add(parent); arrange(parent, false)
   if (!parent) break
   parent = map.get(parent)?.parent ?? ''
  }
 } else arrange('')
 routeEdges(view, old, !only, labels)
 return view
}

export function moveBox(input: SharedView, key: string, dx: number, dy: number): SharedView {
 if (lockedParent(input, key)) throw new Error('Unlock the containing boundary before moving its contents.')
 if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('The drop position is invalid.')
 dx = Math.round(dx); dy = Math.round(dy)
 if (!dx && !dy) return input
 const view = structuredClone(input)
 const boxes = boxesOf(view)
 const moved = boxes.find(box => boxKey(box) === key)
 if (!moved) throw new Error('This box is no longer in the view.')
 if (moved.layout?.positionLocked) throw new Error('Unlock placement before moving this box.')
 translate(view, key, dx, dy)
 const parent = boxes.find(box => boxKey(box) === moved.parent)
 if (parent && !fits(moved, parent)) throw new Error('The box must stay inside its containing group.')
 for (const peer of boxes) {
  if (peer === moved || peer.parent !== moved.parent) continue
  if (moved.x < peer.x + peer.width && peer.x < moved.x + moved.width &&
      moved.y < peer.y + peer.height && peer.y < moved.y + moved.height) {
   throw new Error('There is already a box at that position.')
  }
 }
 expandCanvas(view)
 routeEdges(view, input)
 expandCanvas(view, 0)
 return view
}

export function fits(inner: Box, outer: Box): boolean {
 return inner.x >= outer.x && inner.y >= outer.y + 24 && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height
}
