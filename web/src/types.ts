export type Severity = 'error' | 'warning' | 'info'

export interface Diagnostic {
  severity: Severity
  message: string
  line: number
  column: number
  elementId?: string
}

export interface Span {
  start: number
  end: number
}

export interface Spans {
  decl: Span
  name: Span
  type: Span
  specializes: Span
  expression: Span
  value: Span
  doc: Span
  docDecl: Span
  bodyOpen: number
  bodyClose: number
}

export interface SysmlElement {
  shortName?: string
  expression?: string
  constraintRole?: string
  valueId?: string
  implicit?: boolean
  id: string
  name: string
  kind: string
  isDef: boolean
  type?: string
  specializes?: string
  doc?: string
  docResolved?: string
  parentId: string
  qname: string
  line: number
  col: number
  value?: string
  multiplicity?: string
  direction?: string
  source?: string
  target?: string
  requirement?: string
  satisfier?: string
  typeId?: string
  specializesId?: string
  sourceId?: string
  targetId?: string
  sourceNodeId?: string
  targetNodeId?: string
  requirementId?: string
  satisfierId?: string
  children?: string[]
  spans: Spans
}

export interface SysmlModel {
  rootId: string
  rootName: string
  elements: SysmlElement[]
  imports?: string[]
  diagnostics: Diagnostic[]
}

export interface FileResponse {
  name: string
  content: string
  model: SysmlModel
  diagnostics: Diagnostic[]
  revision: string
}

export interface FileInfo {
  name: string
  size: number
  modified: string
}

export type Tab = 'grid' | 'diagram' | 'requirements' | 'source' | 'shared'
export type DiagramMode = 'interconnection' | 'containment'

export interface LayoutNode {
  x: number
  y: number
}

export interface DiagramNote {
  id: string
  targetId: string
  text: string
  x: number
  y: number
}

export interface LayoutFile {
  version?: number
  scopes?: Record<string, Partial<Record<DiagramMode, Record<string, LayoutNode>>>>
  notes?: Record<string, DiagramNote>
}

export interface Revision {
  id: string
  size: number
  savedAt: string
}

export interface Toast {
  id: number
  kind: 'success' | 'error' | 'info'
  message: string
}
