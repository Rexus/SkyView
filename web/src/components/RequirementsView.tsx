import { useMemo, useState } from 'react'
import {
  CheckCheck,
  CheckCircle2,
  Circle,
  CircleAlert,
  Code2,
  LayoutGrid,
  Pencil,
  Plus,
  Search,
  Table2,
  Trash2,
  X,
} from 'lucide-react'
import type { ElementPatch } from '../api'
import type { SysmlElement, SysmlModel } from '../types'
import {
  byId,
  cx,
  displayName,
  kindColor,
  requirementsOf,
  satisfiesFor,
  score,
  shortKind,
} from '../utils'

interface Props {
  model: SysmlModel
  selectedId: string | null
  onSelect: (id: string) => void
  onPatch: (id: string, patch: ElementPatch) => Promise<void>
  onAddRequirement: (parent?: string) => void
  onAddSatisfy: (requirement?: string) => void
  onDelete: (id: string) => void
  onShowInSource: (line: number) => void
}

type StatusFilter = 'all' | 'satisfied' | 'unsatisfied'

export default function RequirementsView({
  model,
  selectedId,
  onSelect,
  onPatch,
  onAddRequirement,
  onAddSatisfy,
  onDelete,
  onShowInSource,
}: Props) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [view, setView] = useState<'cards' | 'matrix'>('cards')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const requirements = useMemo(() => {
    const all = requirementsOf(model)
    const usages = all.filter((r) => !r.isDef)
    const usedDefs = new Set(usages.map((r) => r.typeId).filter(Boolean))
    const standaloneDefs = all.filter((r) => r.isDef && !usedDefs.has(r.id))
    return [...usages, ...standaloneDefs].sort((a, b) => a.qname.localeCompare(b.qname))
  }, [model])

  const filtered = useMemo(() => {
    return requirements.filter((req) => {
      const links = satisfiesFor(model, req)
      if (status === 'satisfied' && links.length === 0) return false
      if (status === 'unsatisfied' && links.length > 0) return false
      if (!query.trim()) return true
      const text = req.docResolved || req.doc || ''
      return score(query, `${req.name} ${req.qname} ${text}`) > 0
    })
  }, [requirements, model, status, query])

  const satisfiedCount = requirements.filter((r) => satisfiesFor(model, r).length > 0).length

  const columns = useMemo(() => {
    const map = new Map<string, SysmlElement>()
    for (const req of requirements) {
      for (const s of satisfiesFor(model, req)) map.set(s.id, s)
    }
    return [...map.values()].sort((a, b) => a.qname.localeCompare(b.qname))
  }, [requirements, model])

  const startEdit = (req: SysmlElement) => {
    setEditingId(req.id)
    setDraft(req.docResolved || req.doc || '')
  }

  const saveEdit = async (req: SysmlElement) => {
    if (saving) return
    const targetId = !req.isDef && req.typeId ? req.typeId : req.id
    setSaving(true)
    try {
      await onPatch(targetId, { id: targetId, doc: draft })
      setEditingId(null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="view-toolbar">
        <div className="toolbar-search">
          <Search size={13} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search requirements…"
            spellCheck={false}
          />
        </div>
        <div className="segmented">
          {(['all', 'satisfied', 'unsatisfied'] as StatusFilter[]).map((s) => (
            <button
              key={s}
              className={cx(status === s && 'active')}
              onClick={() => setStatus(s)}
            >
              {s === 'all' ? 'All' : s === 'satisfied' ? 'Satisfied' : 'Open'}
            </button>
          ))}
        </div>
        <div className="segmented">
          <button className={cx(view === 'cards' && 'active')} onClick={() => setView('cards')}>
            <LayoutGrid size={12} /> Cards
          </button>
          <button className={cx(view === 'matrix' && 'active')} onClick={() => setView('matrix')}>
            <Table2 size={12} /> Matrix
          </button>
        </div>
        <div className="grow" />
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          {satisfiedCount}/{requirements.length} satisfied
        </span>
        <button className="btn btn-sm" onClick={() => onAddSatisfy()}>
          <CheckCheck size={13} /> Trace link
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => onAddRequirement()}>
          <Plus size={13} /> Requirement
        </button>
      </div>

      {requirements.length === 0 ? (
        <div className="empty-state">
          <div className="icon-wrap">
            <CheckCheck size={22} />
          </div>
          <h2>No requirements yet</h2>
          <p>Add a requirement, then trace it to the parts that satisfy it.</p>
          <button className="btn btn-primary" onClick={() => onAddRequirement()}>
            <Plus size={13} /> Add requirement
          </button>
        </div>
      ) : view === 'matrix' ? (
        <div className="req-wrap">
          <div className="matrix-wrap">
            <table className="matrix">
              <thead>
                <tr>
                  <th style={{ minWidth: 220 }}>Requirement</th>
                  {columns.map((c) => (
                    <th key={c.id} title={c.qname}>
                      {displayName(c)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((req) => {
                  const links = satisfiesFor(model, req)
                  return (
                    <tr key={req.id} onClick={() => onSelect(req.id)}>
                      <th>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span className="legend-dot" style={{ background: kindColor(req) }} />
                          {displayName(req)}
                        </span>
                      </th>
                      {columns.map((c) => {
                        const has = links.some((l) => l.id === c.id)
                        return (
                          <td key={c.id} title={`${displayName(req)} → ${displayName(c)}`}>
                            {has ? <span className="mark" /> : <span style={{ color: 'var(--text-dim)' }}>·</span>}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty-state">
          <div className="icon-wrap">
            <Search size={22} />
          </div>
          <h2>No matching requirements</h2>
          <p>Clear the search or change the status filter.</p>
          <button className="btn" onClick={() => { setQuery(''); setStatus('all') }}>
            Clear filters
          </button>
        </div>
      ) : (
        <div className="req-wrap">
          <div className="req-grid">
            {filtered.map((req) => {
              const links = satisfiesFor(model, req)
              const editing = editingId === req.id
              return (
                <div
                  key={req.id}
                  className={cx('req-card', req.id === selectedId && 'selected')}
                  onClick={() => onSelect(req.id)}
                >
                  <div className="req-head">
                    <span className="legend-dot" style={{ background: kindColor(req) }} />
                    <span className="req-name">{displayName(req)}</span>
                    <span className="badge badge-muted">{req.isDef ? 'definition' : shortKind(req)}</span>
                    {links.length > 0 ? (
                      <span className="badge badge-success">
                        <CheckCircle2 size={10} /> {links.length} satisfied
                      </span>
                    ) : (
                      <span className="badge badge-warning">
                        <CircleAlert size={10} /> open
                      </span>
                    )}
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 2 }}>
                      <button
                        className="icon-button"
                        style={{ width: 26, height: 26 }}
                        title="Edit requirement text"
                        onClick={(e) => {
                          e.stopPropagation()
                          if (editing) setEditingId(null)
                          else startEdit(req)
                        }}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        className="icon-button"
                        style={{ width: 26, height: 26 }}
                        title="Add satisfy link"
                        onClick={(e) => {
                          e.stopPropagation()
                          onAddSatisfy(req.id)
                        }}
                      >
                        <CheckCheck size={12} />
                      </button>
                      <button
                        className="icon-button"
                        style={{ width: 26, height: 26 }}
                        title="Show in source"
                        onClick={(e) => {
                          e.stopPropagation()
                          onShowInSource(req.line)
                        }}
                      >
                        <Code2 size={12} />
                      </button>
                      <button
                        className="icon-button"
                        style={{ width: 26, height: 26, color: 'var(--danger)' }}
                        title="Delete requirement"
                        onClick={(e) => {
                          e.stopPropagation()
                          onDelete(req.id)
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </div>

                  {editing ? (
                    <div style={{ marginBottom: 9 }} onClick={(e) => e.stopPropagation()}>
                      <textarea
                        className="textarea"
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        rows={4}
                        autoFocus
                      />
                      <div style={{ display: 'flex', gap: 6, marginTop: 7 }}>
                        <button className="btn btn-sm btn-primary" onClick={() => void saveEdit(req)} disabled={saving}>
                          {saving ? 'Saving…' : 'Save text'}
                        </button>
                        <button className="btn btn-sm" onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="req-text">
                      {req.docResolved || req.doc || 'No requirement text yet. Click the pencil to write it.'}
                    </p>
                  )}

                  <div className="req-links">
                    <span className="label">Satisfied by</span>
                    {links.length === 0 ? (
                      <span className="req-empty">no links</span>
                    ) : (
                      links.map((s) => (
                        <button
                          key={s.id}
                          className="chip"
                          onClick={(e) => {
                            e.stopPropagation()
                            onSelect(s.id)
                          }}
                          title={s.qname}
                        >
                          <span className="dot" style={{ background: kindColor(s) }} />
                          {displayName(s)}
                          <span style={{ color: 'var(--text-dim)', fontSize: 9 }}>{shortKind(s)}</span>
                        </button>
                      ))
                    )}
                    <button
                      className="chip"
                      onClick={(e) => {
                        e.stopPropagation()
                        onAddSatisfy(req.id)
                      }}
                      style={{ borderStyle: 'dashed' }}
                    >
                      <Plus size={10} /> link
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </>
  )
}
