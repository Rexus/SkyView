import { useEffect, useMemo, useState, type ReactNode, type DragEvent } from 'react'
import {
  Box,
  Layers,
  Folder,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Search,
  X,
} from 'lucide-react'
import type { SysmlElement, SysmlModel } from '../types'
import { PROJECT_ID } from '../api'
import { canPlaceElement, startElementDrag } from '../elementDrag'
import {
  ancestors,
  childrenOf,
  cx,
  diagnosticsFor,
  displayName,
  isContainer,
  kindColor,
  score,
} from '../utils'

interface Props {
  partsOnly?: boolean
  canDrag?: boolean
  controls?: ReactNode
  model: SysmlModel | null
  fileKey: string
  selectedId: string | null
  onSelect: (id: string) => void
}

export default function Sidebar({ model, fileKey, selectedId, onSelect, partsOnly = false, controls, canDrag }: Props) {
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
      .filter((e) => e.kind !== 'root' && (!partsOnly || ['part', 'item'].includes(e.kind)))
      .map((e) => ({
        el: e,
        s: score(query, `${e.name} ${e.qname} ${e.kind} ${e.doc ?? ''}`),
      }))
      .filter((r) => r.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 120)
  }, [model, query, partsOnly])

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

  const dragProps = (element: SysmlElement) => canDrag && canPlaceElement(element) ? {
    draggable: true,
    onDragStart: (event: DragEvent) => startElementDrag(event.dataTransfer, {
      project: PROJECT_ID, file: fileKey, id: element.id,
    }),
  } : {}

  function renderNode(el: SysmlElement, depth: number) {
    if (partsOnly && !['root', 'package', 'part', 'item'].includes(el.kind)) return null
    const kids = childrenOf(model!, el.id).filter(e => !partsOnly || ['package', 'part', 'item'].includes(e.kind))
    const open = expanded.has(el.id)
    const hasKids = kids.length > 0
    const diag = diagnosticsFor(model!, el.id)
    return (
      <div key={el.id}>
        <div
          className={cx('tree-row', el.id === selectedId && 'selected')}
          style={{ paddingLeft: 4 + depth * 13 }}
          role="button" tabIndex={0}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(el.id) } }}
          onClick={() => onSelect(el.id)}
          title={el.qname}
          {...dragProps(el)}
        >
          {hasKids ? <button type="button" className="tree-toggle" aria-expanded={open}
            aria-label={(open ? 'Collapse ' : 'Expand ') + displayName(el)}
            onKeyDown={event => event.stopPropagation()} onClick={event => {
              event.stopPropagation()
              toggle(el.id)
            }}>{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</button>
            : <span className="twisty" />}
          <span className="tree-kind" style={{ color: kindColor(el) }}>{el.kind === 'package' || el.kind === 'root' ? <Folder size={14} /> : el.isDef ? <Layers size={14} /> : <Box size={14} />}</span>
          <span className="label">
            {displayName(el)}
            {el.kind !== 'root' && <span className="tree-keyword">«{el.kind}{el.isDef && el.kind !== 'package' ? ' def' : ''}»</span>}
          </span>
          {diag > 0 && (
            <span className="row-badge" style={{ color: 'var(--warning)' }} title={`${diag} diagnostics`}>
              !
            </span>
          )}
        </div>
        {open && kids.map((child) => renderNode(child, depth + 1))}
      </div>
    )
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div className="search-box">
          <Search size={13} className="search-icon" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find an element…"
            aria-label="Find an element"
            spellCheck={false}
          />
          {query && (
            <button className="icon-button clear" aria-label="Clear element search" onClick={() => setQuery('')}>
              <X size={12} />
            </button>
          )}
        </div>
        <button className="icon-button" type="button" onClick={expandAll} title="Expand all" aria-label="Expand all">
          <ChevronsUpDown size={13} />
        </button>
        <button className="icon-button" type="button" onClick={collapseAll} title="Collapse all" aria-label="Collapse all">
          <ChevronsDownUp size={13} />
        </button>
        {controls}
      </div>

      <div className="tree">
        {!model && <div className="tree-empty">No model loaded.</div>}
        {model && !root && <div className="tree-empty">No root element found.</div>}
        {model && root && !query && childrenOf(model, root.id).map(element => renderNode(element, 0))}
        {model && query && results.length === 0 && <div className="tree-empty">No matches for “{query}”.</div>}
        {model &&
          query &&
          results.map(({ el }) => (
            <div
              key={el.id}
              className={cx('tree-row', el.id === selectedId && 'selected')}
              style={{ paddingLeft: 6 }}
              role="button" tabIndex={0}
          onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(el.id) } }}
          onClick={() => onSelect(el.id)}
              title={el.qname}
              {...dragProps(el)}
            >
              <span className="twisty" />
              <span className="tree-kind" style={{ color: kindColor(el) }}>{el.kind === 'package' || el.kind === 'root' ? <Folder size={14} /> : el.isDef ? <Layers size={14} /> : <Box size={14} />}</span>
              <span className="label">
                {displayName(el)}
                <span className="tree-keyword">{el.kind}</span>
              </span>
            </div>
          ))}
      </div>

    </aside>
  )
}
