import type { DiagramMode, SysmlElement, SysmlModel } from './types'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function kindLabel(el: SysmlElement): string {
  if (el.kind === 'root') return 'Root'
  if (el.kind === 'package') return 'Package'
  const base = el.kind.charAt(0).toUpperCase() + el.kind.slice(1)
  return el.isDef ? `${base} def` : base
}

export function shortKind(el: SysmlElement): string {
  if (el.kind === 'root') return 'root'
  if (el.kind === 'package') return 'pkg'
  if (el.kind === 'connection') return 'conn'
  if (el.kind === 'satisfy') return 'satisfy'
  return el.isDef ? `${el.kind} def` : el.kind
}

export function kindColor(el: SysmlElement): string {
  switch (el.kind) {
    case 'package':
      return '#8b5cf6'
    case 'part':
      return '#38bdf8'
    case 'port':
      return '#f59e0b'
    case 'attribute':
      return '#a3e635'
    case 'requirement':
      return '#f472b6'
    case 'connection':
      return '#22d3ee'
    case 'satisfy':
      return '#fb7185'
    case 'action':
      return '#f97316'
    case 'state':
      return '#c084fc'
    case 'item':
      return '#34d399'
    default:
      return '#94a3b8'
  }
}

export function byId(model: SysmlModel, id: string | undefined): SysmlElement | undefined {
  if (!id) return undefined
  return model.elements.find((e) => e.id === id)
}

export function childrenOf(model: SysmlModel, id: string): SysmlElement[] {
  return model.elements.filter((e) => e.parentId === id)
}

export function descendants(model: SysmlModel, id: string): SysmlElement[] {
  const out: SysmlElement[] = []
  const walk = (parentId: string) => {
    for (const child of childrenOf(model, parentId)) {
      out.push(child)
      walk(child.id)
    }
  }
  walk(id)
  return out
}

export function ancestors(model: SysmlModel, el: SysmlElement): SysmlElement[] {
  const out: SysmlElement[] = []
  let cur = byId(model, el.parentId)
  while (cur) {
    out.unshift(cur)
    cur = byId(model, cur.parentId)
  }
  return out
}

export function depthOf(model: SysmlModel, el: SysmlElement): number {
  let d = 0
  let cur = byId(model, el.parentId)
  while (cur && cur.kind !== 'root') {
    d++
    cur = byId(model, cur.parentId)
  }
  return d
}

export function isContainer(el: SysmlElement): boolean {
  return (
    el.kind === 'root' ||
    el.kind === 'package' ||
    (el.spans.bodyOpen >= 0 && !isRelationship(el) && !['constraint', 'entry'].includes(el.kind))
  )
}

export function isUsageKind(kind: string): boolean {
  return [
    'part',
    'requirement',
    'action',
    'state',
    'item',
    'interface',
    'occurrence',
    'allocation',
    'constraint',
    'calc',
    'case',
    'analysis',
    'verification',
    'view',
    'rendering',
    'concern',
  ].includes(kind)
}

export function displayName(el: SysmlElement | undefined): string {
  if (!el) return '—'
  if (el.name) return el.name
  if (el.kind === 'root') return el.qname || 'root'
  if (el.kind === 'succession') return `${el.source} → ${el.target}`
  if (el.kind === 'first') return `first ${el.target}`
  if (el.kind === 'verify') return `verify ${el.requirement}`
  if (el.kind === 'constraint') return `${el.constraintRole ?? ''} constraint`.trim()
  if (el.kind === 'objective' || el.kind === 'entry') return el.kind
  return '(unnamed)'
}

export function safeImportName(raw: string): string {
  let base = raw.replace(/\.sysml$/i, '')
  base = base.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!base) base = 'imported-model'
  return `${base}.sysml`
}

export function requirementCount(model: SysmlModel): number {
  const reqs = model.elements.filter((e) => e.kind === 'requirement')
  const usages = reqs.filter((r) => !r.isDef)
  const used = new Set(usages.map((r) => r.typeId).filter(Boolean))
  return usages.length + reqs.filter((r) => r.isDef && !used.has(r.id)).length
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`
}

export function formatTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

export function score(query: string, text: string): number {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return 1
  if (t === q) return 100
  if (t.startsWith(q)) return 80
  if (t.includes(q)) return 50
  // subsequence match
  let qi = 0
  let run = 0
  let best = 0
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      qi++
      run++
      best = Math.max(best, run)
    } else {
      run = 0
    }
  }
  return qi === q.length ? 20 + best : 0
}

export function relativePath(from: SysmlElement, to: SysmlElement): string {
  if (to.parentId === from.id) return to.name
  // Use a qualified reference; the parser resolves it from anywhere.
  return to.qname
}

export function refFor(parent: SysmlElement, target: SysmlElement): string {
  return target.parentId === parent.id ? target.name : target.qname
}

export function portPaths(model: SysmlModel, parent?: SysmlElement): string[] {
  const out = new Set<string>()
  const parts = parent
    ? childrenOf(model, parent.id).filter((c) => ['part', 'requirement', 'action', 'state', 'item'].includes(c.kind))
    : model.elements.filter((c) => ['part', 'requirement', 'action', 'state', 'item'].includes(c.kind))
  for (const part of parts) {
    for (const port of childrenOf(model, part.id)) {
      if (port.kind === 'port') out.add(`${part.name}.${port.name}`)
    }
  }
  // Add qualified forms so nested features can be targeted too.
  for (const el of model.elements) {
    if (el.kind === 'port' && el.parentId) {
      const p = byId(model, el.parentId)
      if (p) out.add(`${p.qname}::${el.name}`)
    }
  }
  return [...out].sort()
}

export function elementPaths(model: SysmlModel): string[] {
  return model.elements
    .filter((e) => ['part', 'requirement', 'action', 'state', 'item', 'interface', 'package'].includes(e.kind))
    .map((e) => e.qname)
    .sort()
}

export function connectionScope(model: SysmlModel): SysmlElement | undefined {
  const counts = new Map<string, number>()
  for (const el of model.elements) {
    if (el.kind === 'connection') {
      counts.set(el.parentId, (counts.get(el.parentId) ?? 0) + 1)
    }
  }
  let best: SysmlElement | undefined
  let bestCount = 0
  for (const [id, count] of counts) {
    if (count > bestCount) {
      bestCount = count
      best = byId(model, id)
    }
  }
  return best
}

export function diagramScopes(model: SysmlModel): SysmlElement[] {
  return model.elements
    .filter((e) => {
      if (e.kind === 'root') return false
      if (e.kind === 'port' || e.kind === 'attribute' || e.kind === 'constraint' || isRelationship(e)) {
        return false
      }
      return (e.children?.length ?? 0) > 0 || e.spans.bodyOpen >= 0
    })
    .sort((a, b) => a.qname.localeCompare(b.qname))
}

export function defaultScope(model: SysmlModel, mode: DiagramMode): string {
  const withConn = connectionScope(model)
  if (withConn) return withConn.id
  const root = model.elements.find((e) => e.kind === 'root')
  if (root) return root.id
  const candidate = model.elements.find((e) => e.kind === 'package' || e.kind === 'part')
  return candidate?.id ?? ''
}

export function docFor(model: SysmlModel, el: SysmlElement): string {
  if (el.docResolved) return el.docResolved
  if (el.doc) return el.doc
  const seen = new Set<string>()
  let current: SysmlElement | undefined = el
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    if (current.doc) return current.doc
    current = byId(model, current.typeId) ?? byId(model, current.specializesId)
  }
  return ''
}

export function attributesOf(model: SysmlModel, el: SysmlElement): SysmlElement[] {
  const out: SysmlElement[] = []
  const names = new Set<string>()
  const add = (owner: SysmlElement) => {
    for (const child of childrenOf(model, owner.id)) {
      if (child.kind !== 'attribute' || names.has(child.name)) continue
      names.add(child.name)
      out.push(child)
    }
  }
  add(el)
  const visited = new Set<string>()
  const walk = (current: SysmlElement | undefined) => {
    if (!current || visited.has(current.id)) return
    visited.add(current.id)
    for (const ref of [current.typeId, current.specializesId]) {
      if (!ref) continue
      const type = byId(model, ref)
      if (!type) continue
      add(type)
      walk(type)
    }
  }
  walk(el)
  return out
}

export function portsOf(model: SysmlModel, el: SysmlElement): SysmlElement[] {
  // Interconnection views show the ports a part actually has, including ports
  // inherited from its type and specialisation chain (e.g. spark1 : DGXSpark
  // gets inferenceApi/interconnect/nfsExport from the DGXSpark definition).
  const out: SysmlElement[] = []
  const names = new Set<string>()
  const add = (port: SysmlElement) => {
    if (port.kind !== 'port' || names.has(port.name)) return
    names.add(port.name)
    out.push(port)
  }
  for (const child of childrenOf(model, el.id)) add(child)
  const visited = new Set<string>()
  const walk = (current: SysmlElement | undefined) => {
    if (!current || visited.has(current.id)) return
    visited.add(current.id)
    for (const ref of [current.typeId, current.specializesId]) {
      if (!ref) continue
      const type = byId(model, ref)
      if (!type) continue
      for (const child of childrenOf(model, type.id)) add(child)
      walk(type)
    }
  }
  walk(el)
  return out
}

export function satisfiesFor(model: SysmlModel, req: SysmlElement): SysmlElement[] {
  const links = model.elements.filter((e) => e.kind === 'satisfy')
  const ids = new Set<string>()
  const requirementIds = new Set([req.id, req.typeId].filter(Boolean) as string[])
  for (const link of links) {
    if (link.requirementId && requirementIds.has(link.requirementId)) {
      if (link.satisfierId) ids.add(link.satisfierId)
    }
  }
  return [...ids].map((id) => byId(model, id)).filter(Boolean) as SysmlElement[]
}

export function requirementsOf(model: SysmlModel): SysmlElement[] {
  return model.elements.filter((e) => e.kind === 'requirement')
}

export function diagnosticsFor(model: SysmlModel, elementId: string): number {
  return model.diagnostics.filter((d) => d.elementId === elementId).length
}

export function isRelationship(el: SysmlElement): boolean {
  return ['connection', 'dependency', 'satisfy', 'verify', 'message', 'succession', 'first'].includes(el.kind)
}

// Keep UI affordances aligned with the source editor's supported operations.
export function editCapabilities(el: SysmlElement) {
  const type = !isRelationship(el) && !['root', 'package', 'constraint', 'entry'].includes(el.kind)
    && (el.spans.name.end > el.spans.name.start || el.spans.type.end > el.spans.type.start)
  return {
    name: el.kind !== 'root' && !el.implicit && el.spans.name.end > el.spans.name.start,
    type,
    value: type && (el.kind === 'attribute' || el.value !== undefined),
    doc: !el.implicit && !['root', 'first', 'succession', 'verify', 'entry', 'dependency'].includes(el.kind),
    delete: el.kind !== 'root' && !el.implicit,
  }
}

export function requiredConstraints(model: SysmlModel, req: SysmlElement): SysmlElement[] {
  const constraints: SysmlElement[] = []
  const seen = new Set<string>()
  let current: SysmlElement | undefined = req
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    constraints.push(...childrenOf(model, current.id).filter(e => e.kind === 'constraint' && e.constraintRole === 'require'))
    current = byId(model, current.typeId)
  }
  return constraints
}

export function verificationCasesFor(model: SysmlModel, req: SysmlElement): SysmlElement[] {
  const targets = new Set([req.id, req.typeId].filter(Boolean))
  const cases = new Map<string, SysmlElement>()
  for (const link of model.elements) {
    if (link.kind !== 'verify' || !targets.has(link.requirementId)) continue
    let owner = byId(model, link.parentId)
    while (owner && !['verification', 'verification case'].includes(owner.kind)) owner = byId(model, owner.parentId)
    if (owner) cases.set(owner.id, owner)
  }
  return [...cases.values()]
}
