import { ChangeSet, StateEffect, StateField, Text } from '@codemirror/state'
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view'

export const setSavedSource = StateEffect.define<string>()
const changedLine = Decoration.line({ class: 'cm-unsaved-line' })

function changesFrom(saved: Text, current: Text) {
  if (saved.eq(current)) return ChangeSet.empty(saved.length)
  const before = saved.toString(), after = current.toString()
  let from = 0, to = before.length, end = after.length
  while (from < to && from < end && before[from] === after[from]) from++
  while (to > from && end > from && before[to - 1] === after[end - 1]) { to--; end-- }
  return ChangeSet.of({ from, to, insert: current.slice(from, end) }, saved.length)
}

function markChanges(saved: Text, current: Text, changes: ChangeSet): DecorationSet {
  const marked = new Set<number>()
  const mark = (from: number, to: number) => {
    if (from < to && from === current.lineAt(from).to && current.sliceString(from, from + 1) === '\n') from++
    const first = current.lineAt(from).number
    const last = current.lineAt(Math.max(from, to - 1)).number
    for (let line = first; line <= last; line++) marked.add(current.line(line).from)
  }
  changes.iterChanges((oldFrom, oldTo, from, _to, inserted) => {
    const removed = saved.slice(oldFrom, oldTo)
    if (removed.eq(inserted)) return
    if (removed.lines === inserted.lines) {
      for (let n = 1; n <= inserted.lines; n++) {
        const line = inserted.line(n)
        if (line.text !== removed.line(n).text) mark(from + line.from, from + line.to)
      }
    } else {
      changesFrom(removed, inserted).iterChanges((_, __, start, end) => mark(from + start, from + end))
    }
  }, true)
  return Decoration.set(Array.from(marked, position => changedLine.range(position)), true)
}

export const unsavedSourceLines = StateField.define({
  create: state => ({
    saved: state.doc,
    changes: ChangeSet.empty(state.doc.length),
    decorations: Decoration.none,
  }),
  update(value, transaction) {
    const baseline = transaction.effects.find(effect => effect.is(setSavedSource))
    if (!baseline && !transaction.docChanged) return value
    const saved = baseline ? Text.of(baseline.value.split('\n')) : value.saved
    const current = transaction.newDoc
    if (saved.eq(current)) return { saved, changes: ChangeSet.empty(saved.length), decorations: Decoration.none }
    const changes = baseline ? changesFrom(saved, current) : value.changes.compose(transaction.changes)
    return { saved, changes, decorations: markChanges(saved, current, changes) }
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations),
})
