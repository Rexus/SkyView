import { useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCheck,
  CircleAlert,
  Code2,
  Link2,
  Plus,
  Search,
  Trash2,
} from 'lucide-react'
import type { ElementPatch } from '../api'
import type { SysmlElement, SysmlModel } from '../types'
import {
  cx,
  depthOf,
  diagnosticsFor,
  displayName,
  kindColor,
  kindLabel,
  score,
  shortKind,
  editCapabilities,
} from '../utils'

interface Props {
  model: SysmlModel
  selectedId: string | null
  onSelect: (id: string) => void
  onPatch: (id: string, patch: ElementPatch) => Promise<void>
  onDelete: (id: string) => void
  onShowInSource: (line: number) => void
  onAddElement: (parent?: string) => void
  onAddConnection: (parent?: string) => void
  onAddSatisfy: (requirement?: string) => void
}

const kindFilters: Array<{ value: string; label: string }> = [
  { value: 'all', label: 'All elements' },
  { value: 'package', label: 'Packages' },
  { value: 'part-def', label: 'Part definitions' },
  { value: 'part', label: 'Part usages' },
  { value: 'port', label: 'Ports' },
  { value: 'attribute', label: 'Attributes' },
  { value: 'requirement', label: 'Requirements' },
  { value: 'connection', label: 'Connections' },
  { value: 'satisfy', label: 'Satisfy links' },
  { value: 'other', label: 'Other' },
]

function matchesFilter(el: SysmlElement, filter: string): boolean {
  switch (filter) {
    case 'all':
      return true
    case 'part-def':
      return el.kind === 'part' && el.isDef
    case 'part':
      return el.kind === 'part' && !el.isDef
    case 'package':
      return el.kind === 'package'
    case 'port':
      return el.kind === 'port'
    case 'attribute':
      return el.kind === 'attribute'
    case 'requirement':
      return el.kind === 'requirement'
    case 'connection':
      return el.kind === 'connection'
    case 'satisfy':
      return el.kind === 'satisfy'
    case 'other':
      return !['package', 'part', 'port', 'attribute', 'requirement', 'connection', 'satisfy'].includes(el.kind)
    default:
      return true
  }
}

export default function GridEditor(props: Props) {
  const {
    model,
    selectedId,
    onSelect,
    onPatch,
    onDelete,
    onShowInSource,
    onAddElement,
    onAddConnection,
    onAddSatisfy,
  } = props
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all')

  const rows = useMemo(() => {
    const all = model.elements.filter((e) => e.kind !== 'root')
    return all.filter((el) => {
      if (!matchesFilter(el, filter)) return false
      if (!query.trim()) return true
      return score(query, `${el.name} ${el.qname} ${el.kind} ${el.type ?? ''} ${el.doc ?? ''}`) > 0
    })
  }, [model, query, filter])

  return (
    <>
      <div className="view-toolbar">
        <div className="toolbar-search">
          <Search size={13} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search elements, types, docs…"
            spellCheck={false}
          />
        </div>
        <select className="select input-sm" style={{ width: 160 }} value={filter} onChange={(e) => setFilter(e.target.value)}>
          {kindFilters.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
        <div className="grow" />
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          {rows.length} of {model.elements.length - 1}
        </span>
        <button className="btn btn-sm" onClick={() => onAddConnection(selectedId ?? undefined)}>
          <Link2 size={13} /> Connection
        </button>
        <button className="btn btn-sm" onClick={() => onAddSatisfy()}>
          <CheckCheck size={13} /> Satisfy
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => onAddElement(selectedId ?? undefined)}>
          <Plus size={13} /> Element
        </button>
      </div>

      <div className="grid-wrap">
        {rows.length === 0 ? (
          <div className="empty-state">
            <div className="icon-wrap">
              <Search size={22} />
            </div>
            <h2>No matching elements</h2>
            <p>Try a different filter or clear the search. The grid shows every element in the model.</p>
            <button className="btn" onClick={() => { setQuery(''); setFilter('all') }}>
              Clear filters
            </button>
          </div>
        ) : (
          <table className="grid">
            <thead>
              <tr>
                <th className="col-element">Element</th>
                <th className="col-kind">Kind</th>
                <th className="col-type">Type / link</th>
                <th className="col-value">Value</th>
                <th className="col-doc">Documentation</th>
                <th className="col-actions" />
              </tr>
            </thead>
            <tbody>
              {rows.map((el) => (
                <GridRow
                  key={el.id}
                  el={el}
                  model={model}
                  selected={el.id === selectedId}
                  onSelect={onSelect}
                  onPatch={onPatch}
                  onDelete={onDelete}
                  onShowInSource={onShowInSource}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

function GridRow({
  el,
  model,
  selected,
  onSelect,
  onPatch,
  onDelete,
  onShowInSource,
}: {
  el: SysmlElement
  model: SysmlModel
  selected: boolean
  onSelect: (id: string) => void
  onPatch: (id: string, patch: ElementPatch) => Promise<void>
  onDelete: (id: string) => void
  onShowInSource: (line: number) => void
}) {
  const depth = depthOf(model, el)
  const diag = diagnosticsFor(model, el.id)
  const hasError = model.diagnostics.some((d) => d.elementId === el.id && d.severity === 'error')
  const capabilities = editCapabilities(el)
  const { name: canName, type: canType, value: canValue, doc: canDoc } = capabilities
  const docValue = el.docResolved || el.doc || ''
  const docTarget =
    el.kind === 'requirement' && !el.isDef && el.typeId ? el.typeId : el.id

  let typeText = el.type ?? ''
  if (['connection', 'dependency', 'message', 'succession'].includes(el.kind)) typeText = `${el.source ?? '?'} → ${el.target ?? '?'}`
  if (el.kind === 'satisfy') typeText = `${el.requirement ?? '?'} by ${el.satisfier ?? '?'}`
  if (el.kind === 'verify') typeText = el.requirement ?? ''
  if (el.kind === 'first') typeText = el.target ?? ''
  if (el.kind === 'package') typeText = ''

  return (
    <tr
      className={cx(selected && 'selected', hasError && 'has-error', diag > 0 && !hasError && 'has-warning')}
      onClick={() => onSelect(el.id)}
    >
      <td>
        <div className="cell-element" style={{ paddingLeft: depth * 12 }}>
          <span className="kind-dot" style={{ background: kindColor(el), width: 7, height: 7, borderRadius: 2 }} />
          {canName ? (
            <EditableCell
              value={el.name}
              className={cx('name', !el.name && 'dim')}
              placeholder="(unnamed)"
              onCommit={(v) => onPatch(el.id, { id: el.id, name: v })}
            />
          ) : (
            <span className="name">{displayName(el)}</span>
          )}
          {el.isDef && el.kind !== 'package' && <span className="badge badge-muted">def</span>}
          {diag > 0 && (
            <span className="meta" title={`${diag} diagnostics`}>
              <CircleAlert size={12} style={{ color: hasError ? 'var(--danger)' : 'var(--warning)' }} />
            </span>
          )}
        </div>
      </td>
      <td>
        <span className="badge badge-kind" style={{ ['--kind-color' as string]: kindColor(el) }}>
          {shortKind(el)}
        </span>
      </td>
      <td>
        {canType ? (
          <EditableCell
            value={typeText}
            className="cell-mono"
            placeholder="(no type)"
            onCommit={(v) => onPatch(el.id, { id: el.id, type: v })}
          />
        ) : (
          <span className="cell-mono">{typeText || '—'}</span>
        )}
      </td>
      <td>
        {canValue ? (
          <EditableCell
            value={el.value ?? ''}
            className="cell-mono"
            placeholder="—"
            onCommit={(v) => onPatch(el.id, { id: el.id, value: v })}
          />
        ) : (
          <span className="cell-mono" style={{ color: 'var(--text-dim)' }}>
            {el.expression || (el.multiplicity ? `[${el.multiplicity}]` : '—')}
          </span>
        )}
      </td>
      <td>
        {canDoc ? <EditableCell
          value={docValue}
          className="cell-text"
          placeholder="—"
          multiline
          onCommit={(v) => onPatch(docTarget, { id: docTarget, doc: v })}
        /> : <span className="cell-text">{docValue || '—'}</span>}
      </td>
      <td>
        <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
          <button
            className="icon-button row-action"
            style={{ width: 24, height: 24 }}
            title="Show in source"
            onClick={(e) => {
              e.stopPropagation()
              onShowInSource(el.line)
            }}
          >
            <Code2 size={12} />
          </button>
          <button
            className="icon-button row-action"
            style={{ width: 24, height: 24, color: 'var(--danger)' }}
            disabled={!capabilities.delete}
            title={capabilities.delete ? 'Delete element' : 'Implicit ordering belongs to its following declaration'}
            onClick={(e) => {
              e.stopPropagation()
              onDelete(el.id)
            }}
          >
            <Trash2 size={12} />
          </button>
        </div>
      </td>
    </tr>
  )
}

function EditableCell({
  value,
  className,
  placeholder,
  multiline,
  onCommit,
}: {
  value: string
  className?: string
  placeholder?: string
  multiline?: boolean
  onCommit: (value: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [busy, setBusy] = useState(false)
  const cancelled = useRef(false)

  useEffect(() => {
    if (!editing) setDraft(value)
  }, [value, editing])

  const begin = () => {
    cancelled.current = false
    setDraft(value)
    setEditing(true)
  }

  const commit = async () => {
    if (cancelled.current) {
      setEditing(false)
      return
    }
    setEditing(false)
    if (draft === value) return
    setBusy(true)
    try {
      await onCommit(draft)
    } finally {
      setBusy(false)
    }
  }

  if (!editing) {
    return (
      <span
        className={cx('cell-text', className)}
        onClick={(e) => {
          e.stopPropagation()
          begin()
        }}
        title={value || placeholder}
        style={busy ? { opacity: 0.55 } : undefined}
      >
        {value || <span style={{ color: 'var(--text-dim)' }}>{placeholder}</span>}
      </span>
    )
  }

  const common = {
    autoFocus: true,
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setDraft(e.target.value),
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
    onKeyDown: (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === 'Escape') {
        cancelled.current = true
        ;(e.target as HTMLElement).blur()
        return
      }
      if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        ;(e.target as HTMLElement).blur()
      }
    },
    onBlur: () => void commit(),
    placeholder,
  }

  return multiline ? (
    <textarea className="cell-editor textarea" {...common} rows={3} />
  ) : (
    <input className="cell-editor" {...common} spellCheck={false} />
  )
}
