import { useEffect, useState } from 'react'
import type { Diagnostic } from '@codemirror/lint'
import type { EditorView } from '@codemirror/view'

type Mark = { marker: Diagnostic; line: number; position: number; count: number }
const priority = { error: 3, warning: 2, info: 1, hint: 0 }

export default function DiagnosticOverview({ editor, diagnostics, geometry, onJump }: {
  editor: EditorView | null
  diagnostics: readonly Diagnostic[]
  geometry: number
  onJump: (marker: Diagnostic) => void
}) {
  const [measured, setMeasured] = useState<{ diagnostics: readonly Diagnostic[]; marks: Mark[] }>()
  useEffect(() => {
    if (!editor || !diagnostics.length) return
    let active = true
    editor.requestMeasure({
      read(view) {
        const lines = new Map<number, Mark>()
        for (const marker of diagnostics) {
          if (marker.from > view.state.doc.length) continue
          const line = view.state.doc.lineAt(marker.from).number
          const previous = lines.get(line)
          if (previous && priority[previous.marker.severity] >= priority[marker.severity]) {
            previous.count++
            continue
          }
          const block = view.lineBlockAt(marker.from)
          const position = view.contentHeight > 0 ? (block.top + block.height / 2) / view.contentHeight
            : (line - .5) / view.state.doc.lines
          lines.set(line, { marker, line, position, count: (previous?.count ?? 0) + 1 })
        }
        return [...lines.values()].sort((a, b) => a.line - b.line)
      },
      write(marks) {
        if (active) setMeasured({ diagnostics, marks })
      },
    })
    return () => { active = false }
  }, [editor, diagnostics, geometry])
  const marks = measured?.diagnostics === diagnostics ? measured.marks : []
  return <div className="source-overview" role="group" aria-label="Scrollbar diagnostics">
    {marks.map(({ marker, line, position, count }) => {
      const label = `Line ${line} · ${marker.severity} · ${marker.message}${count > 1 ? ` (+${count - 1} on this line)` : ''}`
      return <button type="button" className={'source-overview-marker ' + marker.severity} key={line}
        title={label} aria-label={label} style={{ top: Math.max(0, Math.min(1, position)) * 100 + '%' }}
        onClick={() => onJump(marker)} />
    })}
  </div>
}
