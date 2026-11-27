import { useEffect, useMemo, useRef, useState } from 'react'
import CodeMirror from '@uiw/react-codemirror'
import { EditorView, keymap } from '@codemirror/view'
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import {
  CheckCircle2,
  CircleAlert,
  Code2,
  Download,
  History,
  Info,
  RotateCcw,
  Save,
  TriangleAlert,
  XCircle,
} from 'lucide-react'
import type { Diagnostic, FileResponse } from '../types'
import { cx, plural } from '../utils'

interface Props {
  file: FileResponse
  jumpLine: number | null
  jumpNonce: number
  saving: boolean
  onSave: (content: string) => Promise<void>
  onValidate: (content: string) => Promise<Diagnostic[]>
  onDirtyChange: (dirty: boolean) => void
  onOpenHistory: () => void
  onDownload: () => void
}

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

const sysmlLanguage = StreamLanguage.define({
  startState: () => ({ inComment: false }),
  token(stream, state) {
    if (state.inComment) {
      // Scan the whole line for the closing delimiter; the previous version
      // only checked at the current position, so a comment ending after
      // indentation left the lexer stuck in comment state (everything grey).
      while (!stream.eol()) {
        if (stream.match('*/')) {
          state.inComment = false
          return 'comment'
        }
        stream.next()
      }
      return 'comment'
    }
    if (stream.eatSpace()) return null
    if (stream.match('//')) {
      stream.skipToEnd()
      return 'comment'
    }
    if (stream.match('/*')) {
      state.inComment = true
      while (!stream.eol()) {
        if (stream.match('*/')) {
          state.inComment = false
          break
        }
        stream.next()
      }
      return 'comment'
    }
    if (stream.match(/"(?:[^"\\]|\\.)*"/)) return 'string'
    if (stream.match(/\d+(?:\.\d+)?/)) return 'number'
    if (stream.match(/[A-Za-z_$][A-Za-z0-9_$]*/)) {
      const word = stream.current()
      if (keywords.has(word)) return 'keyword'
      if (builtinTypes.has(word)) return 'typeName'
      return 'variableName'
    }
    if (stream.match(/::|->|=>|:=|==|!=|<=|>=|&&|\|\||\.\.|\*\*|:>|:>>/)) return 'operator'
    stream.next()
    return null
  },
})

const highlightStyle = HighlightStyle.define([
  { tag: tags.keyword, color: 'var(--syntax-keyword)', fontWeight: '600' },
  { tag: tags.typeName, color: 'var(--syntax-type)' },
  { tag: tags.string, color: 'var(--syntax-string)' },
  { tag: tags.number, color: 'var(--syntax-number)' },
  { tag: tags.comment, color: 'var(--syntax-comment)', fontStyle: 'italic' },
  { tag: tags.variableName, color: 'var(--syntax-name)' },
  { tag: tags.operator, color: 'var(--syntax-operator)' },
  { tag: tags.bracket, color: 'var(--text-muted)' },
])

const cmTheme = EditorView.theme(
  {
    '&': { backgroundColor: 'transparent', color: 'var(--text)', height: '100%' },
    '.cm-content': { caretColor: 'var(--accent)' },
    '.cm-scroller': { overflow: 'auto' },
    '.cm-gutters': {
      backgroundColor: 'var(--bg-panel-2)',
      color: 'var(--text-dim)',
      borderRight: '1px solid var(--border)',
    },
    '.cm-activeLine': {
      backgroundColor: 'color-mix(in srgb, var(--accent-soft) 45%, transparent)',
    },
    '.cm-activeLineGutter': { backgroundColor: 'var(--bg-hover)', color: 'var(--text)' },
    '.cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: 'var(--accent-soft) !important',
    },
    '.cm-cursor': { borderLeftColor: 'var(--accent)' },
    '.cm-foldPlaceholder': {
      backgroundColor: 'var(--bg-hover)',
      border: '1px solid var(--border)',
      color: 'var(--text-muted)',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--bg-elev)',
      border: '1px solid var(--border-strong)',
      color: 'var(--text)',
    },
  },
  { dark: false },
)

export default function SourceView({
  file,
  jumpLine,
  jumpNonce,
  saving,
  onSave,
  onValidate,
  onDirtyChange,
  onOpenHistory,
  onDownload,
}: Props) {
  const [draft, setDraft] = useState(file.content)
  const [dirty, setDirty] = useState(false)
  const [validating, setValidating] = useState(false)
  const viewRef = useRef<EditorView | null>(null)
  const dirtyRef = useRef(dirty)
  const draftRef = useRef(draft)
  const saveRef = useRef<() => void>(() => {})

  dirtyRef.current = dirty
  draftRef.current = draft
  saveRef.current = () => {
    if (dirtyRef.current && !saving) void save()
  }

  useEffect(() => {
    if (!dirty) {
      setDraft(file.content)
    }
  }, [file.content, file.revision, dirty])

  useEffect(() => {
    onDirtyChange(dirty)
  }, [dirty, onDirtyChange])

  useEffect(() => {
    if (!jumpLine || !viewRef.current) return
    const view = viewRef.current
    const line = view.state.doc.line(Math.max(1, Math.min(jumpLine, view.state.doc.lines)))
    view.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    })
    view.focus()
  }, [jumpLine, jumpNonce, file.name])

  const save = async () => {
    if (!dirty || saving) return
    try {
      await onSave(draft)
      setDirty(false)
    } catch {
      /* parent reports the error */
    }
  }

  const validate = async () => {
    if (validating) return
    setValidating(true)
    try {
      await onValidate(draft)
    } finally {
      setValidating(false)
    }
  }

  const extensions = useMemo(
    () => [
      sysmlLanguage,
      syntaxHighlighting(highlightStyle),
      cmTheme,
      EditorView.lineWrapping,
      keymap.of([
        {
          key: 'Mod-s',
          run: () => {
            saveRef.current()
            return true
          },
        },
      ]),
    ],
    [],
  )

  const diagnostics = file.diagnostics
  const errors = diagnostics.filter((d) => d.severity === 'error').length
  const warnings = diagnostics.filter((d) => d.severity === 'warning').length

  const jump = (line: number) => {
    const view = viewRef.current
    if (!view) return
    const l = view.state.doc.line(Math.max(1, Math.min(line, view.state.doc.lines)))
    view.dispatch({
      selection: { anchor: l.from },
      effects: EditorView.scrollIntoView(l.from, { y: 'center' }),
    })
    view.focus()
  }

  return (
    <div className="source-layout">
      <div className="source-toolbar">
        <span className="section-title">
          <Code2 size={13} /> Source
        </span>
        <span className="badge badge-muted mono">{file.name}</span>
        {dirty ? (
          <span className="badge badge-warning">unsaved changes</span>
        ) : (
          <span className="badge badge-success">
            <CheckCircle2 size={10} /> synced
          </span>
        )}
        <div className="grow" style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--text-dim)' }}>
          {plural(file.content.split('\n').length, 'line')}
        </span>
        <button className="btn btn-sm" onClick={onOpenHistory}>
          <History size={13} /> History
        </button>
        <button className="btn btn-sm" onClick={onDownload}>
          <Download size={13} /> Download
        </button>
        <button className="btn btn-sm" onClick={() => void validate()} disabled={validating}>
          <Info size={13} /> {validating ? 'Checking…' : 'Validate'}
        </button>
        <button
          className="btn btn-sm"
          onClick={() => {
            setDraft(file.content)
            setDirty(false)
          }}
          disabled={!dirty}
        >
          <RotateCcw size={13} /> Revert
        </button>
        <button className="btn btn-sm btn-primary" onClick={() => void save()} disabled={!dirty || saving}>
          <Save size={13} /> {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className="source-editor">
        <CodeMirror
          value={draft}
          height="100%"
          theme="none"
          extensions={extensions}
          basicSetup={{
            lineNumbers: true,
            foldGutter: true,
            highlightActiveLine: true,
            highlightActiveLineGutter: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: false,
            searchKeymap: true,
          }}
          onChange={(value) => {
            setDraft(value)
            setDirty(value !== file.content)
          }}
          onCreateEditor={(view) => {
            viewRef.current = view
          }}
        />
      </div>

      <div className="diag-panel">
        <div className="diag-panel-head">
          {errors > 0 ? (
            <XCircle size={13} className="diag-icon error" />
          ) : warnings > 0 ? (
            <TriangleAlert size={13} className="diag-icon warning" />
          ) : (
            <CheckCircle2 size={13} style={{ color: 'var(--success)' }} />
          )}
          <span>
            {diagnostics.length === 0
              ? 'No diagnostics — the model parses cleanly.'
              : `${plural(errors, 'error')}, ${plural(warnings, 'warning')}`}
          </span>
          {diagnostics.length > 0 && (
            <span style={{ marginLeft: 'auto', color: 'var(--text-dim)' }}>click a row to jump</span>
          )}
        </div>
        {diagnostics.map((d, i) => (
          <div key={i} className="diag-item" onClick={() => jump(d.line)}>
            <span className={`diag-icon ${d.severity}`}>
              {d.severity === 'error' ? (
                <XCircle size={12} />
              ) : d.severity === 'warning' ? (
                <TriangleAlert size={12} />
              ) : (
                <Info size={12} />
              )}
            </span>
            <span className="where">
              {d.line}:{d.column}
            </span>
            <span style={{ flex: 1 }}>{d.message}</span>
            <CircleAlert size={11} style={{ color: 'var(--text-dim)' }} />
          </div>
        ))}
      </div>
    </div>
  )
}
