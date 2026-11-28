import type { FileResponse, SysmlModel } from './types'

type Range = { from: number; to: number }
type Declaration = Range & { id: string; name: Range }

export function sourceDeclarations(file: FileResponse): Declaration[] {
  const elements = (file.model?.elements ?? []).filter(element =>
    element.kind !== 'root' && !element.implicit && element.spans?.decl && element.spans.decl.end > element.spans.decl.start,
  )
  if (!elements.length) return []

  // Model spans are UTF-8 offsets in the saved file. CodeMirror uses UTF-16
  // positions and normalizes CRLF to one character.
  const offsets = [...new Set(elements.flatMap(({ spans }) => [
    spans.decl.start, spans.decl.end, spans.name?.start, spans.name?.end,
  ]).filter(value => Number.isSafeInteger(value) && value >= 0))].sort((a, b) => a - b)
  const mapped = new Map<number, number>()
  let bytes = 0, chars = 0, next = 0, afterCR = false
  for (const char of file.content) {
    const point = char.codePointAt(0)!
    const width = point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4
    bytes += width
    while (next < offsets.length && offsets[next] < bytes) mapped.set(offsets[next++], chars)
    if (char !== '\n' || !afterCR) chars += char.length
    afterCR = char === '\r'
    if (next === offsets.length) break
  }
  if (offsets[next] === bytes) mapped.set(bytes, chars)
  return elements.flatMap(({ id, spans }) => {
    const from = mapped.get(spans.decl.start), to = mapped.get(spans.decl.end)
    if (from === undefined || to === undefined || from >= to) return []
    const nameFrom = mapped.get(spans.name?.start), nameTo = mapped.get(spans.name?.end)
    const name = nameFrom !== undefined && nameTo !== undefined && nameFrom >= from && nameTo <= to && nameFrom < nameTo
      ? { from: nameFrom, to: nameTo } : { from, to: Math.min(to, from + 1) }
    return [{ id, from, to, name }]
  }).sort((a, b) => (a.to - a.from) - (b.to - b.from))
}

export function declarationAt(declarations: Declaration[], position: number) {
  return declarations.find(({ from, to }) => position >= from && position < to)?.id ?? null
}

export function visibleOwner(model: SysmlModel, id: string | null | undefined, visible: Set<string>) {
  if (id && visible.has(id)) return id
  const owners = new Map(model.elements.map(element => [element.id, element.parentId]))
  const visited = new Set<string>()
  while (id && !visited.has(id)) {
    if (visible.has(id)) return id
    visited.add(id)
    id = owners.get(id)
  }
  return null
}
