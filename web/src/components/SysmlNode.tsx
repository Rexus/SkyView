import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import type { SysmlElement } from '../types'
import type { SceneNode } from '../diagramScene'
import { cx } from '../utils'
import { genericHandles } from '../modelDiagramRouting'

export type SysmlNodeData = {
 element: SysmlElement; ports: SysmlElement[]; attributes: SysmlElement[]; doc: string; diagnostics: number
 selected?: boolean; genericSource?: boolean; genericTarget?: boolean
 glyph?: SceneNode; viewKey?: string; layoutTarget?: boolean; settingsLabel?: string; onSettings?: (key: string) => void
}
export type SysmlFlowNode = Node<SysmlNodeData, 'sysml'>
/** The engine's drawing is a glyph of this native node, not a diagram image.
 * Selection, dragging, ports, source inspection and nesting belong to ReactFlow. */
export function GlyphNode({ data, selected, annotation = false }: { data: Partial<SysmlNodeData>; selected?: boolean; annotation?: boolean }) {
 const glyph = data.glyph
 if (!glyph) return <div className="native-node-loading" role="status">Loading element…</div>
 const element = data.element
 return <div className={cx('native-diagram-node', (selected || data.selected) && 'selected', annotation && 'annotation')}
  data-layout-target={data.layoutTarget || undefined} data-native-id={element?.id} data-view-key={data.viewKey || glyph.key} style={{width:glyph.width,height:glyph.height}} title={element?.qname || data.settingsLabel}>
  <div className="node-glyph" dangerouslySetInnerHTML={{__html:glyph.svg}} />
  {!annotation && glyph.ports.map(port => <span key={port.id}>
   <Handle type="target" position={Position.Left} id={`${port.id}-in`} isConnectable={element?.kind === "part" && !element.isDef} title={`${port.name} : ${port.type}`} style={{top:port.y}} />
   <Handle type="source" position={Position.Right} id={`${port.id}-out`} isConnectable={element?.kind === "part" && !element.isDef} title={`${port.name} : ${port.type}`} style={{top:port.y}} />
  </span>)}
  {!annotation && element && genericHandles(element.id).map(({ id, type, side }) =>
   <Handle key={id} id={id} type={type} position={side as Position} isConnectable={false} className="generic-handle" />,
  )}
  {data.onSettings && <button className="node-settings nodrag nopan" aria-label={`Settings for ${data.settingsLabel || glyph.key}`} onClick={event => {event.stopPropagation();data.onSettings?.(glyph.key)}}>⚙</button>}
 </div>
}
export default function SysmlNode({data,selected}: NodeProps<SysmlFlowNode>) { return <GlyphNode data={data} selected={selected} /> }
