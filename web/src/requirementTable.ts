import type { SysmlElement, SysmlModel } from './types'
import { byId, childrenOf, displayName, requirementConstraints, requirementsOf, satisfiesFor, verificationCasesFor } from './utils.ts'

export const requirementColumns = {
 id: { label: 'ID', width: 105, visible: true },
 review: { label: 'Review flags', width: 145, visible: true },
 name: { label: 'Requirement', width: 200, visible: true },
 constraint: { label: 'Required constraint', width: 280, visible: true },
 documentation: { label: 'Documentation', width: 240, visible: true },
 verification: { label: 'Planned verification', width: 180, visible: true },
 satisfaction: { label: 'Satisfaction assertions', width: 194, visible: false },
 subject: { label: 'Subject', width: 175, visible: false },
 assumptions: { label: 'Assumptions', width: 220, visible: false },
 scope: { label: 'Owner', width: 195, visible: false },
 kind: { label: 'Kind', width: 110, visible: false },
 qualifiedName: { label: 'Qualified name', width: 240, visible: false },
} as const

export type ColumnId = keyof typeof requirementColumns
export type Column = { id: ColumnId; width: number; visible: boolean }
export type Sort = { id: ColumnId; direction: 'asc' | 'desc' }
export const coverageLabels = {
 all: 'All coverage', id: 'No requirement ID', constraint: 'No projected constraint',
 verification: 'No planned verification', satisfaction: 'No satisfaction assertion',
} as const
export type Coverage = keyof typeof coverageLabels
export type RequirementRow = {
 requirement: SysmlElement
 values: Record<ColumnId, string>
 gaps: Exclude<Coverage, 'all'>[]
 constraints: SysmlElement[]
 assumptions: SysmlElement[]
 subject?: SysmlElement
 satisfaction: SysmlElement[]
 verification: SysmlElement[]
}

export const columnIds = Object.keys(requirementColumns) as ColumnId[]
export const minColumnWidth = 78
export const maxColumnWidth = 720
export const columnWidth = (width: number) => Math.round(Math.max(minColumnWidth, Math.min(maxColumnWidth, width)))

export function requirementLayout(saved?: unknown): Column[] {
 const defaults = columnIds.map(id => ({ id, width: requirementColumns[id].width, visible: requirementColumns[id].visible }))
 if (!Array.isArray(saved)) return defaults
 const columns: Column[] = []
 for (const entry of saved) {
  if (!entry || !columnIds.includes(entry.id) || columns.some(column => column.id === entry.id)) continue
  const id = entry.id as ColumnId
  columns.push({ id, width: Number.isFinite(entry.width) ? columnWidth(entry.width) : requirementColumns[id].width,
   visible: id === 'name' || (typeof entry.visible === 'boolean' ? entry.visible : requirementColumns[id].visible) })
 }
 return [...columns, ...defaults.filter(column => !columns.some(entry => entry.id === column.id))]
}

export function constraintText(element: SysmlElement) {
 const text = [element.expression?.trim(), element.doc?.trim()].filter(Boolean).join('\n')
 return text || (element.spans?.name && element.spans.name.end > element.spans.name.start ? element.name : '')
}

function requirementSubject(model: SysmlModel, requirement: SysmlElement) {
 const seen = new Set<string>()
 let current: SysmlElement | undefined = requirement
 while (current && !seen.has(current.id)) {
  seen.add(current.id)
  const subject = childrenOf(model, current.id).find(child => child.kind === 'subject')
  if (subject) return subject
  current = byId(model, current.typeId ?? current.specializesId)
 }
 return undefined
}

export function projectRequirements(model: SysmlModel): RequirementRow[] {
 return requirementsOf(model).filter(requirement => !requirement.implicit).map(requirement => {
  const constraints = requirementConstraints(model, requirement).filter(constraintText)
  const assumptions = requirementConstraints(model, requirement, 'assume').filter(constraintText)
  const satisfaction = satisfiesFor(model, requirement)
  const verification = verificationCasesFor(model, requirement)
  const subject = requirementSubject(model, requirement)
  const scope = byId(model, requirement.parentId)
  const gaps: RequirementRow['gaps'] = []
  if (!requirement.shortName) gaps.push('id')
  if (!constraints.length) gaps.push('constraint')
  if (!requirement.isDef && !verification.length) gaps.push('verification')
  if (!requirement.isDef && !satisfaction.length) gaps.push('satisfaction')
  return { requirement, constraints, assumptions, subject, satisfaction, verification, gaps, values: {
   id: requirement.shortName ?? '',
   review: gaps.map(gap => coverageLabels[gap]).join('\n'),
   name: displayName(requirement),
   constraint: constraints.map(constraintText).join('\n'),
   documentation: requirement.doc || requirement.docResolved || '',
   verification: verification.map(displayName).join('\n'),
   satisfaction: satisfaction.map(displayName).join('\n'),
   subject: subject ? [subject.name, subject.type ? `: ${subject.type}` : '', subject.value ? `= ${subject.value}` : ''].filter(Boolean).join(' ') : '',
   assumptions: assumptions.map(constraintText).join('\n'),
   scope: scope?.kind !== 'root' ? scope?.qname ?? '' : '',
   kind: requirement.isDef ? 'Definition' : 'Usage',
   qualifiedName: requirement.qname,
  } }
 })
}

const compare = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' }).compare

export function filterRequirements(rows: RequirementRow[], query: string, coverage: Coverage,
 filters: Partial<Record<ColumnId, string>>, sorts: Sort[]) {
 const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
 const columnFilters = columnIds.flatMap(id => {
  const term = filters[id]?.trim().toLowerCase()
  return term ? [{ id, term }] : []
 })
 return rows.filter(row => {
  const { values } = row
  if (coverage !== 'all' && !row.gaps.includes(coverage)) return false
  if (!columnFilters.every(({ id, term }) => values[id].toLowerCase().includes(term))) return false
  const text = Object.values(values).join(' ').toLowerCase()
  return terms.every(term => text.includes(term))
 }).sort((first, second) => {
  for (const { id, direction } of sorts) {
   const a = first.values[id], b = second.values[id]
   if (!a || !b) {
    if (a !== b) return a ? -1 : 1
    continue
   }
   const order = compare(a, b)
   if (order) return direction === 'asc' ? order : -order
  }
  return compare(first.requirement.qname, second.requirement.qname)
 })
}

const csvCell = (text: string) => {
 const safe = /^[=+@-]/.test(text.trimStart()) || /^[\t\r\n]/.test(text) ? "'" + text : text
 return '"' + safe.replaceAll('"', '""').replace(/\r?\n/g, '\r\n') + '"'
}

export function requirementCSV(rows: RequirementRow[], columns: ColumnId[]) {
 const header = columns.map(id => csvCell(requirementColumns[id].label)).join(',')
 const records = rows.map(row => columns.map(id => csvCell(row.values[id])).join(','))
 return [header, ...records, ''].join('\r\n')
}
