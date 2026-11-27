import ProjectBar from './components/ProjectBar'
import { PROJECT_ID } from './api'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CheckCheck,
  CircleAlert,
  CircleHelp,
  Code2,
  Command,
  Download,
  FilePlus2,
  FolderOpen,
  History,
  LayoutGrid,
  Link2,
  ListChecks,
  Loader2,
  Moon,
  Network,
  Plus,
  Redo2,
  Sun,
  Undo2,
  Upload,
  X,
} from 'lucide-react'
import {
  addConnection,
  addElement,
  addSatisfy,
  createFile,
  deleteElement,
  deleteFile,
  downloadUrl,
  getFile,
  listFiles,
  patchElement,
  restoreRevision,
  saveFile,
  validateFile,
} from './api'
import type {
  ElementPatch,
  NewConnection,
  NewElement,
  NewSatisfy,
} from './api'
import type { FileInfo, FileResponse, Tab, Toast } from './types'
import {
  byId,
  cx,
  displayName,
  isContainer,
  kindColor,
  plural,
  requirementCount,
  safeImportName,
} from './utils'
import Header from './components/Header'
import Sidebar from './components/Sidebar'
import GridEditor from './components/GridEditor'
import DiagramView from './components/DiagramView'
import RequirementsView from './components/RequirementsView'
import SourceView from './components/SourceView'
import SharedViews from './components/SharedViews'
import Inspector from './components/Inspector'
import CommandPalette, { type PaletteCommand } from './components/CommandPalette'
import Toasts from './components/Toasts'
import {
  AddConnectionModal,
  AddElementModal,
  AddSatisfyModal,
  ConfirmModal,
  HelpModal,
  HistoryModal,
  ImportModal,
  NewFileModal,
  type ImportFile,
} from './components/modals'

type Theme = 'dark' | 'light'

type Snapshot = {
  content: string
  selectedId: string | null
}

const MAX_UNDO = 50

type ModalState =
  | { type: 'new-file' }
  | { type: 'add-element'; parent?: string; kind?: string; isDef?: boolean }
  | { type: 'add-connection'; parent?: string }
  | { type: 'add-satisfy'; requirement?: string; parent?: string }
  | { type: 'confirm-delete-element'; id: string; name: string }
  | { type: 'confirm-delete-file'; name: string }
  | { type: 'confirm-open-file'; name: string }
  | { type: 'import'; files?: ImportFile[] }
  | { type: 'history' }
  | { type: 'help' }
  | null

function requirementsCount(file: FileResponse | null): number {
  return file ? requirementCount(file.model) : 0
}

export default function App() {
  const [files, setFiles] = useState<FileInfo[]>([])
  const [file, setFile] = useState<FileResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>(new URLSearchParams(location.search).has('view') ? 'shared' : 'grid')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('skyview-theme')
    return saved === 'light' ? 'light' : 'dark'
  })
  const [saving, setSaving] = useState(false)
  const [sourceDirty, setSourceDirty] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [modal, setModal] = useState<ModalState>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [jumpLine, setJumpLine] = useState<number | null>(null)
  const [jumpNonce, setJumpNonce] = useState(0)
  const [dragActive, setDragActive] = useState(false)
  const [undoStack, setUndoStack] = useState<Snapshot[]>([])
  const [redoStack, setRedoStack] = useState<Snapshot[]>([])
  const dragDepth = useRef(0)
  const toastId = useRef(0)

  const pushToast = useCallback((kind: Toast['kind'], message: string) => {
    const id = ++toastId.current
    setToasts((current) => [...current, { id, kind, message }])
    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id))
    }, 4500)
  }, [])

  const refreshFiles = useCallback(async () => {
    try {
      setFiles(await listFiles())
    } catch {
      /* the workspace may be briefly unavailable */
    }
  }, [])

  const recordUndo = useCallback((content: string, selected: string | null) => {
    setUndoStack((current) => [...current.slice(-(MAX_UNDO - 1)), { content, selectedId: selected }])
    setRedoStack([])
  }, [])

  const loadFile = useCallback(
    async (name: string) => {
      setLoading(true)
      setSourceDirty(false)
      setSelectedId(null)
      setJumpLine(null)
      setUndoStack([])
      setRedoStack([])
      try {
        const doc = await getFile(name)
        setFile(doc)
        const page = new URL(location.href); page.searchParams.set('file', name); page.searchParams.delete('view'); history.replaceState(null, '', page)
        setTab('grid')
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : String(err))
      } finally {
        setLoading(false)
      }
    },
    [pushToast],
  )

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const fs = await listFiles()
        if (cancelled) return
        setFiles(fs)
        if (fs.length > 0) {
          const requested = new URLSearchParams(location.search).get('file')
          if (requested && !fs.some(f => f.name === requested)) throw new Error(`Requested model ${requested} is not in this workspace`)
          const doc = await getFile(requested || fs[0].name)
          if (!cancelled) setFile(doc)
        }
      } catch (err) {
        if (!cancelled) pushToast('error', err instanceof Error ? err.message : String(err))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pushToast])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('skyview-theme', theme)
  }, [theme])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      if (e.altKey && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault()
        const tabs: Tab[] = ['grid', 'diagram', 'requirements', 'source']
        setTab(tabs[Number(e.key) - 1])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (file && selectedId && !byId(file.model, selectedId)) {
      setSelectedId(null)
    }
  }, [file, selectedId])

  const selectedElement = file && selectedId ? byId(file.model, selectedId) : undefined

  const parentFor = useCallback(
    (id?: string | null): string | undefined => {
      if (!file || !id) return undefined
      const el = byId(file.model, id)
      return el && isContainer(el) ? el.id : undefined
    },
    [file],
  )

  const connectionParentFor = useCallback(
    (id?: string | null): string | undefined => {
      if (!file || !id) return undefined
      const el = byId(file.model, id)
      if (!el) return undefined
      if (el.kind === 'connection') return el.parentId
      return isContainer(el) ? el.id : el.parentId
    },
    [file],
  )

  const requestOpenFile = useCallback(
    (name: string) => {
      if (name === file?.name) return
      if (sourceDirty) {
        setModal({ type: 'confirm-open-file', name })
        return
      }
      void loadFile(name)
    },
    [file?.name, sourceDirty, loadFile],
  )

  const handleCreateFile = useCallback(
    async (name: string) => {
      const resp = await createFile(name)
      setFile(resp)
      setSelectedId(null)
      setSourceDirty(false)
      setUndoStack([])
      setRedoStack([])
      setTab('grid')
      await refreshFiles()
      pushToast('success', `Created ${name}`)
    },
    [pushToast, refreshFiles],
  )

  const confirmDeleteFile = useCallback(async () => {
    if (!file) return
    await deleteFile(file.name)
    const fs = await listFiles()
    setFiles(fs)
    if (fs.length > 0) {
      const requested = new URLSearchParams(location.search).get('file')
          if (requested && !fs.some(f => f.name === requested)) throw new Error(`Requested model ${requested} is not in this workspace`)
          const doc = await getFile(requested || fs[0].name)
      setFile(doc)
      setSelectedId(null)
      setSourceDirty(false)
      setUndoStack([])
      setRedoStack([])
    } else {
      setFile(null)
      setSelectedId(null)
      setUndoStack([])
      setRedoStack([])
    }
    pushToast('success', `Deleted ${file.name}`)
  }, [file, pushToast])

  const handlePatch = useCallback(
    async (id: string, patch: ElementPatch) => {
      if (!file) return
      const before = byId(file.model, id)
      const oldContent = file.content
      const oldSelected = selectedId
      try {
        const resp = await patchElement(file.name, patch)
        recordUndo(oldContent, oldSelected)
        setFile(resp)
        if (!byId(resp.model, id)) {
          if (patch.name && before) {
            const next = resp.model.elements.find(
              (e) => e.name === patch.name && e.parentId === before.parentId,
            )
            setSelectedId(next ? next.id : null)
          } else {
            setSelectedId(null)
          }
        }
        void refreshFiles()
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : String(err))
      }
    },
    [file, selectedId, pushToast, refreshFiles, recordUndo],
  )

  const handleAddElement = useCallback(
    async (el: NewElement) => {
      if (!file) return
      const oldContent = file.content
      const oldSelected = selectedId
      const resp = await addElement(file.name, el)
      recordUndo(oldContent, oldSelected)
      setFile(resp)
      const created = resp.model.elements.find(
        (e) => e.parentId === el.parent && e.name === el.name && e.kind === el.kind,
      )
      if (created) setSelectedId(created.id)
      await refreshFiles()
      pushToast('success', `Added ${el.kind} ${el.name}`)
    },
    [file, selectedId, pushToast, refreshFiles, recordUndo],
  )

  const handleAddConnection = useCallback(
    async (conn: NewConnection) => {
      if (!file) return
      const oldContent = file.content
      const oldSelected = selectedId
      const resp = await addConnection(file.name, conn)
      recordUndo(oldContent, oldSelected)
      setFile(resp)
      const created = [...resp.model.elements]
        .reverse()
        .find((e) => e.kind === 'connection' && e.parentId === conn.parent)
      if (created) setSelectedId(created.id)
      await refreshFiles()
      pushToast('success', 'Connection added')
    },
    [file, selectedId, pushToast, refreshFiles, recordUndo],
  )

  const handleAddSatisfy = useCallback(
    async (link: NewSatisfy) => {
      if (!file) return
      const oldContent = file.content
      const oldSelected = selectedId
      const resp = await addSatisfy(file.name, link)
      recordUndo(oldContent, oldSelected)
      setFile(resp)
      const created = [...resp.model.elements]
        .reverse()
        .find((e) => e.kind === 'satisfy' && e.parentId === link.parent)
      if (created) setSelectedId(created.id)
      await refreshFiles()
      pushToast('success', 'Satisfy link added')
    },
    [file, selectedId, pushToast, refreshFiles, recordUndo],
  )

  const confirmDeleteElement = useCallback(
    async (id: string) => {
      if (!file) return
      const oldContent = file.content
      const oldSelected = selectedId
      const resp = await deleteElement(file.name, id)
      recordUndo(oldContent, oldSelected)
      setFile(resp)
      setSelectedId(null)
      await refreshFiles()
      pushToast('success', 'Element deleted')
    },
    [file, selectedId, pushToast, refreshFiles, recordUndo],
  )

  const handleSaveSource = useCallback(
    async (content: string) => {
      if (!file) return
      const oldContent = file.content
      const oldSelected = selectedId
      setSaving(true)
      try {
        const resp = await saveFile(file.name, content)
        recordUndo(oldContent, oldSelected)
        setFile(resp)
        setSourceDirty(false)
        void refreshFiles()
        const errors = resp.diagnostics.filter((d) => d.severity === 'error').length
        const warnings = resp.diagnostics.filter((d) => d.severity === 'warning').length
        if (errors) pushToast('error', `Saved with ${plural(errors, 'error')}`)
        else if (warnings) pushToast('info', `Saved with ${plural(warnings, 'warning')}`)
        else pushToast('success', 'Source saved')
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : String(err))
        throw err
      } finally {
        setSaving(false)
      }
    },
    [file, selectedId, pushToast, refreshFiles, recordUndo],
  )

  const handleValidate = useCallback(
    async (content: string): Promise<import('./types').Diagnostic[]> => {
      if (!file) throw new Error('No model selected')
      return validateFile(file.name, content)
    },
    [file?.name],
  )

  const handleRestore = useCallback(
    async (revision: string) => {
      if (!file) return
      const oldContent = file.content
      const oldSelected = selectedId
      const resp = await restoreRevision(file.name, revision)
      recordUndo(oldContent, oldSelected)
      setFile(resp)
      setSourceDirty(false)
      void refreshFiles()
      pushToast('success', 'Snapshot restored')
    },
    [file, selectedId, pushToast, refreshFiles, recordUndo],
  )

  const undo = useCallback(async () => {
    if (!file) return
    const snapshot = undoStack[undoStack.length - 1]
    if (!snapshot) {
      pushToast('info', 'Nothing to undo')
      return
    }
    const current: Snapshot = { content: file.content, selectedId }
    setSaving(true)
    try {
      const resp = await saveFile(file.name, snapshot.content)
      setRedoStack((prev) => [...prev.slice(-(MAX_UNDO - 1)), current])
      setUndoStack((prev) => prev.slice(0, -1))
      setFile(resp)
      setSelectedId(
        snapshot.selectedId && byId(resp.model, snapshot.selectedId) ? snapshot.selectedId : null,
      )
      void refreshFiles()
      pushToast('info', 'Undo')
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [file, selectedId, undoStack, pushToast, refreshFiles])

  const redo = useCallback(async () => {
    if (!file) return
    const snapshot = redoStack[redoStack.length - 1]
    if (!snapshot) {
      pushToast('info', 'Nothing to redo')
      return
    }
    const current: Snapshot = { content: file.content, selectedId }
    setSaving(true)
    try {
      const resp = await saveFile(file.name, snapshot.content)
      setUndoStack((prev) => [...prev.slice(-(MAX_UNDO - 1)), current])
      setRedoStack((prev) => prev.slice(0, -1))
      setFile(resp)
      setSelectedId(
        snapshot.selectedId && byId(resp.model, snapshot.selectedId) ? snapshot.selectedId : null,
      )
      void refreshFiles()
      pushToast('info', 'Redo')
    } catch (err) {
      pushToast('error', err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }, [file, selectedId, redoStack, pushToast, refreshFiles])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return
      const target = e.target as HTMLElement | null
      if (
        target &&
        (target.closest('.cm-editor') ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return
      }
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        void undo()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        void redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  const handleShowInSource = useCallback((line: number) => {
    setTab('source')
    setJumpLine(line)
    setJumpNonce((n) => n + 1)
  }, [])

  const handleDownload = useCallback(() => {
    if (!file) return
    const a = document.createElement('a')
    a.href = downloadUrl(file.name)
    a.download = file.name
    a.click()
  }, [file])

  const handleImported = useCallback(
    async (name: string) => {
      await refreshFiles()
      await loadFile(name)
      pushToast('success', `Imported ${name}`)
    },
    [loadFile, pushToast, refreshFiles],
  )

  const readDroppedFiles = useCallback(
    async (list: FileList | File[]) => {
      const out: ImportFile[] = []
      for (const f of Array.from(list)) {
        if (!/\.sysml$/i.test(f.name)) {
          pushToast('error', `${f.name} is not a .sysml file`)
          continue
        }
        if (f.size > 16 * 1024 * 1024) {
          pushToast('error', `${f.name} is larger than 16 MiB`)
          continue
        }
        try {
          const content = await f.text()
          out.push({ name: safeImportName(f.name), content, size: f.size })
        } catch {
          pushToast('error', `Could not read ${f.name}`)
        }
      }
      if (out.length > 0) setModal({ type: 'import', files: out })
    },
    [pushToast],
  )

  const openAddElement = useCallback(
    (parent?: string, kind?: string, isDef?: boolean) => {
      setModal({ type: 'add-element', parent: parentFor(parent), kind, isDef })
    },
    [parentFor],
  )

  const openAddConnection = useCallback(
    (parent?: string) => {
      setModal({ type: 'add-connection', parent: connectionParentFor(parent) })
    },
    [connectionParentFor],
  )

  const openAddSatisfy = useCallback(
    (requirement?: string) => {
      const req =
        requirement ??
        (selectedElement?.kind === 'requirement' ? selectedElement.id : undefined)
      setModal({ type: 'add-satisfy', requirement: req })
    },
    [selectedElement],
  )

  const openDeleteElement = useCallback(
    (id: string) => {
      if (!file) return
      const el = byId(file.model, id)
      if (!el) return
      setModal({ type: 'confirm-delete-element', id, name: displayName(el) })
    },
    [file],
  )

  const commands = useMemo<PaletteCommand[]>(() => {
    const list: PaletteCommand[] = [
      {
        id: 'tab-grid',
        label: 'Go to Grid',
        group: 'Navigate',
        hint: 'Alt+1',
        icon: <LayoutGrid size={14} />,
        run: () => setTab('grid'),
      },
      {
        id: 'tab-diagram',
        label: 'Go to Diagram',
        group: 'Navigate',
        hint: 'Alt+2',
        icon: <Network size={14} />,
        run: () => setTab('diagram'),
      },
      {
        id: 'tab-requirements',
        label: 'Go to Requirements',
        group: 'Navigate',
        hint: 'Alt+3',
        icon: <ListChecks size={14} />,
        run: () => setTab('requirements'),
      },
      {
        id: 'tab-source',
        label: 'Go to Source',
        group: 'Navigate',
        hint: 'Alt+4',
        icon: <Code2 size={14} />,
        run: () => setTab('source'),
      },
      {
        id: 'undo',
        label: 'Undo',
        group: 'Edit',
        hint: '⌘Z',
        icon: <Undo2 size={14} />,
        run: () => void undo(),
      },
      {
        id: 'redo',
        label: 'Redo',
        group: 'Edit',
        hint: '⇧⌘Z',
        icon: <Redo2 size={14} />,
        run: () => void redo(),
      },
      {
        id: 'new-element',
        label: 'Add element…',
        group: 'Create',
        icon: <Plus size={14} />,
        run: () => openAddElement(selectedId ?? undefined),
      },
      {
        id: 'new-connection',
        label: 'Add connection…',
        group: 'Create',
        icon: <Link2 size={14} />,
        run: () => openAddConnection(selectedId ?? undefined),
      },
      {
        id: 'new-satisfy',
        label: 'Add satisfy link…',
        group: 'Create',
        icon: <CheckCheck size={14} />,
        run: () => openAddSatisfy(),
      },
      {
        id: 'new-file',
        label: 'New model file…',
        group: 'Create',
        icon: <FilePlus2 size={14} />,
        run: () => setModal({ type: 'new-file' }),
      },
      {
        id: 'import-file',
        label: 'Import .sysml from desktop…',
        group: 'Create',
        icon: <Upload size={14} />,
        run: () => setModal({ type: 'import' }),
      },
      {
        id: 'history',
        label: 'Version history…',
        group: 'File',
        icon: <History size={14} />,
        run: () => setModal({ type: 'history' }),
      },
      {
        id: 'download',
        label: 'Download .sysml',
        group: 'File',
        icon: <Download size={14} />,
        run: handleDownload,
      },
      {
        id: 'theme',
        label: `Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`,
        group: 'View',
        icon: theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />,
        run: () => setTheme(theme === 'dark' ? 'light' : 'dark'),
      },
      {
        id: 'help',
        label: 'Keyboard shortcuts',
        group: 'View',
        icon: <CircleHelp size={14} />,
        run: () => setModal({ type: 'help' }),
      },
    ]
    if (file) {
      const elements = file.model.elements.filter((e) => e.kind !== 'root').slice(0, 300)
      for (const el of elements) {
        list.push({
          id: `el-${el.id}`,
          label: displayName(el),
          hint: el.qname,
          group: 'Elements',
          icon: (
            <span
              className="kind-dot"
              style={{ background: kindColor(el), width: 8, height: 8, borderRadius: 2 }}
            />
          ),
          run: () => {
            setSelectedId(el.id)
            setTab('grid')
          },
        })
      }
    }
    return list
  }, [
    theme,
    file,
    selectedId,
    handleDownload,
    openAddElement,
    openAddConnection,
    openAddSatisfy,
    undo,
    redo,
  ])

  const elementCount = file ? Math.max(0, file.model.elements.length - 1) : 0
  const connectionCount = file
    ? file.model.elements.filter((e) => e.kind === 'connection').length
    : 0
  const reqCount = requirementsCount(file)
  const errors = file?.diagnostics.filter((d) => d.severity === 'error').length ?? 0
  const warnings = file?.diagnostics.filter((d) => d.severity === 'warning').length ?? 0

  return (
    <div
      className="app"
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        dragDepth.current++
        setDragActive(true)
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
      }}
      onDragLeave={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        dragDepth.current--
        if (dragDepth.current <= 0) {
          dragDepth.current = 0
          setDragActive(false)
        }
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        dragDepth.current = 0
        setDragActive(false)
        void readDroppedFiles(e.dataTransfer.files)
      }}
    >
      <Header
        files={files}
        file={file}
        saving={saving}
        sourceDirty={sourceDirty}
        theme={theme}
        diagnostics={file?.diagnostics ?? []}
        onOpenFile={requestOpenFile}
        onNewFile={() => setModal({ type: 'new-file' })}
        onImport={() => setModal({ type: 'import' })}
        onDeleteFile={() => {
          if (file) setModal({ type: 'confirm-delete-file', name: file.name })
        }}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenHistory={() => (file ? setModal({ type: 'history' }) : pushToast('info', 'Open a model first'))}
        onOpenHelp={() => setModal({ type: 'help' })}
        onShowDiagnostics={() => {
          setTab('source')
          const first = file?.diagnostics[0]
          if (first) {
            setJumpLine(first.line)
            setJumpNonce((n) => n + 1)
          }
        }}
      />

      <ProjectBar sourceDirty={sourceDirty} saving={saving} />

      <div className="shell">
        <Sidebar
          model={file?.model ?? null}
          fileKey={file?.name ?? ''}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />

        <main className="main">
          {file && (
            <div className="viewbar">
              <button className={cx('tab', tab === 'grid' && 'active')} onClick={() => setTab('grid')}>
                <LayoutGrid size={14} /> Grid <span className="count">{elementCount}</span>
              </button>
              <button className={cx('tab', tab === 'diagram' && 'active')} onClick={() => setTab('diagram')}>
                <Network size={14} /> Diagram <span className="count">{connectionCount}</span>
              </button>
              <button
                className={cx('tab', tab === 'requirements' && 'active')}
                onClick={() => setTab('requirements')}
              >
                <ListChecks size={14} /> Requirements <span className="count">{reqCount}</span>
              </button>
              <button className={cx('tab', tab === 'source' && 'active')} onClick={() => setTab('source')}>
                <Code2 size={14} /> Source <span className="count">{errors + warnings}</span>
              </button>
              <button className={cx('tab', tab === 'shared' && 'active')} onClick={() => setTab('shared')}>Shared views</button>
              <div className="viewbar-spacer" />
              <div className="viewbar-actions">
                <button
                  className="icon-button tooltip"
                  data-tip="Undo (⌘Z)"
                  onClick={() => void undo()}
                  disabled={undoStack.length === 0}
                >
                  <Undo2 size={15} />
                </button>
                <button
                  className="icon-button tooltip"
                  data-tip="Redo (⇧⌘Z)"
                  onClick={() => void redo()}
                  disabled={redoStack.length === 0}
                >
                  <Redo2 size={15} />
                </button>
                <button className="icon-button tooltip" data-tip="Command palette" onClick={() => setPaletteOpen(true)}>
                  <Command size={15} />
                </button>
                <button className="icon-button tooltip" data-tip="Keyboard shortcuts" onClick={() => setModal({ type: 'help' })}>
                  <CircleHelp size={15} />
                </button>
              </div>
            </div>
          )}

          {loading && !file ? (
            <div className="loading-screen">
              <div className="loading-logo">
                <Loader2 size={22} className="spin" />
              </div>
              <div>Loading the SysML workspace…</div>
            </div>
          ) : !file ? (
            <div className="empty-state">
              <div className="icon-wrap">
                <FolderOpen size={24} />
              </div>
              <h2>No model loaded</h2>
              <p>
                SkyView works directly on .sysml files in the server workspace. Create a new model
                or add a file to the workspace directory.
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={() => setModal({ type: 'new-file' })}>
                  <FilePlus2 size={13} /> New model
                </button>
                <button className="btn" onClick={() => void refreshFiles()}>
                  Refresh workspace
                </button>
              </div>
            </div>
          ) : tab === 'shared' ? (
            <SharedViews file={file} />
          ) : tab === 'grid' ? (
            <GridEditor
              model={file.model}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onPatch={handlePatch}
              onDelete={openDeleteElement}
              onShowInSource={handleShowInSource}
              onAddElement={(parent) => openAddElement(parent)}
              onAddConnection={(parent) => openAddConnection(parent)}
              onAddSatisfy={(requirement) => openAddSatisfy(requirement)}
            />
          ) : tab === 'diagram' ? (
            <DiagramView
              file={file}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onAddElement={(parent) => openAddElement(parent)}
              onAddConnection={handleAddConnection}
              onOpenAddConnection={(parent) => openAddConnection(parent)}
              onShowInSource={handleShowInSource}
            />
          ) : tab === 'requirements' ? (
            <RequirementsView
              model={file.model}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onPatch={handlePatch}
              onAddRequirement={(parent) => openAddElement(parent, 'requirement', true)}
              onAddSatisfy={(requirement) => openAddSatisfy(requirement)}
              onDelete={openDeleteElement}
              onShowInSource={handleShowInSource}
            />
          ) : (
            <SourceView
              key={`${PROJECT_ID}:${file.name}`}
              file={file}
              jumpLine={jumpLine}
              jumpNonce={jumpNonce}
              saving={saving}
              onSave={handleSaveSource}
              onValidate={handleValidate}
              onDirtyChange={setSourceDirty}
              onOpenHistory={() => setModal({ type: 'history' })}
              onDownload={handleDownload}
            />
          )}
        </main>

        {selectedElement && (
          <Inspector
            model={file!.model}
            element={selectedElement}
            onClose={() => setSelectedId(null)}
            onPatch={handlePatch}
            onDelete={openDeleteElement}
            onShowInSource={handleShowInSource}
            onSelect={setSelectedId}
          />
        )}
      </div>

      <footer className="statusbar">
        <span>{file?.name ?? 'No model'}</span>
        <span className="sep" />
        <span>{plural(elementCount, 'element')}</span>
        <span>{plural(connectionCount, 'connection')}</span>
        <span>{plural(reqCount, 'requirement')}</span>
        <span className="sep" />
        <span className={errors ? 'bad' : warnings ? '' : 'ok'}>
          {errors
            ? `${plural(errors, 'error')}`
            : warnings
              ? `${plural(warnings, 'warning')}`
              : 'model clean'}
        </span>
        <span className="spacer" />
        {file && <span className="mono">rev {file.revision.slice(0, 8)}</span>}
        <span className="sep" />
        <span>SysML v2 · textual notation</span>
      </footer>

      {dragActive && (
        <div className="drop-overlay">
          <div className="drop-card">
            <Upload size={34} />
            <div style={{ fontWeight: 650, fontSize: 16 }}>Drop .sysml files to import</div>
            <div style={{ fontSize: 12, color: 'var(--text-dim)' }}>
              They will be added to the selected project and opened in SkyView.
            </div>
          </div>
        </div>
      )}

      <CommandPalette open={paletteOpen} commands={commands} onClose={() => setPaletteOpen(false)} />
      <Toasts
        toasts={toasts}
        onDismiss={(id) => setToasts((current) => current.filter((t) => t.id !== id))}
      />

      {modal?.type === 'new-file' && (
        <NewFileModal onClose={() => setModal(null)} onCreate={handleCreateFile} />
      )}
      {modal?.type === 'import' && (
        <ImportModal
          initialFiles={modal.files}
          onClose={() => setModal(null)}
          onImported={handleImported}
        />
      )}
      {modal?.type === 'add-element' && file && (
        <AddElementModal
          model={file.model}
          defaultParent={modal.parent}
          defaultKind={modal.kind}
          defaultIsDef={modal.isDef}
          onClose={() => setModal(null)}
          onCreate={handleAddElement}
        />
      )}
      {modal?.type === 'add-connection' && file && (
        <AddConnectionModal
          model={file.model}
          defaultParent={modal.parent}
          onClose={() => setModal(null)}
          onCreate={handleAddConnection}
        />
      )}
      {modal?.type === 'add-satisfy' && file && (
        <AddSatisfyModal
          model={file.model}
          defaultRequirement={modal.requirement}
          defaultParent={modal.parent}
          onClose={() => setModal(null)}
          onCreate={handleAddSatisfy}
        />
      )}
      {modal?.type === 'confirm-delete-element' && (
        <ConfirmModal
          title="Delete element"
          message={`Delete “${modal.name}”? Its nested elements and any links that reference it will be left dangling and reported as diagnostics.`}
          confirmLabel="Delete element"
          onClose={() => setModal(null)}
          onConfirm={() => confirmDeleteElement(modal.id)}
        />
      )}
      {modal?.type === 'confirm-delete-file' && (
        <ConfirmModal
          title="Delete model file"
          message={`Delete “${modal.name}”? The file, its saved layouts and its version history will be removed. This cannot be undone.`}
          confirmLabel="Delete file"
          onClose={() => setModal(null)}
          onConfirm={confirmDeleteFile}
        />
      )}
      {modal?.type === 'confirm-open-file' && (
        <ConfirmModal
          title="Discard source edits?"
          message={`You have unsaved changes in the source editor. Open “${modal.name}” anyway?`}
          confirmLabel="Discard and open"
          danger={false}
          onClose={() => setModal(null)}
          onConfirm={async () => {
            setSourceDirty(false)
            await loadFile(modal.name)
          }}
        />
      )}
      {modal?.type === 'history' && file && (
        <HistoryModal
          fileName={file.name}
          onClose={() => setModal(null)}
          onRestore={handleRestore}
        />
      )}
      {modal?.type === 'help' && <HelpModal onClose={() => setModal(null)} />}
    </div>
  )
}
