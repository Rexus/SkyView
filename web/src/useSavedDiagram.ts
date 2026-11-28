import { useEffect, useRef } from 'react'
import { useNodesState, useEdgesState, type Node, type Edge } from '@xyflow/react'
import type { DiagramScene } from './diagramScene'
import { parentFirst, relativePosition, sceneNodeId } from './diagramScene'
import { lockedParent, boxesOf, boxKey, interiorLocked } from './sharedViews'
import type { SharedView } from './sharedViews'
import type { SysmlModel } from './types'
import { visibleOwner } from './sourceNavigation'
import { canEditSavedConnector } from './savedDiagramRouting'
import { labelBounds } from './relationshipLabels'

export function useSavedDiagram(scene: DiagramScene | null, view: SharedView | undefined, model: SysmlModel, picked: string[], busy: boolean, onToggleLock: (key:string)=>void, selectedId?: string | null, layoutTarget?: string, draftView?: SharedView) {
 const [nodes,setNodes,onNodesChange]=useNodesState<Node>([])
 const [edges,setEdges,onEdgesChange]=useEdgesState<Edge>([])
 const lastScene = useRef<DiagramScene | null>(null)
 useEffect(()=>{
  const sameScene = lastScene.current === scene
  lastScene.current = scene
  if(!scene || !view) {setNodes([]);setEdges([]);return}
  const byKey = new Map(scene.nodes.map(n=>[n.key,n])), elements = new Map(model.elements.map(e=>[e.id,e]))
  const visible = visibleOwner(model, selectedId, new Set(scene.nodes.flatMap(node => node.elementId ? [node.elementId] : [])))
  const locks = draftView ?? view
  const boxes = new Map(boxesOf(locks).map(box => [boxKey(box), box]))
  setNodes(current => {
   const positions = sameScene ? new Map(current.map(node => [node.id, node.position])) : new Map()
   return parentFirst(scene.nodes).map(n => {
    const parent = byKey.get(n.parent || ''), element = elements.get(n.elementId || '')
    const box = boxes.get(n.key)
    const inherited = lockedParent(locks, n.key)
    const ownLock = interiorLocked(box?.layout)
    return {id:sceneNodeId(n),type:n.annotation?'boundary':'sysml',parentId:parent?sceneNodeId(parent):undefined,
     position:positions.get(sceneNodeId(n)) ?? relativePosition(n,scene),width:n.width,height:n.height,style:{width:n.width,height:n.height},
     selected:picked.includes(n.key) || (!!visible && visible === n.elementId),draggable:!busy&&!inherited&&!box?.layout?.positionLocked,deletable:false,
     data:{element,glyph:n,ports:[],attributes:[],doc:'',diagnostics:0,viewKey:n.key,settingsLabel: box && 'label' in box ? box.label : element?.name || n.key,
      layoutTarget: layoutTarget === n.key, ownLock, inheritedLock: inherited, onToggleLock: box ? onToggleLock : undefined}}
   })
  })
  setEdges(scene.edges.map(e=>{
   const from=byKey.get(e.from)!,to=byKey.get(e.to)!,route=view.edges.find(r=>r.element===e.key)
   const relationship = elements.get(e.elementId)
   return {id:e.elementId,source:sceneNodeId(from),target:sceneNodeId(to),sourceHandle:`${from.elementId}-generic-out`,targetHandle:`${to.elementId}-generic-in`,type:'relationship',zIndex:1000,label:e.label,selected: selectedId === e.elementId,
    data:{kind:relationship?.kind,points:e.points,labelPosition:route?.label,elementId:e.elementId,
     labelMoved:route?.labelMoved,labelLeader:e.labelLeader,labelBounds:e.label && route ? labelBounds(e.label, route.label) : undefined,
     movableAttachments: {
      source: !from.ports.some(port => port.id === relationship?.sourceId),
      target: !to.ports.some(port => port.id === relationship?.targetId),
     },
     routeEditable:!busy && canEditSavedConnector(view,e.from,e.to)}}
  }))
 // Drawing updates are tied to validated source/view snapshots. Settings callback is refreshed by its caller.
 },[scene,view,model,picked,busy,setNodes,setEdges,onToggleLock,selectedId,layoutTarget,draftView])
 return {nodes,edges,onNodesChange,onEdgesChange}
}
