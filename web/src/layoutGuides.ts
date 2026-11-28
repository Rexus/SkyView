import type { RouteBox } from './sharedRouting.ts'
import type { Point } from './sharedViews.ts'

export type PlacementGuide = { kind: 'alignment' | 'spacing'; from: Point; to: Point }
type Axis = 'x' | 'y'
type Candidate = { offset: number; guides: PlacementGuide[]; priority: number }

const size = (axis: Axis) => axis === 'x' ? 'width' : 'height'
const end = (box: RouteBox, axis: Axis) => box[axis] + box[size(axis)]
const overlaps = (a: RouteBox, b: RouteBox) => a.x < end(b, 'x') && b.x < end(a, 'x') &&
  a.y < end(b, 'y') && b.y < end(a, 'y')

const point = (axis: Axis, along: number, across: number): Point => axis === 'x' ? [along, across] : [across, along]

/** Align corresponding edges/centres or repeat a clear gap in the same row or column. */
export function snapPlacement(box: RouteBox, peers: RouteBox[], tolerance: number, parent?: RouteBox) {
  const position: RouteBox = { ...box }
  const guides: PlacementGuide[] = []
  for (const axis of ['x', 'y'] as const) {
    const cross = axis === 'x' ? 'y' : 'x'
    const length = position[size(axis)]
    const candidates: Candidate[] = []
    const add = (value: number, lines: PlacementGuide[], priority: number) => {
      const offset = value - position[axis]
      if (Math.abs(offset) > tolerance) return
      const candidate = { ...position, [axis]: value }
      if ((parent && (candidate.x < parent.x || candidate.y < parent.y + 24 ||
          end(candidate, 'x') > end(parent, 'x') || end(candidate, 'y') > end(parent, 'y'))) ||
          peers.some(peer => overlaps(candidate, peer))) return
      candidates.push({ offset, guides: lines, priority })
    }

    for (const peer of peers) {
      for (const fraction of [0, .5, 1]) {
        const at = peer[axis] + peer[size(axis)] * fraction
        add(at - length * fraction, [{
          kind: 'alignment',
          from: point(axis, at, Math.min(position[cross], peer[cross])),
          to: point(axis, at, Math.max(end(position, cross), end(peer, cross))),
        }], 1)
      }
    }
    const row = peers.filter(peer => peer[cross] < end(position, cross) && position[cross] < end(peer, cross))
      .sort((a, b) => a[axis] - b[axis])
    for (let i = 1; i < row.length; i++) {
      const a = row[i - 1], b = row[i]
      const left = end(a, axis), right = b[axis], gap = right - left
      if (gap < 4) continue
      const crossAt = Math.min(position[cross], a[cross], b[cross]) - 8
      const line = (from: number, to: number): PlacementGuide => ({
        kind: 'spacing', from: point(axis, from, crossAt), to: point(axis, to, crossAt),
      })
      add(a[axis] - gap - length, [line(a[axis] - gap, a[axis]), line(left, right)], 0)
      add(end(b, axis) + gap, [line(left, right), line(end(b, axis), end(b, axis) + gap)], 0)
      const even = (gap - length) / 2
      if (even >= 4) add(left + even, [line(left, left + even), line(right - even, right)], 0)
    }
    // When both guides are almost equally close, show the matching spacing first.
    const best = candidates.sort((a, b) => Math.abs(a.offset) + a.priority - Math.abs(b.offset) - b.priority)[0]
    if (best) {
      position[axis] += best.offset
      guides.push(...best.guides)
    }
  }
  return { position: { x: position.x, y: position.y }, guides }
}
