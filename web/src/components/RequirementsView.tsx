import { useEffect, useMemo, useState } from 'react'
import { Code2, Download, Filter, Plus, Search, SlidersHorizontal } from 'lucide-react'
import type { ElementPatch } from '../api'
import type { SysmlModel } from '../types'
import { editCapabilities } from '../utils'
import { coverageLabels, filterRequirements, projectRequirements, requirementColumns, requirementCSV, requirementLayout,
 type Column, type ColumnId, type Coverage, type RequirementRow, type Sort } from '../requirementTable'
import ActionMenu from './ActionMenu'
import ElementDocumentation from './ElementDocumentation'
import Modal from './Modal'
import RequirementTable, { RequirementLinks } from './RequirementTable'

interface Props {
 fileName: string
 model: SysmlModel
 selectedId: string | null
 onSelect: (id: string) => void
 onPatch: (id: string, patch: ElementPatch) => Promise<boolean>
 onAddRequirement: (parent?: string) => void
 onAddSatisfy: (requirement?: string) => void
 onDelete: (id: string) => void
 onShowInSource: (line: number) => void
}

const storageKey = 'skyview-requirement-columns'
const defaultSort: Sort[] = [{ id: 'id', direction: 'asc' }]

function initialColumns() {
 try { return requirementLayout(JSON.parse(localStorage.getItem(storageKey) ?? 'null')) }
 catch { return requirementLayout() }
}

function RequirementDetails({ row, onClose, onSelect, onPatch }: Pick<Props, 'onSelect' | 'onPatch'> & {
 row: RequirementRow
 onClose: () => void
}) {
 const { requirement, values } = row
 const source = requirement.doc ?? ''
 const editable = editCapabilities(requirement).doc
 const [draft, setDraft] = useState(source)
 const [saving, setSaving] = useState(false)
 const [saveFailed, setSaveFailed] = useState(false)
 const dirty = draft !== source
 useEffect(() => {
  if (!dirty) return
  const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
  window.addEventListener('beforeunload', protect)
  return () => window.removeEventListener('beforeunload', protect)
 }, [dirty])
 const close = () => {
  if (saving || dirty && !window.confirm('Discard unsaved requirement documentation?')) return false
  onClose()
  return true
 }
 const select = (id: string) => { if (close()) onSelect(id) }
 const save = async () => {
  if (saving || !dirty) return
  setSaving(true)
  setSaveFailed(false)
  try {
   if (await onPatch(requirement.id, { id: requirement.id, doc: draft })) onClose()
   else setSaveFailed(true)
  } finally { setSaving(false) }
 }
 const links = [
  { name: 'Required constraint', entries: row.constraints, constraint: true },
  { name: 'Assumptions', entries: row.assumptions, constraint: true },
  { name: 'Satisfaction assertions', entries: row.satisfaction },
  { name: 'Planned verification', entries: row.verification },
 ]
 return <Modal title={values.name} subtitle={values.qualifiedName} onClose={close}
  footer={<>
   <button type="button" className="btn" disabled={saving} onClick={close}>Close</button>
   {editable && <button type="button" className="btn btn-primary" disabled={!dirty || saving} onClick={() => void save()}>
    {saving ? 'Saving…' : 'Save documentation'}
   </button>}
  </>}>
  <dl className="requirement-details">
   {values.id && <div><dt>ID</dt><dd>{values.id}</dd></div>}
   {values.subject && <div><dt>Subject</dt><dd>{values.subject}</dd></div>}
   {links.filter(group => group.entries.length).map(group => <div key={group.name}><dt>{group.name}</dt>
    <dd><RequirementLinks entries={group.entries} constraint={group.constraint} onSelect={select} /></dd></div>)}
  </dl>
  {!source && requirement.docResolved && <p className="requirement-inherited">This requirement inherits documentation. Saving here adds its own documentation.</p>}
  <ElementDocumentation value={editable ? draft : values.documentation} onChange={editable && !saving ? setDraft : undefined} />
  {saveFailed && <p className="requirements-save-error" role="alert">Save failed. Your documentation draft is still open.</p>}
 </Modal>
}

export default function RequirementsView({ fileName, model, selectedId, onSelect, onPatch, onAddRequirement,
 onAddSatisfy, onDelete, onShowInSource }: Props) {
 const [query, setQuery] = useState('')
 const [coverage, setCoverage] = useState<Coverage>('all')
 const [columns, setColumns] = useState(initialColumns)
 const [sorts, setSorts] = useState<Sort[]>(defaultSort)
 const [filters, setFilters] = useState<Partial<Record<ColumnId, string>>>({})
 const [filterRow, setFilterRow] = useState(false)
 const [inspecting, setInspecting] = useState<string | null>(null)
 const rows = useMemo(() => projectRequirements(model), [model])
 const filtered = useMemo(() => filterRequirements(rows, query, coverage, filters, sorts), [rows, query, coverage, filters, sorts])
 const selected = filtered.find(row => row.requirement.id === selectedId)
 const details = rows.find(row => row.requirement.id === inspecting)
 const visible = columns.filter(column => column.visible)
 const hidden = columns.length - visible.length
 const columnFilterCount = Object.values(filters).filter(value => value?.trim()).length
 const filtering = query.trim() || coverage !== 'all' || columnFilterCount > 0

 useEffect(() => {
  try { localStorage.setItem(storageKey, JSON.stringify(columns)) }
  catch { /* the workbench remains usable with browser storage disabled */ }
 }, [columns])

 const inspect = (row: RequirementRow) => { onSelect(row.requirement.id); setInspecting(row.requirement.id) }
 const clear = () => { setQuery(''); setCoverage('all'); setFilters({}) }
 const setFilter = (id: ColumnId, text: string) => setFilters(current => ({ ...current, [id]: text }))
 const changeColumn = (id: ColumnId, patch: Partial<Pick<Column, 'visible' | 'width'>>) =>
  setColumns(current => current.map(column => column.id === id ? { ...column, ...patch } : column))
 const moveColumn = (from: ColumnId, to: ColumnId) => {
  if (from === to) return
  setColumns(current => {
   const next = [...current]
   const destination = next.findIndex(column => column.id === to)
   const [moved] = next.splice(next.findIndex(column => column.id === from), 1)
   next.splice(destination, 0, moved)
   return next
  })
 }
 const sortColumn = (id: ColumnId, add: boolean) => setSorts(current => {
  const previous = current.find(sort => sort.id === id)
  const next = previous?.direction === 'desc' ? undefined : { id, direction: previous ? 'desc' as const : 'asc' as const }
  if (!add) return next ? [next] : []
  if (!previous && next) return [...current, next]
  return current.flatMap(sort => sort.id === id ? next ? [next] : [] : [sort])
 })
 const exportCSV = () => {
  const csv = requirementCSV(filtered, visible.map(column => column.id))
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' }))
  link.download = `${fileName.split('/').at(-1)?.replace(/\.[^.]+$/, '') || 'model'}-requirements.csv`
  link.click()
  setTimeout(() => URL.revokeObjectURL(link.href), 1000)
 }
 return <section className="requirements-workbench" aria-label="Requirements workbench">
  <div className="view-toolbar requirements-titlebar">
   <strong title={fileName}>{fileName.split('/').at(-1)}</strong>
   <span className="requirements-count" role="status">{filtering ? `${filtered.length} of ` : ''}{rows.length} {rows.length === 1 ? 'requirement' : 'requirements'}</span>
   <span className="grow" />
   <button type="button" className="btn btn-sm" disabled={!filtered.length} onClick={exportCSV}><Download size={14} /> Export CSV</button>
   <button type="button" className="btn btn-sm btn-primary" onClick={() => onAddRequirement(selected?.requirement.parentId)}><Plus size={14} /> Add requirement</button>
  </div>
  <div className="view-toolbar requirements-toolbar">
   <label className="toolbar-search"><Search size={14} /><input aria-label="Quick filter requirements" placeholder="Filter rows…" value={query}
    onChange={event => setQuery(event.target.value)} /></label>
   <select className="select input-sm" aria-label="Requirement coverage" value={coverage}
    onChange={event => setCoverage(event.target.value as Coverage)}>
    {Object.entries(coverageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
   </select>
   <ActionMenu label={sorts.length > 1 ? `Sort (${sorts.length})` : 'Sort'}>
    {visible.map(column => {
     const direction = sorts.find(sort => sort.id === column.id)?.direction
     return <button type="button" key={column.id} onClick={() => sortColumn(column.id, true)}>
      {requirementColumns[column.id].label}{direction ? ` · ${direction === 'asc' ? 'Ascending' : 'Descending'}` : ''}
     </button>
    })}
    {!!sorts.length && <button type="button" onClick={() => setSorts([])}>Clear sort</button>}
   </ActionMenu>
   <ActionMenu label={hidden ? `Columns (${hidden} hidden)` : 'Columns'}>
    {columns.map(column => <label key={column.id} className="requirement-column-option">
     <input type="checkbox" checked={column.visible} onChange={event => {
      changeColumn(column.id, { visible: event.target.checked })
      if (!event.target.checked) {
       setFilter(column.id, '')
       setSorts(current => current.filter(sort => sort.id !== column.id))
      }
     }} disabled={column.id === 'name'} />{requirementColumns[column.id].label}
    </label>)}
    <button type="button" onClick={() => { setColumns(requirementLayout()); setFilters({}); setSorts(defaultSort) }}>Reset columns</button>
   </ActionMenu>
   <button type="button" className="btn btn-sm" aria-pressed={filterRow} onClick={() => setFilterRow(value => !value)}>
    <Filter size={13} /> Column filters{columnFilterCount ? ` (${columnFilterCount})` : ''}
   </button>
   {filtering && <button type="button" className="btn btn-sm" onClick={clear}>Clear filters</button>}
  </div>
  {!!rows.length && <RequirementTable rows={filtered} columns={visible} filters={filters} filterRow={filterRow} sorts={sorts}
   selectedId={selectedId} onFilter={setFilter} onSort={sortColumn} onMove={moveColumn}
   onResize={(id, width) => changeColumn(id, { width })} onSelect={onSelect} onInspect={inspect} />}
  {!rows.length && <div className="requirements-empty">This model has no requirements.</div>}
  {selected && <div className="view-toolbar requirements-selection">
   <span title={selected.values.qualifiedName}>{selected.values.id ? `${selected.values.id} · ` : ''}{selected.values.name}</span>
   <span className="grow" />
   <button type="button" className="btn btn-sm" onClick={() => inspect(selected)}><SlidersHorizontal size={13} /> Details</button>
   <button type="button" className="btn btn-sm" onClick={() => onShowInSource(selected.requirement.line)}><Code2 size={13} /> Source</button>
   {!selected.requirement.isDef && <button type="button" className="btn btn-sm" onClick={() => onAddSatisfy(selected.requirement.id)}>Add satisfaction link</button>}
   {editCapabilities(selected.requirement).delete && <ActionMenu label="Requirement actions" iconOnly>
    <button type="button" className="menu-destructive" onClick={() => onDelete(selected.requirement.id)}>Delete requirement</button>
   </ActionMenu>}
  </div>}
  {details && <RequirementDetails key={details.requirement.id} row={details} onClose={() => setInspecting(null)}
   onSelect={onSelect} onPatch={onPatch} />}
 </section>
}
