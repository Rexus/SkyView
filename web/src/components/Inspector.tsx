import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  CircleAlert,
  Code2,
  Link2,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import type { ElementPatch } from '../api'
import type { SysmlElement, SysmlModel } from '../types'
import {
  byId,
  cx,
  diagnosticsFor,
  displayName,
  kindColor,
  kindLabel,
  shortKind,
  satisfiesFor,
} from '../utils'

interface Props {
  model: SysmlModel
  element: SysmlElement
  onClose: () => void
  onPatch: (id: string, patch: ElementPatch) => Promise<void>
  onDelete: (id: string) => void
  onShowInSource: (line: number) => void
  onSelect: (id: string) => void
}

export default function Inspector({
  model,
  element,
  onClose,
  onPatch,
  onDelete,
  onShowInSource,
  onSelect,
}: Props) {
  const [name, setName] = useState(element.name)
  const [type, setType] = useState(element.type ?? '')
  const [value, setValue] = useState(element.value ?? '')
  const [doc, setDoc] = useState(element.doc ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setName(element.name)
    setType(element.type ?? '')
    setValue(element.value ?? '')
    setDoc(element.doc ?? '')
  }, [element.id, element.name, element.type, element.value, element.doc])

  const isRoot = element.kind === 'root'
  const isConnection = element.kind === 'connection'
  const isSatisfy = element.kind === 'satisfy'
  const isRequirement = element.kind === 'requirement'
  const canName = !isRoot && !isSatisfy
  const canType = !isRoot && !isConnection && !isSatisfy && element.kind !== 'package'
  const canValue = !isRoot && !isConnection && !isSatisfy && (element.kind === 'attribute' || element.value !== undefined)
  const canDoc = !isRoot
  const diagCount = diagnosticsFor(model, element.id)
  const parent = byId(model, element.parentId)
  const satisfies = useMemo(
    () => (isRequirement ? satisfiesFor(model, element) : []),
    [model, element, isRequirement],
  )

  const dirty =
    (canName && name !== element.name) ||
    (canType && type !== (element.type ?? '')) ||
    (canValue && value !== (element.value ?? '')) ||
    (canDoc && doc !== (element.doc ?? ''))

  const save = async () => {
    if (!dirty || saving) return
    const patch: ElementPatch = { id: element.id }
    if (canName && name !== element.name) patch.name = name
    if (canType && type !== (element.type ?? '')) patch.type = type
    if (canValue && value !== (element.value ?? '')) patch.value = value
    if (canDoc && doc !== (element.doc ?? '')) patch.doc = doc
    setSaving(true)
    try {
      await onPatch(element.id, patch)
    } finally {
      setSaving(false)
    }
  }

  return (
    <aside className="inspector">
      <div className="inspector-head">
        <span
          className="kind-dot"
          style={{
            width: 10,
            height: 10,
            borderRadius: 3,
            background: kindColor(element),
            marginTop: 5,
            flex: '0 0 auto',
            boxShadow: `0 0 10px ${kindColor(element)}66`,
          }}
        />
        <div className="inspector-title">
          <h3>{displayName(element)}</h3>
          <div className="qname">{element.qname || 'root'}</div>
        </div>
        <button className="icon-button" onClick={onClose} aria-label="Close inspector">
          <X size={15} />
        </button>
      </div>

      <div className="inspector-body">
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <span className="badge badge-kind" style={{ ['--kind-color' as string]: kindColor(element) }}>
            {kindLabel(element)}
          </span>
          {diagCount > 0 && (
            <span className="badge badge-warning">
              <CircleAlert size={10} /> {diagCount} diagnostic{diagCount === 1 ? '' : 's'}
            </span>
          )}
          {element.line > 0 && <span className="badge badge-muted">line {element.line}</span>}
        </div>

        {parent && (
          <div className="field">
            <span className="field-label">Contained in</span>
            <button
              className="chip"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => onSelect(parent.id)}
            >
              <span className="dot" style={{ background: kindColor(parent) }} />
              {displayName(parent)}
              <span style={{ color: 'var(--text-dim)', fontSize: 9 }}>{shortKind(parent)}</span>
            </button>
          </div>
        )}

        {canName && (
          <label className="field">
            <span className="field-label">Name</span>
            <input
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              spellCheck={false}
              placeholder="SysML identifier"
            />
          </label>
        )}

        {canType && (
          <label className="field">
            <span className="field-label">Type</span>
            <input
              className="input mono"
              value={type}
              onChange={(e) => setType(e.target.value)}
              spellCheck={false}
              placeholder="e.g. AIStack::DGXSpark"
            />
          </label>
        )}

        {element.specializes && (
          <div className="field">
            <span className="field-label">Specializes</span>
            <div className="field-value mono">{element.specializes}</div>
          </div>
        )}

        {canValue && (
          <label className="field">
            <span className="field-label">Value</span>
            <input
              className="input mono"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              spellCheck={false}
              placeholder='e.g. "EXL3 4 bpw" or 1048576'
            />
          </label>
        )}

        {canDoc && (
          <label className="field">
            <span className="field-label">Documentation</span>
            <textarea
              className="textarea"
              value={doc}
              onChange={(e) => setDoc(e.target.value)}
              placeholder="What is this element and why does it exist?"
              rows={5}
            />
          </label>
        )}

        {isRequirement && element.docResolved && element.docResolved !== element.doc && (
          <div className="field">
            <span className="field-label">Inherited requirement text</span>
            <div
              className="field-value"
              style={{
                padding: '8px 10px',
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--bg-panel-2)',
                color: 'var(--text-muted)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {element.docResolved}
            </div>
          </div>
        )}

        {isRequirement && (
          <div className="field">
            <span className="field-label">Satisfied by</span>
            {satisfies.length === 0 ? (
              <span className="req-empty">No satisfy links yet.</span>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
                {satisfies.map((s) => (
                  <button key={s.id} className="chip" onClick={() => onSelect(s.id)}>
                    <span className="dot" style={{ background: kindColor(s) }} />
                    {displayName(s)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {isConnection && (
          <>
            <div className="field">
              <span className="field-label">Connect</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <EndpointChip id={element.sourceId} label={element.source} model={model} onSelect={onSelect} />
                <ArrowRight size={13} style={{ color: 'var(--accent)' }} />
                <EndpointChip id={element.targetId} label={element.target} model={model} onSelect={onSelect} />
              </div>
            </div>
            <div className="field">
              <span className="field-label">Resolved nodes</span>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {element.sourceNodeId && (
                  <button className="chip" onClick={() => onSelect(element.sourceNodeId!)}>
                    <Link2 size={10} /> {displayName(byId(model, element.sourceNodeId))}
                  </button>
                )}
                {element.targetNodeId && (
                  <button className="chip" onClick={() => onSelect(element.targetNodeId!)}>
                    <Link2 size={10} /> {displayName(byId(model, element.targetNodeId))}
                  </button>
                )}
              </div>
            </div>
          </>
        )}

        {isSatisfy && (
          <>
            <div className="field">
              <span className="field-label">Satisfy link</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <EndpointChip
                  id={element.requirementId}
                  label={element.requirement}
                  model={model}
                  onSelect={onSelect}
                />
                <span style={{ color: 'var(--text-dim)', fontSize: 10 }}>by</span>
                <EndpointChip id={element.satisfierId} label={element.satisfier} model={model} onSelect={onSelect} />
              </div>
            </div>
          </>
        )}

        <div className="field">
          <span className="field-label">Qualified name</span>
          <div className="field-value mono" style={{ color: 'var(--text-muted)' }}>
            {element.qname || 'root'}
          </div>
        </div>

      </div>

      <div className="inspector-actions">
        <button className="btn btn-primary" onClick={save} disabled={!dirty || saving}>
          <Save size={13} /> {saving ? 'Saving…' : 'Save'}
        </button>
        <button className="btn" onClick={() => onShowInSource(element.line)}>
          <Code2 size={13} /> Source
        </button>
        {!isRoot && (
          <button
            className="btn btn-danger"
            style={{ marginLeft: 'auto' }}
            onClick={() => onDelete(element.id)}
            title="Delete element"
          >
            <Trash2 size={13} />
          </button>
        )}
      </div>
    </aside>
  )
}

function EndpointChip({
  id,
  label,
  model,
  onSelect,
}: {
  id?: string
  label?: string
  model: SysmlModel
  onSelect: (id: string) => void
}) {
  const el = byId(model, id)
  if (!el) {
    return (
      <span className="badge badge-warning" style={{ fontFamily: 'var(--font-mono)' }}>
        {label || 'unresolved'}
      </span>
    )
  }
  return (
    <button className="chip" onClick={() => onSelect(el.id)}>
      <span className="dot" style={{ background: kindColor(el) }} />
      {displayName(el)}
      <span style={{ color: 'var(--text-dim)', fontSize: 9 }}>{shortKind(el)}</span>
    </button>
  )
}
