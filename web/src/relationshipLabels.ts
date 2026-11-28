import type { Point } from './sharedViews'
import type { RouteBox, RouteSegment } from './sharedRouting'
import { routeLabel, segments } from './sharedRouting.ts'

export interface RouteLabel {
  position: Point
  bounds: RouteBox
  leader?: RouteSegment
}

// Relationship labels use 11px Arial in both the canvas and SVG. Allow extra
// room for the text halo and use conservative widths for unfamiliar glyphs.
export function labelWidth(text: string) {
  return 12 + Array.from(text).reduce((width, c) => width +
    (/[ .,:;!'ilI1]/.test(c) ? 4 : /[MW@%&mw]/.test(c) ? 11 : /[A-Z0-9]/.test(c) ? 9 : /[!-~]/.test(c) ? 7 : 14), 0)
}

const overlaps = (a: RouteBox, b: RouteBox) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height

function lineBounds([[x, y], [u, v]]: RouteSegment): RouteBox {
  return { x: Math.min(x, u) - 2, y: Math.min(y, v) - 2, width: Math.abs(u - x) + 4, height: Math.abs(v - y) + 4 }
}

export function labelBounds(text: string, [x, y]: Point): RouteBox {
  const width = labelWidth(text)
  return { x: x - width / 2, y: y - 12, width, height: 17 }
}

export function isLabelPosition(value: unknown): value is Point {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite)
}

/** Connect the nearest point of the path to the outside of the text and its halo. */
export function labelLeader(points: Point[], bounds: RouteBox): RouteSegment | undefined {
  const center: Point = [bounds.x + bounds.width / 2, bounds.y + bounds.height / 2]
  let nearest: Point | undefined, best = Infinity
  for (const [[x, y], [u, v]] of segments(points)) {
    const dx = u - x, dy = v - y
    const length = dx * dx + dy * dy
    if (!length) continue
    const t = Math.max(0, Math.min(1, ((center[0] - x) * dx + (center[1] - y) * dy) / length))
    const point: Point = [x + dx * t, y + dy * t]
    const distance = Math.hypot(point[0] - center[0], point[1] - center[1])
    if (distance < best) { nearest = point; best = distance }
  }
  if (!nearest) return
  const dx = nearest[0] - center[0], dy = nearest[1] - center[1]
  const scale = Math.max(Math.abs(dx) / (bounds.width / 2), Math.abs(dy) / (bounds.height / 2))
  if (scale > 1) return [nearest, [center[0] + dx / scale, center[1] + dy / scale]]
}

export function placeRouteLabels(
  routes: { points: Point[]; text: string; boxes?: RouteBox[]; fixed?: Point; showLeader?: boolean }[], boxes: RouteBox[],
  canvas?: RouteBox,
): (RouteLabel | undefined)[] {
  const occupied = routes.flatMap(route => segments(route.points).map(lineBounds))
  const labels = routes.flatMap(({ text, fixed }) => text && isLabelPosition(fixed) ? [labelBounds(text, fixed)] : [])
  const floor = Math.max(0, ...boxes.map(box => box.y + box.height), ...occupied.map(box => box.y + box.height))
  let nextRow = floor + 20
  return routes.map(({ text, points, boxes: localBoxes, fixed, showLeader }) => {
    if (!text || points.length < 2) return undefined
    if (isLabelPosition(fixed)) {
      const bounds = labelBounds(text, fixed)
      return { position: fixed, bounds, leader: showLeader ? labelLeader(points, bounds) : undefined }
    }
    const width = labelWidth(text)
    const available = (bounds: RouteBox) =>
      (!canvas || (bounds.x >= canvas.x && bounds.y >= canvas.y &&
        bounds.x + bounds.width <= canvas.x + canvas.width && bounds.y + bounds.height <= canvas.y + canvas.height)) &&
      !(localBoxes ?? boxes).some(box => overlaps(bounds, box)) &&
      !labels.some(box => overlaps(bounds, box))
    const clear = (bounds: RouteBox) => available(bounds) && !occupied.some(box => overlaps(bounds, box))
    const legs = segments(points).flatMap(([[x, y], [u, v]]) => {
      if (x === u && y === v || x !== u && y !== v) return []
      return [{ x, y, u, v, length: Math.abs(u - x) + Math.abs(v - y), horizontal: y === v }]
    }).sort((a, b) => b.length - a.length)
    let best: RouteLabel | undefined
    let bestCost = Infinity
    for (const { x, y, u, v, length, horizontal } of legs) {
      for (const fraction of [.5, .33, .67, .18, .82]) {
        const base: Point = [x + (u - x) * fraction, y + (v - y) * fraction]
        for (const side of [-1, 1]) {
          const position: Point = horizontal
            ? [base[0], base[1] + (side < 0 ? -8 : 16)]
            : [base[0] + side * (width / 2 + 5), base[1] + 4]
          const cost = (horizontal ? (side < 0 ? 0 : 4) : 13) +
            Math.max(0, width - length) * .25 + Math.abs(fraction - .5) * 15
          if (cost >= bestCost) continue
          const bounds = labelBounds(text, position)
          if (clear(bounds)) { best = { position, bounds }; bestCost = cost }
        }
      }
    }
    if (!best) {
      // In a narrow channel, the text halo keeps an inline label legible.
      // Keep it anchored to this route instead of sending it outside the drawing.
      for (const { x, y, u, v, length, horizontal } of legs) {
        for (const fraction of [.5, .33, .67, .18, .82]) {
          const at: Point = [x + (u - x) * fraction, y + (v - y) * fraction]
          const positions: Point[] = horizontal
            ? [[at[0], at[1] - 8], [at[0], at[1] + 16], [at[0], at[1] + 4]]
            : [[at[0], at[1] + 4]]
          for (const [index, position] of positions.entries()) {
            const bounds = labelBounds(text, position)
            if (!available(bounds)) continue
            const intersections = occupied.filter(box => overlaps(bounds, box)).length
            const cost = intersections * 9 + index * 3 + Math.abs(fraction - .5) * 15 +
              (horizontal ? Math.max(0, width - length) * .12 : 6)
            if (cost < bestCost) { best = { position, bounds }; bestCost = cost }
          }
        }
      }
    }
    if (!best && !canvas) {
      // Short leaders keep a crowded label attached to its own segment.
      for (const { x, y, u, v } of legs) {
        for (const fraction of [.5, .25, .75]) {
          const leader: Point = [x + (u - x) * fraction, y + (v - y) * fraction]
          for (const offset of [-29, 31, -46, 48, -63, 65]) {
            const position: Point = [leader[0], leader[1] + offset]
            const bounds = labelBounds(text, position)
            const cost = Math.abs(offset) + Math.abs(fraction - .5) * 18
            if (cost < bestCost && clear(bounds)) { best = { position, bounds, leader: labelLeader(points, bounds) }; bestCost = cost }
          }
        }
      }
    }
    if (!best && !canvas) {
      const [x] = routeLabel(points)
      const position: Point = [x, nextRow + 12]
      const bounds = labelBounds(text, position)
      best = { position, bounds, leader: labelLeader(points, bounds) }
      nextRow += 22
    }
    if (best) labels.push(best.bounds)
    return best
  })
}
