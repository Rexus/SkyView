import { EditorState } from '@codemirror/state'
import { setDiagnosticsEffect } from '@codemirror/lint'
import type { Diagnostic as Marker } from '@codemirror/lint'
import type { Diagnostic } from './types'

export const normalizeSource = (source: string) => source.replace(/\r\n?/g, '\n')

// Remove old markers in the same transaction as the edit, before revalidation.
export const clearEditedDiagnostics = EditorState.transactionExtender.of(tr =>
  tr.docChanged ? { effects: setDiagnosticsEffect.of([]) } : null,
)

export function editorDiagnostics(source: string, diagnostics: Diagnostic[]): Marker[] {
  const byteToChar: number[] = []
  let bytes = 0, chars = 0
  for (const char of source) {
    const point = char.codePointAt(0)!
    const width = point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4
    for (let i = 0; i < width; i++) byteToChar[bytes++] = chars
    chars += char.length
  }
  byteToChar[bytes] = chars
  const offset = (value: number) => byteToChar[Math.max(0, Math.min(bytes, Math.trunc(value)))]
  const lines = source.split('\n')
  return diagnostics.map(d => {
    let from: number, to: number
    if (d.range && Number.isFinite(d.range.start) && Number.isFinite(d.range.end)) {
      from = offset(d.range.start); to = Math.max(from, offset(d.range.end))
    } else {
      // Compatibility with an older server's 1-based line/UTF-8-byte column.
      const line = Math.max(0, Math.min(lines.length - 1, d.line - 1))
      const prefix = lines.slice(0, line).join('\n') + (line ? '\n' : '')
      const baseBytes = new TextEncoder().encode(prefix).length
      const width = new TextEncoder().encode(lines[line]).length
      from = offset(baseBytes + Math.min(width, Math.max(0, d.column - 1)))
      const character = source.codePointAt(from)
      to = Math.min(source.length, from + (character !== undefined && character > 0xffff ? 2 : 1))
    }
    return {
      from, to, severity: d.severity, source: d.source ?? 'SkyView projection',
      message: d.message + (d.hint ? `\n\nSuggested fix: ${d.hint}` : ''),
    }
  })
}

export function editorLocation(source: string, from: number): string {
  const prefix = source.slice(0, from)
  return `${prefix.split('\n').length}:${from - prefix.lastIndexOf('\n')}`
}
