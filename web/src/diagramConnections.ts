import type { Connection } from '@xyflow/react'
import type { SysmlElement, SysmlModel } from './types'
import { byId } from './utils.ts'

type PortEndpoint = { nodeId: string; portId: string }
export type DiagramPortConnection = { from: PortEndpoint; to: PortEndpoint }
export type AddDiagramConnection = (connection: DiagramPortConnection) => Promise<SysmlElement | undefined>

/** Resolve the real handles, leaving reference syntax and scope checks to the server. */
export async function connectModelPorts(model: SysmlModel, params: Connection, add: AddDiagramConnection) {
 const sourcePort = byId(model, params.sourceHandle?.endsWith('-out') ? params.sourceHandle.slice(0, -4) : undefined)
 const targetPort = byId(model, params.targetHandle?.endsWith('-in') ? params.targetHandle.slice(0, -3) : undefined)
 const source = byId(model, params.source), target = byId(model, params.target)
 if (!source || !target || sourcePort?.kind !== 'port' || targetPort?.kind !== 'port') return
 return add({
  from: { nodeId: source.id, portId: sourcePort.id },
  to: { nodeId: target.id, portId: targetPort.id },
 })
}
