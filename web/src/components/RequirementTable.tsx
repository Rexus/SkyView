import { useRef } from 'react'
import { ArrowDown, ArrowUp, ChevronsUpDown, GripVertical } from 'lucide-react'
import type { SysmlElement } from '../types'
import { displayName } from '../utils'
import { columnWidth, constraintText, maxColumnWidth, minColumnWidth, requirementColumns,
 type Column, type ColumnId, type RequirementRow, type Sort } from '../requirementTable'

export function RequirementLinks({ entries, onSelect, constraint = false }: {
 entries: SysmlElement[]
 onSelect: (element: string) => void
 constraint?: boolean
}) {
 return <ul className="requirement-links">
  {entries.map(entry => {
   const text = constraint ? constraintText(entry) : displayName(entry)
   return <li key={entry.id}><button type="button" className={constraint && entry.expression && !entry.doc ? 'requirement-expression' : undefined}
    title={constraint ? text : entry.qname} onClick={event => { event.stopPropagation(); onSelect(entry.id) }}>{text}</button></li>
  })}
 </ul>
}

function RequirementCell({ row, id, onSelect, onInspect }: {
 row: RequirementRow
 id: ColumnId
 onSelect: (element: string) => void
 onInspect: (row: RequirementRow) => void
}) {
 const value = row.values[id]
 if (id === 'name') return <button type="button" className="requirement-name" title={row.requirement.qname}
  onClick={event => { event.stopPropagation(); onSelect(row.requirement.id) }}
  onDoubleClick={event => { event.stopPropagation(); onInspect(row) }}>{value}</button>
 const links = { constraint: row.constraints, assumptions: row.assumptions, satisfaction: row.satisfaction, verification: row.verification }
 if (id in links && value) return <RequirementLinks entries={links[id as keyof typeof links]} onSelect={onSelect} constraint={id === 'constraint' || id === 'assumptions'} />
 if (id === 'subject' && row.subject) return <button type="button" className="requirement-name" title={value}
  onClick={event => { event.stopPropagation(); onSelect(row.subject!.id) }}>{value}</button>
 const empty = row.requirement.isDef ? '—' : id === 'verification' ? 'No linked case' : id === 'satisfaction' ? 'No assertion' : '—'
 return <span className={value ? 'requirement-cell-text' : 'requirement-cell-empty'} title={value || undefined}>{value || empty}</span>
}

export default function RequirementTable({ rows, columns, filters, filterRow, sorts, selectedId,
 onFilter, onSort, onMove, onResize, onSelect, onInspect }: {
 rows: RequirementRow[]
 columns: Column[]
 filters: Partial<Record<ColumnId, string>>
 filterRow: boolean
 sorts: Sort[]
 selectedId: string | null
 onFilter: (id: ColumnId, text: string) => void
 onSort: (id: ColumnId, add: boolean) => void
 onMove: (from: ColumnId, to: ColumnId) => void
 onResize: (id: ColumnId, width: number) => void
 onSelect: (id: string) => void
 onInspect: (row: RequirementRow) => void
}) {
 const dragColumn = useRef<ColumnId | null>(null)
 const resize = useRef<{ id: ColumnId; pointer: number; start: number; width: number } | null>(null)
 return <div className="requirement-table-scroll">
  <table className="requirement-table" aria-label="Requirements" style={{ width: columns.reduce((sum, column) => sum + column.width, 0) }}>
   <colgroup>{columns.map(column => <col key={column.id} style={{ width: column.width }} />)}</colgroup>
   <thead>
    <tr>{columns.map((column, index) => {
     const { id, width } = column
     const label = requirementColumns[id].label
     const rank = sorts.findIndex(sort => sort.id === id)
     const direction = rank >= 0 ? sorts[rank].direction : undefined
     return <th key={id} scope="col" aria-sort={rank === 0 ? direction === 'asc' ? 'ascending' : 'descending' : undefined}
      onDragOver={event => { if (dragColumn.current) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }}
      onDrop={event => {
       if (!dragColumn.current) return
       event.preventDefault()
       onMove(dragColumn.current, id)
       dragColumn.current = null
      }}>
      <div className="requirement-column-head">
       <button type="button" className="requirement-column-grip" aria-label={`Move ${label} column`} draggable
        title="Drag to move, or use Left and Right arrows"
        onDragStart={event => {
         dragColumn.current = id
         event.dataTransfer.setData('application/x-skyview-requirement-column', id)
         event.dataTransfer.effectAllowed = 'move'
        }} onDragEnd={() => { dragColumn.current = null }}
        onKeyDown={event => {
         if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
         event.preventDefault()
         const other = columns[index + (event.key === 'ArrowLeft' ? -1 : 1)]
         if (other) onMove(id, other.id)
        }}><GripVertical size={12} aria-hidden="true" /></button>
       <button type="button" className="requirement-sort" onClick={event => onSort(id, event.shiftKey)}
        title="Sort. Hold Shift to add to the current sort">
        <span>{label}</span>
        {direction === 'asc' ? <ArrowUp size={12} /> : direction === 'desc' ? <ArrowDown size={12} /> : <ChevronsUpDown size={12} />}
        {rank >= 0 && sorts.length > 1 && <small>{rank + 1}</small>}
       </button>
      </div>
      <span className="requirement-column-resize" role="separator" tabIndex={0} aria-orientation="vertical"
       aria-label={`Resize ${label} column`} aria-valuenow={width} aria-valuemin={minColumnWidth} aria-valuemax={maxColumnWidth}
       onPointerDown={event => {
        if (event.button !== 0) return
        event.preventDefault()
        resize.current = { id, pointer: event.pointerId, start: event.clientX, width }
        event.currentTarget.setPointerCapture?.(event.pointerId)
       }} onPointerMove={event => {
        const start = resize.current
        if (start?.pointer === event.pointerId && start.id === id) onResize(id, columnWidth(start.width + event.clientX - start.start))
       }} onPointerUp={() => { resize.current = null }} onPointerCancel={() => { resize.current = null }}
       onKeyDown={event => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        onResize(id, columnWidth(width + (event.key === 'ArrowLeft' ? -16 : 16)))
       }} />
     </th>
    })}</tr>
    {filterRow && <tr className="requirement-column-filters">{columns.map(column => <th key={column.id}>
     <input className="input-sm" aria-label={`Filter ${requirementColumns[column.id].label} column`}
      value={filters[column.id] ?? ''} placeholder="Filter…" onChange={event => onFilter(column.id, event.target.value)} />
    </th>)}</tr>}
   </thead>
   <tbody>
    {!rows.length && <tr><td colSpan={columns.length} className="requirements-empty">No requirements match your filters.</td></tr>}
    {rows.map(row => <tr key={row.requirement.id} data-selected={row.requirement.id === selectedId}
    onClick={() => onSelect(row.requirement.id)} onDoubleClick={event => {
     if (!(event.target as Element).closest('button')) onInspect(row)
    }}>
    {columns.map(column => column.id === 'name' ?
     <th scope="row" key={column.id}><RequirementCell row={row} id={column.id} onSelect={onSelect} onInspect={onInspect} /></th> :
     <td key={column.id} data-column={column.id}><RequirementCell row={row} id={column.id} onSelect={onSelect} onInspect={onInspect} /></td>)}
   </tr>)}</tbody>
  </table>
 </div>
}
