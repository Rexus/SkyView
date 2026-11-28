import type { ReactFlowInstance } from '@xyflow/react'
import { anchor, segments } from './sharedRouting'
import type { SceneNode } from './diagramScene'
import type { Point } from './sharedViews'
import type { ConnectorGeometry } from './connectorRoutes'

export function readConnectorGeometry(flow: ReactFlowInstance, id: string, source: string, target: string): ConnectorGeometry {
  const from = flow.getNodesBounds([source]), to = flow.getNodesBounds([target])
  const endpoints = new Set([source, target])
  const ancestors = new Set<string>()
  for (const id of endpoints) {
    let parent = flow.getNode(id)?.parentId
    while (parent && !ancestors.has(parent)) {
      ancestors.add(parent)
      parent = flow.getNode(parent)?.parentId
    }
  }
  const obstacles = flow.getNodes().filter(node => !node.hidden && node.type !== 'boundary' && !ancestors.has(node.id))
    .map(node => flow.getNodesBounds([node]))
  const used: Point[] = []
  const occupied = flow.getEdges().flatMap(edge => {
    if (edge.id === id || !Array.isArray(edge.data?.points) || edge.data.points.length < 2) return []
    const route = edge.data.points as Point[]
    if (endpoints.has(edge.source)) used.push(route[0])
    if (endpoints.has(edge.target)) used.push(route.at(-1)!)
    return segments(route).filter(([a, b]) => a[0] === b[0] || a[1] === b[1])
  })
  for (const [id, box] of [[source, from], [target, to]] as const) {
    const glyph = flow.getNode(id)?.data.glyph as SceneNode | undefined
    for (const port of glyph?.ports ?? []) used.push(anchor(box, 'left', port.y), anchor(box, 'right', port.y))
  }
  return { source: from, target: to, obstacles, occupied, used }
}
