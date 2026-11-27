import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { CircleAlert } from 'lucide-react'
import type { SysmlElement } from '../types'
import { cx, displayName, kindColor, shortKind } from '../utils'

export type SysmlNodeData = {
  element: SysmlElement
  ports: SysmlElement[]
  attributes: SysmlElement[]
  doc: string
  diagnostics: number
  selected?: boolean
  genericSource?: boolean
  genericTarget?: boolean
}

export type SysmlFlowNode = Node<SysmlNodeData, 'sysml'>

export default function SysmlNode({ data }: NodeProps<SysmlFlowNode>) {
  const { element, ports, attributes, doc, diagnostics, selected } = data
  const color = kindColor(element)
  return (
    <div
      className={cx('sysml-node', selected && 'selected', diagnostics > 0 && 'has-error')}
      style={{ ['--kind-color' as string]: color }}
    >
      <div className="sysml-node-head">
        <span className="kind-dot" />
        <span className="node-name" title={displayName(element)}>
          {displayName(element)}
        </span>
        <span className="node-kind">{element.isDef ? 'def' : element.kind}</span>
      </div>
      {element.type && (
        <div className="sysml-node-type" title={element.type}>
          <span className="arrow">:</span>
          {element.type}
        </div>
      )}
      {doc && (
        <div className="sysml-node-compartment sysml-node-doc" title={doc}>
          <div className="compartment-label">doc</div>
          <div className="compartment-doc">{doc}</div>
        </div>
      )}
      {attributes.length > 0 && (
        <div className="sysml-node-compartment">
          <div className="compartment-label">attributes</div>
          {attributes.slice(0, 4).map((attr) => (
            <div className="compartment-row" key={attr.id} title={`${attr.name}${attr.type ? ` : ${attr.type}` : ''}${attr.value ? ` = ${attr.value}` : ''}`}>
              <span className="compartment-name">{attr.name}</span>
              {attr.type && <span className="compartment-type">: {attr.type}</span>}
              {attr.value && <span className="compartment-value">= {attr.value}</span>}
            </div>
          ))}
          {attributes.length > 4 && (
            <div className="compartment-more">+{attributes.length - 4} more</div>
          )}
        </div>
      )}
      {ports.length > 0 ? (
        <div className="sysml-node-ports">
          {ports.map((port) => (
            <div className="port-row" key={port.id}>
              <Handle type="target" position={Position.Left} id={`${port.id}-in`} />
              <span className="port-dot" />
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {port.name}
              </span>
              <span className="port-type">{port.type || 'port'}</span>
              <Handle type="source" position={Position.Right} id={`${port.id}-out`} />
            </div>
          ))}
        </div>
      ) : (
        <div className="sysml-node-empty">no ports</div>
      )}
      {data.genericTarget && (
        <Handle
          type="target"
          position={Position.Left}
          id={`${element.id}-generic-in`}
          isConnectable={false}
          style={{ top: '50%', background: 'var(--accent-2)' }}
        />
      )}
      {data.genericSource && (
        <Handle
          type="source"
          position={Position.Right}
          id={`${element.id}-generic-out`}
          isConnectable={false}
          style={{ top: '50%', background: 'var(--accent-2)' }}
        />
      )}
      <div className="sysml-node-foot">
        {diagnostics > 0 && <CircleAlert size={10} style={{ color: 'var(--warning)' }} />}
        <span>{shortKind(element)}</span>
        {element.specializes && (
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            · specializes {element.specializes}
          </span>
        )}
      </div>
    </div>
  )
}
