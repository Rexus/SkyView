import { foldService, StreamLanguage, syntaxTree, syntaxTreeAvailable } from '@codemirror/language'
import type { Text } from '@codemirror/state'
import { tags } from '@lezer/highlight'

const keywords = new Set([
  'package', 'part', 'port', 'attribute', 'requirement', 'connection', 'satisfy',
  'doc', 'import', 'private', 'public', 'protected', 'def', 'specializes',
  'specialises', 'connect', 'to', 'by', 'ref', 'in', 'out', 'inout', 'action',
  'state', 'item', 'enum', 'interface', 'allocation', 'flow', 'constraint',
  'calc', 'case', 'analysis', 'verification', 'view', 'rendering', 'concern',
  'metadata', 'abstract', 'readonly', 'derived', 'end', 'individual', 'snapshot',
  'timeslice', 'nonunique', 'ordered', 'constant', 'alias', 'dependency', 'comment',
])

const builtinTypes = new Set([
  'String', 'Integer', 'Boolean', 'Real', 'Natural', 'Complex', 'Rational',
  'Number', 'Anything', 'Positive', 'Negative', 'UnlimitedNatural', 'ScalarValues',
])

export const sysmlLanguage = StreamLanguage.define({
  startState: () => ({ inComment: false }),
  mergeTokens: false,
  tokenTable: { blockOpen: tags.brace, blockClose: tags.brace },
  token(stream, state) {
    if (!state.inComment) {
      if (stream.eatSpace()) return null
      if (stream.match('//')) {
        stream.skipToEnd()
        return 'comment'
      }
      state.inComment = Boolean(stream.match('/*'))
    }
    if (state.inComment) {
      while (!stream.eol()) {
        if (stream.match('*/')) {
          state.inComment = false
          break
        }
        stream.next()
      }
      return 'comment'
    }
    if (stream.match(/^(?:"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?)/)) return 'string'
    if (stream.match(/\d+(?:\.\d+)?/)) return 'number'
    if (stream.match(/[A-Za-z_$][A-Za-z0-9_$]*/)) {
      const word = stream.current()
      if (keywords.has(word)) return 'keyword'
      if (builtinTypes.has(word)) return 'typeName'
      return 'variableName'
    }
    if (stream.match(/::|->|=>|:=|==|!=|<=|>=|&&|\|\||\.\.|\*\*|:>|:>>/)) return 'operator'
    switch (stream.next()) {
      case '{': return 'blockOpen'
      case '}': return 'blockClose'
      default: return null
    }
  },
})

type FoldRange = { from: number; to: number }
const documentFolds = new WeakMap<Text, Map<number, FoldRange>>()

export const sysmlFolding = foldService.of((state, lineStart) => {
  const { doc } = state
  let ranges = documentFolds.get(doc)
  if (!ranges) {
    ranges = new Map()
    // A package can close beyond CodeMirror's parsed viewport. Index the complete
    // token stream once for this buffer so its fold control is available immediately.
    const tree = syntaxTreeAvailable(state) ? syntaxTree(state) : sysmlLanguage.parser.parse(doc.toString())
    const openings: number[] = []
    for (const token = tree.cursor(); token.next();) {
      if (token.name === 'blockOpen') openings.push(token.to)
      if (token.name !== 'blockClose') continue
      const from = openings.pop()
      if (from === undefined) continue
      const line = doc.lineAt(from)
      if (token.from > line.to) ranges.set(line.from, { from, to: token.from })
    }
    documentFolds.set(doc, ranges)
  }
  return ranges.get(lineStart) ?? null
})
