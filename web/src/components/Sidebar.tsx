import { useEffect, useMemo, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Search,
  X,
} from 'lucide-react'
import type { SysmlElement, SysmlModel } from '../types'
import {
  ancestors,
  childrenOf,
  cx,
  diagnosticsFor,
  displayName,
  isContainer,
  kindColor,
  plural,
  requirementCount,
  score,
} from '../utils'

interface Props {
  model: SysmlModel | null
  fileKey: string
  selectedId: string | null
  onSelect: (id: string) => void
}

export default function Sidebar({ model, fileKey, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const root = model?.elements.find((e) => e.kind === 'root')

  useEffect(() => {
    if (!model || !root) return
    setExpanded(new Set([root.id, ...childrenOf(model, root.id).filter(isContainer).map((e) => e.id)]))
    setQuery('')
  }, [fileKey, model?.rootId])

  useEffect(() => {
    if (!model || !selectedId) return
    const el = model.elements.find((e) => e.id === selectedId)
    if (!el) return
    const path = ancestors(model, el).map((a) => a.id)
    setExpanded((prev) => {
      const next = new Set(prev)
      path.forEach((id) => next.add(id))
      return next
    })
  }, [model, selectedId])

  const results = useMemo(() => {
    if (!model || !query.trim()) return []
    return model.elements
      .filter((e) => e.kind !== 'root')
      .map((e) => ({
        el: e,
        s: score(query, `${e.name} ${e.qname} ${e.kind} ${e.doc ?? ''}`),
      }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 120)
  }, [model, query])

  const stats = useMemo(() => {
    if (!model) return { elements: 0, connections: 0, requirements: 0, issues: 0 }
    return {
      elements: model.elements.filter((e) => e.kind !== 'root').length,
      connections: model.elements.filter((e) => e.kind === 'connection').length,
      requirements: requirementCount(model),
      issues: model.diagnostics.filter((d) => d.severity !== 'info').length,
    }
  }, [model])

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const collapseAll = () => {
    if (!root) return
    setExpanded(new Set([root.id]))
  }

  const expandAll = () => {
    if (!model) return
    setExpanded(new Set(model.elements.filter(isContainer).map((e) => e.id)))
  }

  function renderNode(el: SysmlElement, depth: number) {
    const kids = childrenOf(model!, el.id)
    const open = expanded.has(el.id)
    const hasKids = kids.length > 0
    const diag = diagnosticsFor(model!, el.id)
    return (
      <div key={el.id}>
        <div
          className={cx('tree-row', el.id === selectedId && 'selected')}
          style={{ paddingLeft: 4 + depth * 13 }}
          onClick={() => onSelect(el.id)}
          title={el.qname}
        >
          <span
            className="twisty"
            onClick={(e) => {
              e.stopPropagation()
              if (hasKids) toggle(el.id)
            }}
          >
            {hasKids ? open ? <ChevronDown size={12} /> : <ChevronRight size={12} /> : null}
          </span>
          <span className="kind-dot" style={{ background: kindColor(el) }} />
          <span className="label">
            {displayName(el)}
            {el.isDef && el.kind !== 'package' && el.kind !== 'root' && <span className="dim">def</span>}
          </span>
          {diag > 0 && (
            <span className="row-badge" style={{ color: 'var(--warning)' }} title={`${diag} diagnostics`}>
              !
            </span>
          )}
          {!diag && hasKids && <span className="row-badge">{kids.length}</span>}
        </div>
        {open && kids.map((child) => renderNode(child, depth + 1))}
      </div>
    )
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="sidebar-title">
          <span>Explorer</span>
          <span style={{ display: 'flex', gap: 2 }}>
            <button className="icon-button" style={{ width: 24, height: 24 }} onClick={expandAll} title="Expand all">
              <ChevronsUpDown size={13} />
            </button>
            <button className="icon-button" style={{ width: 24, height: 24 }} onClick={collapseAll} title="Collapse all">
              <ChevronsDownUp size={13} />
            </button>
          </span>
        </div>
        <div className="search-box">
          <Search size={13} className="search-icon" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter the model…"
            spellCheck={false}
          />
          {query && (
            <button className="icon-button clear" style={{ width: 24, height: 24 }} onClick={() => setQuery('')}>
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      <div className="tree">
        {!model && <div className="tree-empty">No model loaded.</div>}
        {model && !root && <div className="tree-empty">No root element found.</div>}
        {model && root && !query && renderNode(root, 0)}
        {model && query && results.length === 0 && <div className="tree-empty">No matches for “{query}”.</div>}
        {model &&
          query &&
          results.map(({ el }) => (
            <div
              key={el.id}
              className={cx('tree-row', el.id === selectedId && 'selected')}
              style={{ paddingLeft: 6 }}
              onClick={() => onSelect(el.id)}
              title={el.qname}
            >
              <span className="twisty" />
              <span className="kind-dot" style={{ background: kindColor(el) }} />
              <span className="label">
                {displayName(el)}
                <span className="dim">{el.qname}</span>
              </span>
            </div>
          ))}
      </div>

      <div className="sidebar-foot">
        <div className="stat">
          <div className="stat-value">{stats.elements}</div>
          <div className="stat-label">{plural(stats.elements, 'element')}</div>
        </div>
        <div className="stat">
          <div className="stat-value">{stats.connections}</div>
          <div className="stat-label">{plural(stats.connections, 'connection')}</div>
        </div>
        <div className="stat">
          <div className="stat-value">{stats.requirements}</div>
          <div className="stat-label">{plural(stats.requirements, 'requirement')}</div>
        </div>
        <div className="stat">
          <div className="stat-value" style={{ color: stats.issues ? 'var(--warning)' : 'var(--success)' }}>
            {stats.issues}
          </div>
          <div className="stat-label">{plural(stats.issues, 'issue')}</div>
        </div>
      </div>
    </aside>
  )
}
