import type { Point } from './sharedViews'
import type { RouteBox, RouteSegment } from './sharedRouting'
import { routeLabel, segments } from './sharedRouting.ts'

export interface RouteLabel {
  position: Point
  bounds: RouteBox
  leader?: Point
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

export function placeRouteLabels(
  routes: { points: Point[]; text: string; boxes?: RouteBox[]; fixed?: Point }[], boxes: RouteBox[],
  canvas?: RouteBox,
): (RouteLabel | undefined)[] {
  const occupied = routes.flatMap(route => segments(route.points).map(lineBounds))
  const rect = (text: string, [x, y]: Point): RouteBox => {
    const width = labelWidth(text)
    return { x: x - width / 2, y: y - 12, width, height: 17 }
  }
  const labels = routes.flatMap(({ text, fixed }) => text && fixed ? [rect(text, fixed)] : [])
  const floor = Math.max(0, ...boxes.map(box => box.y + box.height), ...occupied.map(box => box.y + box.height))
  let nextRow = floor + 20
  return routes.map(({ text, points, boxes: localBoxes, fixed }) => {
    if (!text || points.length < 2 || fixed) return undefined
    const width = labelWidth(text)
    const clear = (bounds: RouteBox) =>
      (!canvas || (bounds.x >= canvas.x && bounds.y >= canvas.y &&
        bounds.x + bounds.width <= canvas.x + canvas.width && bounds.y + bounds.height <= canvas.y + canvas.height)) &&
      !(localBoxes ?? boxes).some(box => overlaps(bounds, box)) &&
      !labels.some(box => overlaps(bounds, box)) && !occupied.some(box => overlaps(bounds, box))
    const legs = segments(points).flatMap(([[x, y], [u, v]]) => {
      if (x === u && y === v || x !== u && y !== v) return []
      return [{ x, y, u, v, length: Math.abs(u - x) + Math.abs(v - y), horizontal: y === v }]
    }).sort((a, b) => b.length - a.length)
    let best: RouteLabel | undefined
    let bestCost = Infinity
    for (const { x, y, u, v, length, horizontal } of legs) {
      for (const fraction of [.5, .25, .75]) {
        const base: Point = [x + (u - x) * fraction, y + (v - y) * fraction]
        for (const side of [-1, 1]) {
          const position: Point = horizontal
            ? [base[0], base[1] + (side < 0 ? -8 : 16)]
            : [base[0] + side * (width / 2 + 5), base[1] + 4]
          const cost = (horizontal ? 0 : 6) + Math.max(0, width - length) * .45 + Math.abs(fraction - .5) * 18
          if (cost >= bestCost) continue
          const bounds = rect(text, position)
          if (clear(bounds)) { best = { position, bounds }; bestCost = cost }
        }
      }
    }
    if (!best && !canvas) {
      const [x, y] = routeLabel(points)
      const position: Point = [x, nextRow + 12]
      best = { position, bounds: rect(text, position), leader: [x, y + 10] }
      nextRow += 22
    }
    if (best) labels.push(best.bounds)
    return best
  })
}
