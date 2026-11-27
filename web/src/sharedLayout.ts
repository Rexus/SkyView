import { layoutFlow } from './flowLayout.ts'
import { boxesOf, boxKey, descendants, translate, lockedParent } from './sharedViews.ts'
import type { Arrangement, Box, SharedView } from './sharedViews.ts'
import { routeEdges } from './sharedRouting.ts'

/** Arrange from the inside out. A locked container is an opaque, movable box. */
export function autoLayout(input: SharedView, only?: string): SharedView {
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
  if (opts.locked) { active.delete(parent); return }
  const children = all.filter(b => (b.parent ?? '') === parent)
  // Retain visual ordering when switching between row, column and grid patterns.
  if (opts.pattern === 'horizontal') children.sort((a, b) => a.x - b.x || a.y - b.y)
  if (opts.pattern === 'vertical' || opts.pattern === 'grid') children.sort((a, b) => a.y - b.y || a.x - b.x)
  if (recurse) for (const child of children) arrange(boxKey(child))
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
   const sized = children.map(child => ({ id: boxKey(child), width: child.width, height: child.height }))
   const positions = layoutFlow(sized, links, opts.direction ?? 'LR', gap)
   for (const child of sized) placements.set(child.id, positions[child.id])
  } else {
   const columns = pattern === 'horizontal' ? children.length : pattern === 'vertical' ? 1 : opts.columns || Math.ceil(Math.sqrt(children.length))
   let y = 0
   for (let i = 0; i < children.length; i += Math.max(1, columns)) {
    const row = children.slice(i, i + columns); let x = 0
    for (const child of row) { placements.set(boxKey(child), { x, y }); x += child.width + gap }
    y += Math.max(...row.map(c => c.height)) + gap
   }
  }
  const left = (container?.x ?? 0) + pad, top = (container?.y ?? 0) + pad + (container ? 24 : 40)
  for (const child of children) { const p = placements.get(boxKey(child))!; translate(view, boxKey(child), Math.round(left + p.x - child.x), Math.round(top + p.y - child.y)) }
  if (children.length) {
   const right = Math.max(...children.map(c => c.x + c.width)) + pad
   const bottom = Math.max(...children.map(c => c.y + c.height)) + pad
   if (container) {
    const width = right - container.x, height = bottom - container.y
    if ('element' in container) for (const label of container.labels ?? []) { label.x *= width / container.width; label.y = Math.min(label.y, height) }
    container.width = width; container.height = height
   }
   else { view.width = Math.max(300, right); view.height = Math.max(200, bottom) }
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
 routeEdges(view, old, !only)
 return view
}

export function moveBox(input: SharedView, key: string, dx: number, dy: number): SharedView {
 if (lockedParent(input, key)) throw new Error('Unlock the containing boundary before moving its contents.')
 const view = structuredClone(input)
 translate(view, key, Math.round(dx), Math.round(dy))
 view.width = Math.max(view.width, ...boxesOf(view).map(b => b.x + b.width + 24))
 view.height = Math.max(view.height, ...boxesOf(view).map(b => b.y + b.height + 24))
 routeEdges(view, input)
 return view
}

export function fits(inner: Box, outer: Box): boolean {
 return inner.x >= outer.x && inner.y >= outer.y + 24 && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height
}
