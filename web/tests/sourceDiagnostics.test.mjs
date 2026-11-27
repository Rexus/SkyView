import test from 'node:test'
import assert from 'node:assert/strict'
import { EditorState } from '@codemirror/state'
import { diagnosticCount, forEachDiagnostic, linter, setDiagnostics } from '@codemirror/lint'
import { editorDiagnostics, editorLocation, normalizeSource, clearEditedDiagnostics } from '../src/sourceDiagnostics.ts'

test('UTF-8 native ranges map to the exact UTF-16 editor token after non-ASCII text', () => {
  const source = '// 🛰 Å\npackage P { part b : Ghost::Boat; }'
  const prefix = source.slice(0, source.indexOf('Ghost'))
  const start = Buffer.byteLength(prefix)
  const [marker] = editorDiagnostics(source, [{ severity: 'warning', message: 'Unresolved type', hint: 'Check its namespace.', line: 2, column: 1, range: { start, end: start + 11 } }])
  assert.equal(source.slice(marker.from, marker.to), 'Ghost::Boat')
  assert.equal(marker.message, 'Unresolved type\n\nSuggested fix: Check its namespace.')
  assert.equal(editorLocation(source, marker.from), '2:22')
})

test('legacy byte columns and EOF diagnostics stay within the current document', () => {
  const source = "// comment\npart 'Båt' : Ghost;"
  const column = Buffer.byteLength("part 'Båt' : ") + 1
  const [legacy, eof] = editorDiagnostics(source, [
    { severity: 'warning', message: 'type', line: 2, column },
    { severity: 'error', message: 'missing brace', line: 2, column: 99, range: { start: 999, end: 1000 } },
  ])
  assert.equal(source.slice(legacy.from, legacy.to), 'G')
  assert.equal(eof.from, source.length); assert.equal(eof.to, source.length)
})

test('editor normalizes CRLF without reporting an opening-only edit', () => {
  assert.equal(normalizeSource('package P {\r\n}\r\n'), 'package P {\n}\n')
})

test('CodeMirror clears old markers in the edit transaction and accepts corrected validation', () => {
  let state = EditorState.create({ doc: 'part a : Ghost;', extensions: [linter(null), clearEditedDiagnostics] })
  state = state.update(setDiagnostics(state, [{ from: 9, to: 14, severity: 'error', message: 'Unknown type' }])).state
  assert.equal(diagnosticCount(state), 1)
  let marked = ''
  forEachDiagnostic(state, (_d, from, to) => { marked = state.doc.sliceString(from, to) })
  assert.equal(marked, 'Ghost')
  state = state.update({ changes: { from: 9, to: 14, insert: 'Vehicle' } }).state
  assert.equal(diagnosticCount(state), 0)
  state = state.update(setDiagnostics(state, [])).state
  assert.equal(diagnosticCount(state), 0)
})
