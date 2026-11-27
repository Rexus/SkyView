import { Handle, Position, type Node, type NodeProps } from '@xyflow/react'
import { GripHorizontal, Trash2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { DiagramNote } from '../types'
import { cx } from '../utils'

export type NoteNodeData = {
  note: DiagramNote
  targetName: string
  onChange: (id: string, text: string) => void
  onDelete: (id: string) => void
}

export type NoteFlowNode = Node<NoteNodeData, 'note'>

export default function NoteNode({ data, selected }: NodeProps<NoteFlowNode>) {
  const [text, setText] = useState(data.note.text)
  const [editing, setEditing] = useState(false)
  const latest = useRef(data.note.text)
  const saveTimer = useRef<number | null>(null)

  useEffect(() => {
    if (!editing && data.note.text !== latest.current) {
      latest.current = data.note.text
      setText(data.note.text)
    }
  }, [data.note.text, editing])

  useEffect(() => {
    return () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    }
  }, [])

  const flush = () => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = null
    }
    if (latest.current !== data.note.text) data.onChange(data.note.id, latest.current)
  }

  const schedule = (value: string) => {
    latest.current = value
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null
      if (latest.current !== data.note.text) data.onChange(data.note.id, latest.current)
    }, 600)
  }

  return (
    <div className={cx('note-node', selected && 'selected')}>
      <Handle
        type="source"
        position={Position.Right}
        id={`${data.note.id}-out`}
        style={{ background: 'var(--warning)' }}
      />
      <div className="note-node-head">
        <GripHorizontal size={12} style={{ color: 'var(--text-dim)' }} />
        <span className="note-label">note</span>
        <span className="note-target" title={data.targetName}>
          about {data.targetName}
        </span>
        <button
          className="icon-button nodrag"
          style={{ width: 22, height: 22, marginLeft: 'auto', color: 'var(--danger)' }}
          title="Delete note"
          onClick={(e) => {
            e.stopPropagation()
            data.onDelete(data.note.id)
          }}
        >
          <Trash2 size={11} />
        </button>
      </div>
      <textarea
        className="note-text nodrag nowheel"
        value={text}
        rows={4}
        spellCheck
        onFocus={() => setEditing(true)}
        onChange={(e) => {
          const value = e.target.value
          setText(value)
          schedule(value)
        }}
        onInput={(e) => {
          const value = (e.target as HTMLTextAreaElement).value
          setText(value)
          schedule(value)
        }}
        onBlur={() => {
          setEditing(false)
          flush()
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur()
        }}
        placeholder="Write a note…"
        style={editing ? { boxShadow: '0 0 0 2px var(--warning-soft)' } : undefined}
      />
      <div className="note-node-foot">drag to move · attached with a dashed line</div>
    </div>
  )
}
