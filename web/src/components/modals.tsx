import { useEffect, useRef, useState, type FormEvent } from 'react'
import {
  CheckCheck,
  CircleAlert,
  FileCode2,
  FilePlus2,
  History,
  Keyboard,
  Link2,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { createFile, getHistory } from '../api'
import type {
  NewConnection,
  NewElement,
  NewSatisfy,
} from '../api'
import type { Revision, SysmlElement, SysmlModel } from '../types'
import {
  byId,
  cx,
  displayName,
  elementPaths,
  formatBytes,
  formatTime,
  isContainer,
  plural,
  portPaths,
  refFor,
  requirementsOf,
  safeImportName,
  shortKind,
} from '../utils'
import Modal from './Modal'

// ------------------------------------------------------------------ new file

export function NewFileModal({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (name: string) => Promise<void>
}) {
  const [name, setName] = useState('new-model.sysml')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!/^[A-Za-z0-9._-]+\.sysml$/.test(name)) {
      setError('Use letters, digits, dots, dashes and underscores, ending in .sysml')
      return
    }
    setBusy(true)
    try {
      await onCreate(name)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="New model file"
      subtitle="Create a SysML v2 textual model in the workspace"
      icon={<FilePlus2 size={18} />}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={(e) => void submit(e as unknown as FormEvent)} disabled={busy}>
            {busy ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} Create file
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">File name</span>
        <input className="input mono" value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} />
        <span className="form-hint">A starter package is created with a System definition and usage.</span>
      </label>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  )
}

// ------------------------------------------------------------------ import

export interface ImportFile {
  name: string
  content: string
  size: number
}

export function ImportModal({
  initialFiles,
  onClose,
  onImported,
}: {
  initialFiles?: ImportFile[]
  onClose: () => void
  onImported: (name: string) => void
}) {
  const [files, setFiles] = useState<ImportFile[]>(initialFiles ?? [])
  const [dragOver, setDragOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Array<{ name: string; message: string }>>([])
  const [message, setMessage] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const addFiles = async (list: FileList | File[]) => {
    const next = [...files]
    const newErrors: Array<{ name: string; message: string }> = []
    for (const file of Array.from(list)) {
      if (!/\.sysml$/i.test(file.name)) {
        newErrors.push({ name: file.name, message: 'Not a .sysml file' })
        continue
      }
      if (file.size > 16 * 1024 * 1024) {
        newErrors.push({ name: file.name, message: 'File is larger than 16 MiB' })
        continue
      }
      let name = safeImportName(file.name)
      let suffix = 2
      while (next.some((f) => f.name === name)) {
        name = safeImportName(`${file.name.replace(/\.sysml$/i, '')}-${suffix}`)
        suffix++
      }
      try {
        const content = await file.text()
        next.push({ name, content, size: file.size })
      } catch {
        newErrors.push({ name: file.name, message: 'Could not read the file' })
      }
    }
    setFiles(next)
    setErrors((current) => [...current, ...newErrors])
    setMessage('')
  }

  const runImport = async () => {
    if (files.length === 0 || busy) return
    setBusy(true)
    setErrors([])
    const imported: string[] = []
    const failed: Array<{ name: string; message: string }> = []
    for (const file of files) {
      try {
        await createFile(file.name, file.content)
        imported.push(file.name)
      } catch (err) {
        failed.push({
          name: file.name,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }
    setBusy(false)
    if (imported.length > 0) onImported(imported[0])
    if (failed.length === 0) {
      onClose()
      return
    }
    setFiles(files.filter((f) => !imported.includes(f.name)))
    setErrors(failed)
    setMessage(
      imported.length > 0
        ? `Imported ${plural(imported.length, 'file')}. ${plural(failed.length, 'file')} failed — rename and retry.`
        : 'Import failed. Fix the names or conflicts and try again.',
    )
  }

  return (
    <Modal
      title="Import SysML files"
      subtitle="Bring .sysml files from your computer into the workspace"
      icon={<Upload size={18} />}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={() => void runImport()} disabled={busy || files.length === 0}>
            {busy ? <Loader2 size={13} className="spin" /> : <Upload size={13} />}
            Import {files.length > 0 ? plural(files.length, 'file') : ''}
          </button>
        </>
      }
    >
      <div
        className={cx('dropzone', dragOver && 'active')}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          void addFiles(e.dataTransfer.files)
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click()
        }}
      >
        <Upload size={24} />
        <div style={{ fontWeight: 600, fontSize: 13 }}>Drop .sysml files here</div>
        <div style={{ fontSize: 11.5, color: 'var(--text-dim)' }}>
          or click to choose from your desktop
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".sysml,text/plain"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {message && <div className="form-hint">{message}</div>}

      {files.length > 0 && (
        <div className="import-list">
          {files.map((file, index) => (
            <div className="import-row" key={`${file.name}-${index}`}>
              <FileCode2 size={14} style={{ color: 'var(--accent)', flex: '0 0 auto' }} />
              <input
                className="input input-sm mono"
                value={file.name}
                onChange={(e) => {
                  const name = e.target.value
                  setFiles((current) =>
                    current.map((f, i) => (i === index ? { ...f, name } : f)),
                  )
                }}
                spellCheck={false}
                aria-label="Import file name"
              />
              <span style={{ fontSize: 10.5, color: 'var(--text-dim)', flex: '0 0 auto' }}>
                {formatBytes(file.size)}
              </span>
              <button
                className="icon-button"
                style={{ width: 24, height: 24 }}
                onClick={(e) => {
                  e.stopPropagation()
                  setFiles((current) => current.filter((_, i) => i !== index))
                }}
                aria-label="Remove file"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {errors.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
          {errors.map((err, i) => (
            <div key={i} className="form-error">
              <span className="mono">{err.name}</span>: {err.message}
            </div>
          ))}
        </div>
      )}

      <span className="form-hint">
        Names are sanitized to SysML workspace rules (letters, digits, dots, dashes and underscores).
        If a name already exists, rename the imported file or remove it.
      </span>
    </Modal>
  )
}

// ------------------------------------------------------------------ add element

const elementKinds = [
  'package', 'part', 'port', 'attribute', 'requirement', 'action', 'state',
  'item', 'enum', 'interface', 'allocation', 'constraint', 'calc', 'case',
  'analysis', 'verification', 'view', 'rendering', 'concern', 'occurrence',
]

export function AddElementModal({
  model,
  defaultParent,
  defaultKind,
  defaultIsDef,
  onClose,
  onCreate,
}: {
  model: SysmlModel
  defaultParent?: string
  defaultKind?: string
  defaultIsDef?: boolean
  onClose: () => void
  onCreate: (element: NewElement) => Promise<void>
}) {
  const containers = model.elements.filter(isContainer).sort((a, b) => a.qname.localeCompare(b.qname))
  const fallback = containers.find((e) => e.kind === 'root') ?? containers[0]
  const initialParent = defaultParent && containers.some((e) => e.id === defaultParent)
    ? defaultParent
    : fallback?.id ?? ''
  const [parent, setParent] = useState(initialParent)
  const [kind, setKind] = useState(defaultKind ?? 'part')
  const [isDef, setIsDef] = useState(defaultIsDef ?? false)
  const [name, setName] = useState('')
  const [type, setType] = useState('')
  const [doc, setDoc] = useState('')
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const parentEl = byId(model, parent)
  const showValue = kind === 'attribute'

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      setError('Name must be a valid SysML identifier (letters, digits, underscore).')
      return
    }
    setBusy(true)
    try {
      await onCreate({
        parent,
        kind,
        isDef: kind === 'package' ? true : isDef,
        name,
        type: kind === 'package' ? '' : type,
        doc,
        value: showValue ? value : '',
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Add element"
      subtitle={parentEl ? `Inside ${parentEl.qname || 'root'}` : undefined}
      icon={<Plus size={18} />}
      onClose={onClose}
      wide
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={(e) => void submit(e as unknown as FormEvent)} disabled={busy}>
            {busy ? <Loader2 size={13} className="spin" /> : <Plus size={13} />} Create element
          </button>
        </>
      }
    >
      <div className="modal-grid">
        <label className="field">
          <span className="field-label">Parent container</span>
          <select className="select" value={parent} onChange={(e) => setParent(e.target.value)}>
            {containers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.kind === 'root' ? 'root (top level)' : c.qname}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Kind</span>
          <select
            className="select"
            value={kind}
            onChange={(e) => {
              setKind(e.target.value)
              if (e.target.value === 'package') setIsDef(true)
            }}
          >
            {elementKinds.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="modal-grid">
        <label className="field">
          <span className="field-label">Name</span>
          <input className="input mono" value={name} onChange={(e) => setName(e.target.value)} placeholder="myElement" spellCheck={false} autoFocus />
        </label>
        <label className="field">
          <span className="field-label">Type</span>
          <input className="input mono" value={type} onChange={(e) => setType(e.target.value)} placeholder="e.g. AIStack::DGXSpark" spellCheck={false} disabled={kind === 'package'} />
        </label>
      </div>

      <div className="modal-grid">
        <div className="field">
          <span className="field-label">Declaration</span>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={isDef}
              onChange={(e) => setIsDef(e.target.checked)}
              disabled={kind === 'package'}
            />
            Definition (<span className="mono">{kind} def</span>)
          </label>
          <span className="form-hint">
            Definitions describe a type. Usages instantiate a type inside a part or package.
          </span>
        </div>
        {showValue && (
          <label className="field">
            <span className="field-label">Value</span>
            <input className="input mono" value={value} onChange={(e) => setValue(e.target.value)} placeholder='"text" or 42' spellCheck={false} />
          </label>
        )}
      </div>

      <label className="field">
        <span className="field-label">Documentation</span>
        <textarea className="textarea" value={doc} onChange={(e) => setDoc(e.target.value)} rows={4} placeholder="What is this element and why does it exist?" />
      </label>

      {error && <div className="form-error">{error}</div>}
    </Modal>
  )
}

// ------------------------------------------------------------------ add connection

export function AddConnectionModal({
  model,
  defaultParent,
  onClose,
  onCreate,
}: {
  model: SysmlModel
  defaultParent?: string
  onClose: () => void
  onCreate: (connection: NewConnection) => Promise<void>
}) {
  const containers = model.elements.filter(isContainer).sort((a, b) => a.qname.localeCompare(b.qname))
  const fallback = containers.find((e) => e.kind === 'root') ?? containers[0]
  const initialParent = defaultParent && containers.some((e) => e.id === defaultParent)
    ? defaultParent
    : fallback?.id ?? ''
  const [parent, setParent] = useState(initialParent)
  const [name, setName] = useState('')
  const [source, setSource] = useState('')
  const [target, setTarget] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const parentEl = byId(model, parent)
  const suggestions = parentEl ? portPaths(model, parentEl) : []

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!source.trim() || !target.trim()) {
      setError('Both endpoints are required.')
      return
    }
    setBusy(true)
    try {
      await onCreate({ parent, name, source, target })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Add connection"
      subtitle="Connect two ports in the selected container"
      icon={<Link2 size={18} />}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={(e) => void submit(e as unknown as FormEvent)} disabled={busy}>
            {busy ? <Loader2 size={13} className="spin" /> : <Link2 size={13} />} Create connection
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">Container</span>
        <select className="select" value={parent} onChange={(e) => setParent(e.target.value)}>
          {containers.map((c) => (
            <option key={c.id} value={c.id}>{c.kind === 'root' ? 'root (top level)' : c.qname}</option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field-label">Name (optional)</span>
        <input className="input mono" value={name} onChange={(e) => setName(e.target.value)} placeholder="auto-generated if empty" spellCheck={false} />
      </label>

      <div className="modal-grid">
        <label className="field">
          <span className="field-label">Source feature</span>
          <input className="input mono" list="skyview-source-paths" value={source} onChange={(e) => setSource(e.target.value)} placeholder="spark1.inferenceApi" spellCheck={false} />
        </label>
        <label className="field">
          <span className="field-label">Target feature</span>
          <input className="input mono" list="skyview-target-paths" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="servingEngine.api" spellCheck={false} />
        </label>
      </div>
      <datalist id="skyview-source-paths">
        {suggestions.map((s) => <option key={s} value={s} />)}
      </datalist>
      <datalist id="skyview-target-paths">
        {suggestions.map((s) => <option key={s} value={s} />)}
      </datalist>
      <span className="form-hint">
        Ports are shown as <span className="mono">part.port</span>. The source and target must resolve inside the container.
      </span>

      {error && <div className="form-error">{error}</div>}
    </Modal>
  )
}

// ------------------------------------------------------------------ add satisfy

export function AddSatisfyModal({
  model,
  defaultRequirement,
  defaultParent,
  onClose,
  onCreate,
}: {
  model: SysmlModel
  defaultRequirement?: string
  defaultParent?: string
  onClose: () => void
  onCreate: (link: NewSatisfy) => Promise<void>
}) {
  const reqs = requirementsOf(model).sort((a, b) => a.qname.localeCompare(b.qname))
  const containers = model.elements.filter(isContainer).sort((a, b) => a.qname.localeCompare(b.qname))
  const reqContext =
    model.elements.find((e) => e.kind !== 'root' && /requirements?context/i.test(e.name)) ??
    containers.find((e) => e.kind === 'root') ??
    containers[0]
  const initialParent = defaultParent && containers.some((e) => e.id === defaultParent)
    ? defaultParent
    : reqContext?.id ?? ''
  const [requirement, setRequirement] = useState(defaultRequirement ?? reqs[0]?.id ?? '')
  const [parent, setParent] = useState(initialParent)
  const [satisfier, setSatisfier] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const parentEl = byId(model, parent)
  const reqEl = byId(model, requirement)
  const suggestions = elementPaths(model)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    if (!parentEl || !reqEl || !satisfier.trim()) {
      setError('Choose a requirement, a container and a satisfier.')
      return
    }
    setBusy(true)
    try {
      await onCreate({
        parent,
        requirement: refFor(parentEl, reqEl),
        satisfier: satisfier.trim(),
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="Add satisfy link"
      subtitle="Trace a requirement to the element that fulfils it"
      icon={<CheckCheck size={18} />}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={(e) => void submit(e as unknown as FormEvent)} disabled={busy}>
            {busy ? <Loader2 size={13} className="spin" /> : <CheckCheck size={13} />} Add link
          </button>
        </>
      }
    >
      <label className="field">
        <span className="field-label">Requirement</span>
        <select className="select" value={requirement} onChange={(e) => setRequirement(e.target.value)}>
          {reqs.map((r) => (
            <option key={r.id} value={r.id}>
              {r.qname} {r.isDef ? '(definition)' : ''}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field-label">Link container</span>
        <select className="select" value={parent} onChange={(e) => setParent(e.target.value)}>
          {containers.map((c) => (
            <option key={c.id} value={c.id}>{c.kind === 'root' ? 'root (top level)' : c.qname}</option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field-label">Satisfied by</span>
        <input className="input mono" list="skyview-satisfier-paths" value={satisfier} onChange={(e) => setSatisfier(e.target.value)} placeholder="ai.gateway" spellCheck={false} />
        <span className="form-hint">Use a feature path relative to the container, or a qualified name.</span>
      </label>
      <datalist id="skyview-satisfier-paths">
        {suggestions.map((s) => <option key={s} value={s} />)}
      </datalist>

      {error && <div className="form-error">{error}</div>}
    </Modal>
  )
}

// ------------------------------------------------------------------ confirm

export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Delete',
  danger = true,
  onClose,
  onConfirm,
}: {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <Modal
      title={title}
      icon={danger ? <Trash2 size={18} /> : <CircleAlert size={18} />}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className={danger ? 'btn btn-danger' : 'btn btn-primary'}
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try {
                await onConfirm()
                onClose()
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err))
                setBusy(false)
              }
            }}
          >
            {busy ? <Loader2 size={13} className="spin" /> : danger ? <Trash2 size={13} /> : null}
            {confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: 13 }}>{message}</p>
      {error && <div className="form-error">{error}</div>}
    </Modal>
  )
}

// ------------------------------------------------------------------ history

export function HistoryModal({
  fileName,
  onClose,
  onRestore,
}: {
  fileName: string
  onClose: () => void
  onRestore: (revision: string) => Promise<void>
}) {
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [restoring, setRestoring] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getHistory(fileName)
      .then((r) => {
        if (!cancelled) {
          setRevisions(r)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [fileName])

  return (
    <Modal
      title="Version history"
      subtitle={fileName}
      icon={<History size={18} />}
      onClose={onClose}
      footer={<button className="btn" onClick={onClose}>Close</button>}
    >
      <span className="form-hint">
        A snapshot is saved automatically before every write. Restoring creates a new snapshot of the current state.
      </span>
      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', padding: 12 }}>
          <Loader2 size={14} className="spin" /> Loading snapshots…
        </div>
      ) : error ? (
        <div className="form-error">{error}</div>
      ) : revisions.length === 0 ? (
        <div style={{ color: 'var(--text-dim)', fontSize: 12, padding: 12 }}>
          No snapshots yet. They appear after the first save.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 5, maxHeight: 360, overflow: 'auto' }}>
          {revisions.map((r) => (
            <div
              key={r.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '8px 10px',
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: 'var(--bg-panel-2)',
              }}
            >
              <RotateCcw size={13} style={{ color: 'var(--text-dim)' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 12 }}>{formatTime(r.savedAt)}</div>
                <div className="mono" style={{ fontSize: 10, color: 'var(--text-dim)' }}>{formatBytes(r.size)}</div>
              </div>
              <button
                className="btn btn-xs"
                disabled={restoring !== null}
                onClick={async () => {
                  setRestoring(r.id)
                  try {
                    await onRestore(r.id)
                    onClose()
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err))
                    setRestoring(null)
                  }
                }}
              >
                {restoring === r.id ? <Loader2 size={11} className="spin" /> : <RotateCcw size={11} />}
                Restore
              </button>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

// ------------------------------------------------------------------ help

export function HelpModal({ onClose }: { onClose: () => void }) {
  const rows = [
    ['⌘K / Ctrl+K', 'Open the command palette'],
    ['⌘S / Ctrl+S', 'Save the source editor'],
    ['⌘Z / Ctrl+Z', 'Undo the last visual model edit'],
    ['⇧⌘Z / Ctrl+Y', 'Redo the last visual model edit'],
    ['Alt+1 … Alt+4', 'Switch between Grid, Diagram, Requirements and Source'],
    ['Esc', 'Close a modal or the palette'],
    ['Double-click a grid cell', 'Edit name, type, value or documentation'],
    ['Drag a port handle', 'Create a connection between two ports'],
    ['Add a note', 'Annotate a diagram node with a draggable note and dashed line'],
    ['Drop a .sysml file', 'Import it from your desktop into the workspace'],
    ['Click an element', 'Open the inspector for structured editing'],
  ]
  return (
    <Modal
      title="Keyboard & workflow"
      subtitle="SkyView is designed to be driven from the keyboard"
      icon={<Keyboard size={18} />}
      onClose={onClose}
      footer={<button className="btn" onClick={onClose}>Got it</button>}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {rows.map(([key, text]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="kbd" style={{ minWidth: 110, justifyContent: 'center' }}>{key}</span>
            <span style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{text}</span>
          </div>
        ))}
      </div>
      <div className="divider" />
      <span className="form-hint">
        The grid is a spreadsheet over the SysML model. Every structured edit is written back to the
        .sysml source, so the file stays the single source of truth.
      </span>
    </Modal>
  )
}
