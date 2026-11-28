import { useEffect, useMemo, useState } from 'react'
import {
  ArrowRight,
  CircleAlert,
  Code2,
  Link2,
  Pin,
  PinOff,
  Save,
  Trash2,
  X,
} from 'lucide-react'
import ElementDocumentation from './ElementDocumentation'
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
  editCapabilities,
  requirementConstraints,
  verificationCasesFor,
} from '../utils'

interface Props {
  model: SysmlModel
  element: SysmlElement
  docked?: boolean
  onToggleDock?: () => void
  onClose: () => void
  onPatch: (id: string, patch: ElementPatch) => Promise<boolean | void>
  onDelete: (id: string) => void
  onShowInSource: () => void
  onSelect: (id: string) => void
}

export default function Inspector({
  model,
  element,
  docked,
  onToggleDock,
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

  const isSatisfy = element.kind === 'satisfy'
  const isRequirement = element.kind === 'requirement'
  const capabilities = editCapabilities(element)
  const { name: canName, type: canType, value: canValue, doc: canDoc } = capabilities
  const constraints = isRequirement ? requirementConstraints(model, element) : []
  const verifications = isRequirement ? verificationCasesFor(model, element) : []
  const hasEndpoints = ['connection', 'dependency', 'flow', 'message', 'succession', 'first'].includes(element.kind)
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

  const dockLabel = docked ? 'Float properties' : 'Dock properties'

  return (
    <aside className="inspector" aria-label="Element properties" data-docked={docked || undefined}>
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
          }}
        />
        <div className="inspector-title">
          <h3>{displayName(element)}</h3>
          <div className="qname">{element.qname || 'root'}</div>
        </div>
        {onToggleDock && <button type="button" className="icon-button tooltip inspector-pin" onClick={onToggleDock}
          aria-label="Dock properties" aria-pressed={!!docked} data-tip={dockLabel}>
          {docked ? <PinOff size={15} aria-hidden="true" /> : <Pin size={15} aria-hidden="true" />}
        </button>}
        <button type="button" className="icon-button tooltip" onClick={onClose} aria-label="Close properties" data-tip="Close properties">
          <X size={15} aria-hidden="true" />
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

        {!canType && element.type && (
          <div className="field"><span className="field-label">{element.kind === 'message' ? 'Payload type' : 'Type'}</span>
            <EndpointChip id={element.typeId} label={element.type} model={model} onSelect={onSelect} />
          </div>
        )}
        {element.expression && (
          <div className="field"><span className="field-label">{element.constraintRole || 'Constraint'} expression</span>
            <div className="field-value mono" style={{ whiteSpace: 'pre-wrap' }}>{element.expression}</div>
          </div>
        )}
        {constraints.map(constraint => (
          <div className="field" key={constraint.id}><span className="field-label">Required constraint</span>
            <button className="chip" style={{ whiteSpace: 'pre-wrap', textAlign: 'left' }} onClick={() => onSelect(constraint.id)}>{constraint.expression}</button>
          </div>
        ))}
        {verifications.length > 0 && (
          <div className="field"><span className="field-label">Planned verification · no results recorded</span>
            {verifications.map(v => <button className="chip" key={v.id} onClick={() => onSelect(v.id)}>{displayName(v)}</button>)}
          </div>
        )}
        {element.kind === 'verify' && (
          <div className="field"><span className="field-label">Verification target</span>
            <EndpointChip id={element.requirementId} label={element.requirement} model={model} onSelect={onSelect} />
          </div>
        )}
        {element.valueId && (
          <div className="field"><span className="field-label">Bound element</span>
            <EndpointChip id={element.valueId} label={element.value} model={model} onSelect={onSelect} />
          </div>
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

        {(canDoc || element.doc) && (
          <ElementDocumentation key={element.id} value={doc} onChange={canDoc ? setDoc : undefined} />
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

        {hasEndpoints && (
          <>
            <div className="field">
              <span className="field-label">{element.kind === 'connection' ? 'Connect' : 'Order / endpoints'}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {element.source && <EndpointChip id={element.sourceId} label={element.source} model={model} onSelect={onSelect} />}
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
        <button className="btn" onClick={onShowInSource}>
          <Code2 size={13} /> Source
        </button>
        {capabilities.delete && (
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
      <span className={id?.startsWith('builtin:') ? 'badge badge-muted' : 'badge badge-warning'} style={{ fontFamily: 'var(--font-mono)' }}>
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
