import dagre from 'dagre'

export interface LayoutItem {
  id: string
  width: number
  height: number
}

export interface LayoutLink {
  source: string
  target: string
}

type Position = { x: number; y: number }
type Placement = LayoutItem & Position
type Direction = 'LR' | 'TB'

function size(items: Placement[]) {
  return items.reduce((bounds, item) => ({
    width: Math.max(bounds.width, item.x + item.width),
    height: Math.max(bounds.height, item.y + item.height),
  }), { width: 0, height: 0 })
}

function centre(item: Placement): Position {
  return { x: item.x + item.width / 2, y: item.y + item.height / 2 }
}

function cross(a: Position, b: Position, c: Position, d: Position) {
  const side = (p: Position, q: Position, r: Position) =>
    (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)
  return side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0
}

function score(items: Placement[], links: LayoutLink[], gap: number) {
  const { width, height } = size(items)
  const aspect = Math.max(width / height, height / width)
  const span = Math.max(width / (4 / 3), height)
  const shape = span + Math.sqrt(width * height) * .18 + span * Math.max(0, Math.log(aspect / (4 / 3))) * .65
  if (!links.length) return shape
  const byId = new Map(items.map(item => [item.id, item]))
  // Bound the search for dense diagrams while sampling across the whole view.
  const step = Math.ceil(links.length / 100)
  const paths = links.filter((_, i) => i % step === 0).map(link => ({
    ...link, from: centre(byId.get(link.source)!), to: centre(byId.get(link.target)!),
  }))
  let length = 0
  let crossings = 0
  let obstructions = 0
  for (const [i, p] of paths.entries()) {
    length += Math.abs(p.from.x - p.to.x) + Math.abs(p.from.y - p.to.y)
    for (let j = 0; j < i; j++) {
      const q = paths[j]
      if (p.source !== q.source && p.source !== q.target && p.target !== q.source && p.target !== q.target &&
        cross(p.from, p.to, q.from, q.to)) crossings++
    }
    for (const box of items) {
      if (box.id === p.source || box.id === p.target) continue
      const left = box.x + 2, right = box.x + box.width - 2
      const top = box.y + 2, bottom = box.y + box.height - 2
      if (cross(p.from, p.to, { x: left, y: top }, { x: right, y: bottom }) ||
          cross(p.from, p.to, { x: left, y: bottom }, { x: right, y: top })) obstructions++
    }
  }
  return shape + (length * .28 + gap * (crossings * 4 + obstructions * 7)) / Math.sqrt(paths.length)
}

function laneCounts(items: LayoutItem[], gap: number, direction: Direction) {
  const n = items.length
  if (n <= 12) return Array.from({ length: n }, (_, i) => i + 1)
  const horizontal = direction === 'LR'
  const tile = items.reduce((sum, item) => ({
    width: sum.width + item.width + gap, height: sum.height + item.height + gap,
  }), { width: 0, height: 0 })
  const along = horizontal ? tile.width : tile.height
  const across = horizontal ? tile.height : tile.width
  const ideal = Math.round(Math.sqrt(n * across / along * (horizontal ? 1.2 : 1 / 1.2)))
  return [...new Set([2, ideal - 3, ideal - 2, ideal - 1, ideal, ideal + 1, ideal + 2, ideal + 3, n])]
    .filter(count => count > 0 && count <= n)
}

function pack(items: LayoutItem[], perLane: number, gap: number, direction: Direction, snake: boolean): Placement[] {
  const across = direction === 'LR' ? 'height' : 'width'
  const along = direction === 'LR' ? 'width' : 'height'
  const lanes: LayoutItem[][] = []
  for (let i = 0; i < items.length; i += perLane) lanes.push(items.slice(i, i + perLane))
  const extent = Math.max(...lanes.map(lane => lane.reduce((sum, item) => sum + item[along] + gap, -gap)))
  let offset = 0
  return lanes.flatMap((lane, i) => {
    const reverse = snake && i % 2 === 1
    const thickness = Math.max(...lane.map(item => item[across]))
    let cursor = reverse ? extent : 0
    const placed = lane.map(item => {
      const u = reverse ? cursor - item[along] : cursor
      const v = offset + (thickness - item[across]) / 2
      cursor += (item[along] + gap) * (reverse ? -1 : 1)
      return { ...item, x: direction === 'LR' ? u : v, y: direction === 'LR' ? v : u }
    })
    offset += thickness + gap
    return placed
  })
}

function layered(items: LayoutItem[], links: LayoutLink[], gap: number, rankGap: number, direction: Direction): Placement[] {
  const graph = new dagre.graphlib.Graph()
  graph.setGraph({ rankdir: direction, nodesep: gap, ranksep: rankGap })
  for (const item of items) graph.setNode(item.id, { width: item.width, height: item.height })
  for (const link of links) {
    const weight = (graph.edge(link.source, link.target)?.weight ?? 0) + 1
    graph.setEdge(link.source, link.target, { weight })
  }
  dagre.layout(graph)
  return items.map(item => {
    const node = graph.node(item.id)
    return { ...item, x: node.x - item.width / 2, y: node.y - item.height / 2 }
  })
}

/** Lay out each connected component, then pack the components into one canvas. */
export function layoutFlow(
  items: LayoutItem[], links: LayoutLink[], direction: Direction, gap: number, rankGap = gap + 32,
): Record<string, Position> {
  const byId = new Map(items.map(item => [item.id, item]))
  const neighbors = new Map(items.map(item => [item.id, new Set<string>()]))
  const resolved = links.filter(link => link.source !== link.target && byId.has(link.source) && byId.has(link.target))
  for (const { source, target } of resolved) {
    neighbors.get(source)!.add(target)
    neighbors.get(target)!.add(source)
  }
  const groupOf = new Map<string, number>()
  const groups: string[][] = []
  for (const { id } of items) {
    if (groupOf.has(id)) continue
    const group = [id]
    const index = groups.push(group) - 1
    groupOf.set(id, index)
    for (const key of group) {
      for (const neighbor of neighbors.get(key)!) {
        if (groupOf.has(neighbor)) continue
        groupOf.set(neighbor, index)
        group.push(neighbor)
      }
    }
  }
  const linksByGroup = groups.map(() => [] as LayoutLink[])
  for (const link of resolved) linksByGroup[groupOf.get(link.source)!].push(link)

  const other = direction === 'LR' ? 'TB' : 'LR'
  const directions = [direction, other] as const
  const components = groups.map((group, index) => {
    const members = group.map(id => byId.get(id)!)
    const edges = linksByGroup[index]
    if (members.length === 1) return [{ ...members[0], x: 0, y: 0 }]

    let best = layered(members, edges, gap, rankGap, direction)
    let bestCost = score(best, edges, gap)
    const consider = (candidate: Placement[], axis: Direction) => {
      const cost = score(candidate, edges, gap) * (axis === direction ? 1 : 1.06)
      if (cost < bestCost) { best = candidate; bestCost = cost }
    }
    const horizontal = direction === 'LR'
    const order = [...best].sort((a, b) => horizontal ? a.x - b.x || a.y - b.y : a.y - b.y || a.x - b.x)
    consider(layered(members, edges, gap, rankGap, other), other)
    const degree = (id: string) => neighbors.get(id)!.size
    const hub = order.reduce((h, item, i) => degree(item.id) > degree(order[h].id) ? i : h, 0)
    const highDegree = degree(order[hub].id) >= Math.max(4, members.length / 3)
    for (const axis of directions) {
      for (const count of laneCounts(order, gap, axis)) {
        const folded = pack(order, count, gap, axis, true)
        consider(folded, axis)
        if (!highDegree || count === 1 || count === order.length) continue
        const { width, height } = size(folded)
        const distance = (item: Placement) => {
          const { x, y } = centre(item)
          return Math.abs(x - width / 2) + Math.abs(y - height / 2)
        }
        const middle = folded.reduce((best, item, i) => distance(item) < distance(folded[best]) ? i : best, 0)
        if (hub === middle) continue
        const centred = [...order]
        centred[hub] = order[middle]
        centred[middle] = order[hub]
        consider(pack(centred, count, gap, axis, true), axis)
      }
    }
    return best
  })
  if (components.length < 2) {
    return Object.fromEntries((components[0] ?? []).map(item => [item.id, { x: Math.round(item.x), y: Math.round(item.y) }]))
  }

  const clusters = components.map((component, index) => ({ id: String(index), ...size(component) }))
    .sort((a, b) => b.width * b.height - a.width * a.height)
  const groupGap = gap + (resolved.length ? 16 : 0)
  let best = pack(clusters, 1, groupGap, direction, false)
  let bestCost = score(best, [], groupGap)
  for (const axis of directions) {
    for (const count of laneCounts(clusters, groupGap, axis)) {
      const candidate = pack(clusters, count, groupGap, axis, false)
      const cost = score(candidate, [], groupGap)
      if (cost < bestCost) { best = candidate; bestCost = cost }
    }
  }
  return Object.fromEntries(best.flatMap(cluster => components[Number(cluster.id)].map(item => [
    item.id, { x: Math.round(cluster.x + item.x), y: Math.round(cluster.y + item.y) },
  ])))
}
