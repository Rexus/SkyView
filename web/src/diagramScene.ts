export interface ScenePort { id: string; name: string; type: string; y: number }
export interface SceneNode { key: string; elementId?: string; annotation?: boolean; parent?: string; x: number; y: number; width: number; height: number; svg: string; ports: ScenePort[] }
export interface SceneEdge { key: string; elementId: string; from: string; to: string; points: [number, number][]; label: string; svg: string }
export interface DiagramScene { svg: string; resources: string; nodes: SceneNode[]; edges: SceneEdge[] }
export const sceneNodeId = (node: SceneNode) => node.elementId || `annotation:${node.key}`
export function parentFirst(nodes: SceneNode[]): SceneNode[] {
 const remaining = [...nodes], result: SceneNode[] = [], placed = new Set<string>()
 while (remaining.length) {
  const index = remaining.findIndex(n => !n.parent || placed.has(n.parent))
  if (index < 0) throw new Error('The diagram contains an unresolved or cyclic parent.')
  const [node] = remaining.splice(index, 1); result.push(node); placed.add(node.key)
 }
 return result
}
export function relativePosition(node: SceneNode, scene: DiagramScene) {
 const parent = scene.nodes.find(n => n.key === node.parent)
 return { x: node.x - (parent?.x || 0), y: node.y - (parent?.y || 0) }
}
