import ProjectBar from './components/ProjectBar'
import StandardsVersion, { type StandardsIdentity } from './components/StandardsVersion'
import BuildStatus from './components/BuildStatus'
import { useAbout } from './about'
import { PROJECT_ID, getProjectPalette, type ProjectPalette } from './api'
import KeywordPalette from './components/KeywordPalette'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  CheckCheck,
  CircleAlert,
  CircleCheck,
  CircleHelp,
  Code2,
  Command,
  Download,
  FileCode2,
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
  TriangleAlert,
  Columns2,
  Undo2,
  Upload,
  X,
} from 'lucide-react'
import {
  addConnection,
  addPortConnection,
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
  validateNativeFile,
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
  diagramScopes,
  displayName,
  isContainer,
  kindColor,
  plural,
  requirementCount,
  safeImportName,
} from './utils'
import Header from './components/Header'
import BrandMark from './components/BrandMark'
import ActionMenu from './components/ActionMenu'
import WorkbenchSidebar, { type NavigatorPanel, type SettingsPage } from './components/WorkbenchSidebar'
import { useModelViews, type ModelViews } from './modelViews'
import { diagramDestinations, diagramTabKey, discardLayouts, layoutDirty, type DiagramTab, type LayoutDraft } from './diagramTabs'
import type { SharedView, ViewConfig } from './sharedViews'
import type { CustomViewActions } from './components/CustomViews'
import GridEditor from './components/GridEditor'
import DiagramView from './components/DiagramView'
import type { AddDiagramConnection } from './diagramConnections'
import RequirementsView from './components/RequirementsView'
import SourceView from './components/SourceView'
import ModelPanes from './components/ModelPanes'
import DiagramWorkspace from './components/DiagramWorkspace'
import DiagramTabs from './components/DiagramTabs'
import Modal from './components/Modal'
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
const sidebarStorageKey = 'skyview-sidebar-visible'
const useMacShortcut = /Mac|iPhone|iPad|iPod/.test(navigator.platform)
const showsSource = (tab: Tab) => tab === 'source' || tab === 'split'
const showsDiagram = (tab: Tab) => tab === 'diagram' || tab === 'split'
const draftNames = (source: boolean, view: boolean) => source && view ? 'source and diagram changes'
  : source ? 'source edits' : 'diagram changes'

type ModalState =
  | { type: 'new-file' }
  | { type: 'add-element'; parent?: string; kind?: string; isDef?: boolean }
  | { type: 'add-connection'; parent?: string }
  | { type: 'add-satisfy'; requirement?: string; parent?: string }
  | { type: 'confirm-delete-element'; id: string; name: string }
  | { type: 'confirm-delete-file'; name: string }
  | { type: 'confirm-open-file'; name: string; view: string | null; element?: string; newTab: boolean; edits: string }
  | { type: 'choose-part-diagram'; name: string; diagrams: SharedView[] }
  | { type: 'import'; files?: ImportFile[] }
  | { type: 'history' }
  | { type: 'help' }
  | null

function requirementsCount(file: FileResponse | null): number {
  return file ? requirementCount(file.model) : 0
}

export default function App() {
  const { about, unavailable: aboutUnavailable } = useAbout()
  const [standards, setStandards] = useState<StandardsIdentity | null>(null)
  const [files, setFiles] = useState<FileInfo[]>([])
  const [file, setFile] = useState<FileResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setActiveTab] = useState<Tab>('diagram')
  const [sidebarTab, setSidebarTab] = useState<NavigatorPanel>('projects')
  const [sidebarVisible, setSidebarVisible] = useState(() => localStorage.getItem(sidebarStorageKey) !== 'false')
  useEffect(() => {
    localStorage.setItem(sidebarStorageKey, String(sidebarVisible))
  }, [sidebarVisible])
  const toggleSidebar = useCallback(() => {
    if (document.getElementById('workbench-sidebar')?.contains(document.activeElement)) {
      document.getElementById('sidebar-toggle')?.focus()
    }
    setSidebarVisible(visible => !visible)
  }, [])
  const [settingsPage, setSettingsPage] = useState<SettingsPage>('colours')
  const [diagramView, setDiagramView] = useState<string | null>(() => new URLSearchParams(location.search).get('view'))
  const [scopeRequest, setScopeRequest] = useState<{ element: string }>()
  const [openDiagrams, setOpenDiagrams] = useState<DiagramTab[]>([])
  const [activeDiagram, setActiveDiagram] = useState<string | null>(null)
  const [diagramVisible, setDiagramVisible] = useState(false)
  const currentDiagramKey = diagramVisible && file ? diagramTabKey(file.name, diagramView, scopeRequest?.element) : null
  const openDiagramsRef = useRef(openDiagrams)
  openDiagramsRef.current = openDiagrams
  const [layoutDrafts, setLayoutDrafts] = useState<Record<string, LayoutDraft>>({})
  const [layoutSaving, setLayoutSaving] = useState(false)
  const modelViews = useModelViews(file?.name)
  const currentLayout = file ? layoutDrafts[file.name] : undefined
  const diagramChoices = currentLayout?.config.views ?? modelViews.data?.config.views
  useEffect(() => {
    if (!file || !diagramChoices) return
    const titles = new Map(diagramChoices.map(view => [view.id, view.title]))
    setOpenDiagrams(tabs => {
      let changed = false
      const next = tabs.map(item => {
        const title = item.file === file.name && item.view ? titles.get(item.view) : undefined
        if (!title || title === item.title) return item
        changed = true
        return { ...item, title }
      })
      return changed ? next : tabs
    })
  }, [file?.name, diagramChoices, openDiagrams])
  const updateLayouts = (update: (config: ViewConfig) => ViewConfig) => {
    if (!file || !modelViews.data) return
    const { name } = file
    const catalog = modelViews.data
    setLayoutDrafts(drafts => {
      const base = drafts[name]?.base ?? catalog
      const config = update(drafts[name]?.config ?? base.config)
      const next = { ...drafts }
      if (JSON.stringify(config) === JSON.stringify(base.config)) delete next[name]
      else next[name] = { base, config }
      return next
    })
  }
  const acceptLayouts = (name: string, saved: ModelViews) => {
    modelViews.publish(name, saved)
    setLayoutDrafts(drafts => {
      const draft = drafts[name]
      if (!draft) return drafts
      const next = { ...drafts }
      if (draft.config === saved.config || JSON.stringify(draft.config) === JSON.stringify(saved.config)) delete next[name]
      else next[name] = { base: saved, config: draft.config }
      return next
    })
  }
  const currentFile = useRef(file)
  currentFile.current = file
  const openSequence = useRef(0)
  const chooseDiagramView = useCallback((view: string | null, name = currentFile.current?.name,
    { scope, title, replaceKey, visible = true, newTab = false }: {
      scope?: string; title?: string; replaceKey?: string; visible?: boolean; newTab?: boolean
    } = {}) => {
    const key = name && visible ? diagramTabKey(name, view, scope) : null
    const promoted = newTab || openDiagramsRef.current.some(item => item.key === key || item.key === replaceKey)
    setDiagramView(view)
    setDiagramVisible(Boolean(key))
    setScopeRequest(scope ? { element: scope } : undefined)
    setActiveDiagram(promoted ? key : null)
    if (key && name && promoted) setOpenDiagrams(tabs => {
      const unclosed = replaceKey ? tabs.filter(item => item.key !== replaceKey || item.key === key) : tabs
      if (unclosed.some(item => item.key === key)) return unclosed
      const label = title || (view === '' ? 'New saved view' : view || `${name.split('/').at(-1)?.replace(/\.sysml$/i, '')} diagram`)
      const inserted = { key, file: name, view, scope, title: label }
      const replaceIndex = replaceKey ? tabs.findIndex(item => item.key === replaceKey) : -1
      const index = replaceIndex >= 0 ? replaceIndex : unclosed.length
      return [...unclosed.slice(0, index), inserted, ...unclosed.slice(index)]
    })
    const page = new URL(location.href)
    if (name) page.searchParams.set('file', name)
    else page.searchParams.delete('file')
    if (view) page.searchParams.set('view', view)
    else page.searchParams.delete('view')
    if (scope) page.searchParams.set('scope', scope)
    else page.searchParams.delete('scope')
    history.replaceState(null, '', page)
  }, [])
  const [settingsHost, setSettingsHost] = useState<HTMLDivElement | null>(null)
  const [workspaceHost, setWorkspaceHost] = useState<HTMLDivElement | null>(null)
  const [palette, setPalette] = useState<ProjectPalette | null>(null)
  const [paletteError, setPaletteError] = useState('')
  const [paletteDirty, setPaletteDirty] = useState(false)
  useEffect(() => {
    if (!PROJECT_ID) return
    let active = true
    getProjectPalette().then(value => { if (active) setPalette(value) })
      .catch(error => { if (active) setPaletteError(String(error.message ?? error)) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!paletteDirty) return
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [paletteDirty])
  const paletteVariables = useMemo(() => Object.fromEntries(palette?.keywords.map(
    entry => [`--keyword-${entry.keyword.replaceAll(' ', '-')}`, entry.stroke],
  ) ?? []) as CSSProperties, [palette])
  const [customActions, setCustomActions] = useState<CustomViewActions | null>(null)
  const openViewSettings = useCallback(() => {
    setSettingsPage('layout')
    setSidebarTab('settings')
    setSidebarVisible(true)
  }, [])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [sourceFocus, setSourceFocus] = useState<{ id: string } | null>(null)
  const selectElement = useCallback((id: string | null) => {
    setSelectedId(id)
    setSourceFocus(id ? { id } : null)
  }, [])
  const selectFromSource = useCallback((id: string | null) => {
    setSelectedId(id)
    setSourceFocus(null)
  }, [])
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem('skyview-workbench-theme')
    return saved === 'dark' ? 'dark' : 'light'
  })
  const [saving, setSaving] = useState(false)
  const [sourceDirty, setSourceDirty] = useState(false)
  const viewDirty = Object.keys(layoutDrafts).length > 0
  const activeDraft = useRef({ tab, sourceDirty, viewDirty, saving: saving || layoutSaving })
  activeDraft.current = { tab, sourceDirty, viewDirty, saving: saving || layoutSaving }
  useEffect(() => {
    if (!sourceDirty && !viewDirty) return
    const protect = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', protect)
    return () => window.removeEventListener('beforeunload', protect)
  }, [sourceDirty, viewDirty])
  const setTab = useCallback((next: Tab) => {
    const current = activeDraft.current
    if (current.saving && current.tab !== next) return false
    if (current.sourceDirty && !showsSource(next)) {
      if (current.saving || !window.confirm('Discard unsaved source edits?')) return false
      setSourceDirty(false)
    }
    setActiveTab(next)
    return true
  }, [])
  const openPanel = (panel: NavigatorPanel) => {
    if (panel === 'settings') setSettingsPage('colours')
    setSidebarTab(panel)
  }
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

  const loadFile = useCallback(async (name: string, view: string | null = null, element?: string, newTab = false) => {
    const request = ++openSequence.current
    const existing = currentFile.current
    const changingModel = existing?.name !== name
    setLoading(changingModel)
    try {
      const doc = changingModel ? await getFile(name) : existing
      if (request !== openSequence.current) return false
      if (changingModel) {
        setFile(doc)
        setUndoStack([])
        setRedoStack([])
      }
      if (changingModel || element) selectElement(element ?? null)
      setJumpLine(null)
      const current = activeDraft.current
      if (changingModel || current.tab !== 'split') setSourceDirty(false)
      const scope = view === null ? element : undefined
      chooseDiagramView(view, name, { scope, title: scope && doc ? displayName(byId(doc.model, scope)) : undefined, newTab })
      if (current.tab !== 'split') setActiveTab('diagram')
      return true
    } catch (err) {
      if (request === openSequence.current) pushToast('error', err instanceof Error ? err.message : String(err))
      return false
    } finally {
      if (request === openSequence.current) setLoading(false)
    }
  }, [chooseDiagramView, pushToast, selectElement])

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
          if (!cancelled) {
            setFile(doc)
            const route = new URLSearchParams(location.search)
            const view = route.get('view')
            const scope = !view ? route.get('scope') ?? undefined : undefined
            chooseDiagramView(view, doc.name, { scope, title: scope ? displayName(byId(doc.model, scope)) : undefined })
          }
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
  }, [chooseDiagramView, pushToast])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('skyview-workbench-theme', theme)
  }, [theme])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const sidebarModifier = useMacShortcut ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey
      if (sidebarModifier && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'b') {
        if (document.querySelector('[aria-modal="true"]')) return
        e.preventDefault()
        if (!e.repeat) toggleSidebar()
        return
      }
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
  }, [setTab, toggleSidebar])

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

  const requestOpenFile = useCallback((name: string, view: string | null = null, element?: string, newTab = false) => {
    const sameFile = name === file?.name
    const key = diagramTabKey(name, view, view === null ? element : undefined)
    if (sameFile && key === currentDiagramKey && (!newTab || activeDiagram === key) && showsDiagram(tab) && !loading) return
    if (saving || layoutSaving) return
    if (sourceDirty && (!sameFile || tab !== 'split')) {
      setModal({ type: 'confirm-open-file', name, view, element, newTab, edits: 'source edits' })
      return
    }
    void loadFile(name, view, element, newTab)
  }, [file?.name, currentDiagramKey, activeDiagram, tab, loading, saving, layoutSaving, sourceDirty, loadFile])

  const openElementDiagram = (id: string) => {
    if (!file) return
    const element = byId(file.model, id)
    if (!element || !['part', 'package'].includes(element.kind)) return
    const related = diagramDestinations(file.model, diagramChoices ?? [], id)
    const choices = related.filter(view => diagramTabKey(file.name, view.id) !== currentDiagramKey)
    if (choices.length > 1) setModal({ type: 'choose-part-diagram', name: file.name, diagrams: choices })
    else if (choices[0]) requestOpenFile(file.name, choices[0].id, undefined, true)
    else if (!related.length) {
      const scopes = new Set(diagramScopes(file.model).map(item => item.id))
      const scope = [id, element.typeId, element.specializesId].find(candidate => candidate && scopes.has(candidate)) ?? id
      if (diagramTabKey(file.name, null, scope) !== currentDiagramKey) requestOpenFile(file.name, null, scope, true)
    }
  }

  const closeDiagrams = async (keys: string[]) => {
    if (saving || layoutSaving || loading) return
    const closing = new Set(keys)
    const remaining = openDiagrams.filter(item => !closing.has(item.key))
    const removed = openDiagrams.filter(item => closing.has(item.key))
    const closingActive = activeDiagram !== null && closing.has(activeDiagram)
    const previousIndex = openDiagrams.findIndex(item => item.key === activeDiagram)
    const next = closingActive ? remaining[Math.min(Math.max(0, previousIndex - 1), remaining.length - 1)] : undefined
    const sourceWillClose = !!next && next.file !== file?.name && sourceDirty
    const discardsView = removed.some(item => layoutDirty(layoutDrafts[item.file], item.view))
    if ((sourceWillClose || discardsView) && !window.confirm('Discard unsaved ' + draftNames(sourceWillClose, discardsView) + '?')) return
    if (next && !await loadFile(next.file, next.view, next.scope)) return
    if (closingActive && !next) chooseDiagramView(null, file?.name, { visible: false })
    setOpenDiagrams(tabs => tabs.filter(item => !closing.has(item.key)))
    setLayoutDrafts(drafts => {
      const left = { ...drafts }
      for (const name of new Set(removed.map(item => item.file))) {
        const draft = left[name]
        if (!draft) continue
        const ids = new Set(removed.filter(item => item.file === name && item.view).map(item => item.view as string))
        if (!ids.size) continue
        const config = discardLayouts(draft.config, draft.base.config, ids)
        if (JSON.stringify(config) === JSON.stringify(draft.base.config)) delete left[name]
        else left[name] = { ...draft, config }
      }
      return left
    })
  }

  const sourceBusy = useCallback(() => {
    if (!activeDraft.current.sourceDirty && !activeDraft.current.saving) return false
    pushToast('info', 'Save or revert the source draft before changing the saved model.')
    return true
  }, [pushToast])

  const handleCreateFile = useCallback(
    async (name: string) => {
      if (activeDraft.current.sourceDirty || activeDraft.current.viewDirty || activeDraft.current.saving) {
        throw new Error('Save or revert the current drafts before opening a new model.')
      }
      const resp = await createFile(name)
      setFile(resp)
      selectElement(null)
      setSourceDirty(false)
      setUndoStack([])
      setRedoStack([])
      chooseDiagramView(null, resp.name)
      setActiveTab('diagram')
      setSidebarTab('projects')
      await refreshFiles()
      pushToast('success', `Created ${name}`)
    },
    [chooseDiagramView, pushToast, refreshFiles, selectElement],
  )

  const confirmDeleteFile = useCallback(async () => {
    if (!file) return
    await deleteFile(file.name)
    setOpenDiagrams(tabs => tabs.filter(item => item.file !== file.name))
    setLayoutDrafts(drafts => { const next = { ...drafts }; delete next[file.name]; return next })
    const fs = await listFiles()
    setFiles(fs)
    if (fs.length > 0) {
      await loadFile(fs[0].name)
    } else {
      setFile(null)
      setSelectedId(null)
      setSourceDirty(false)
      setUndoStack([])
      setRedoStack([])
      chooseDiagramView(null, '')
    }
    pushToast('success', `Deleted ${file.name}`)
  }, [file, pushToast, chooseDiagramView, loadFile])

  const handlePatch = useCallback(
    async (id: string, patch: ElementPatch) => {
      if (!file || sourceBusy()) return false
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
        return true
      } catch (err) {
        pushToast('error', err instanceof Error ? err.message : String(err))
        return false
      }
    },
    [file, selectedId, pushToast, refreshFiles, recordUndo, sourceBusy],
  )

  const handleAddElement = useCallback(
    async (el: NewElement) => {
      if (!file) return
      if (activeDraft.current.sourceDirty || activeDraft.current.saving) {
        throw new Error('Save or revert the source draft before changing the saved model.')
      }
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
      if (activeDraft.current.sourceDirty || activeDraft.current.saving) {
        throw new Error('Save or revert the source draft before changing the saved model.')
      }
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

  const pendingConnection = useRef(false)
  const connectFromDiagram = useCallback<AddDiagramConnection>(async connection => {
    if (pendingConnection.current || sourceBusy()) return
    const before = currentFile.current
    if (!before) return
    pendingConnection.current = true
    setSaving(true)
    try {
      const result = await addPortConnection(before.name, before.revision, connection)
      recordUndo(before.content, selectedId)
      setFile(result)
      const created = byId(result.model, result.addedElementId)
      if (created) selectElement(created.id)
      void refreshFiles()
      pushToast('success', 'Connection saved in SysML')
      return created
    } catch (error) {
      pushToast('error', error instanceof Error ? error.message : String(error))
    } finally {
      pendingConnection.current = false
      setSaving(false)
    }
  }, [sourceBusy, recordUndo, selectedId, selectElement, refreshFiles, pushToast])

  const handleAddSatisfy = useCallback(
    async (link: NewSatisfy) => {
      if (!file) return
      if (activeDraft.current.sourceDirty || activeDraft.current.saving) {
        throw new Error('Save or revert the source draft before changing the saved model.')
      }
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
      if (activeDraft.current.sourceDirty || activeDraft.current.saving) {
        throw new Error('Save or revert the source draft before changing the saved model.')
      }
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
      if (activeDraft.current.sourceDirty || activeDraft.current.saving) {
        throw new Error('Save or revert the source draft before changing the saved model.')
      }
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
    if (!file || sourceBusy()) return
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
  }, [file, selectedId, undoStack, pushToast, refreshFiles, sourceBusy])

  const redo = useCallback(async () => {
    if (!file || sourceBusy()) return
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
  }, [file, selectedId, redoStack, pushToast, refreshFiles, sourceBusy])

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
    if (activeDraft.current.sourceDirty) {
      pushToast('info', 'Save or revert the source draft to locate saved declarations.')
      return
    }
    if (!showsSource(activeDraft.current.tab) && !setTab('source')) return
    setJumpLine(line)
    setJumpNonce((n) => n + 1)
  }, [pushToast, setTab])

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
      requestOpenFile(name)
      pushToast('success', `Imported ${name}`)
    },
    [requestOpenFile, pushToast, refreshFiles],
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
    if (!PROJECT_ID) return list.filter(command => command.group === 'View')
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
      style={paletteVariables}
      onDragEnter={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        if (!PROJECT_ID) return
        dragDepth.current++
        setDragActive(true)
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.dataTransfer.dropEffect = PROJECT_ID ? 'copy' : 'none'
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
        if (PROJECT_ID) void readDroppedFiles(e.dataTransfer.files)
      }}
    >
      <Header
        sidebarVisible={sidebarVisible}
        sidebarShortcut={useMacShortcut ? 'Meta+B' : 'Control+B'}
        onToggleSidebar={toggleSidebar}
        workspaceHost={setWorkspaceHost}
        account={about?.account}
        saving={saving || layoutSaving}
        sourceDirty={sourceDirty || viewDirty || paletteDirty}
        theme={theme}
        diagnostics={file?.diagnostics ?? []}
        onToggleTheme={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
        onOpenPalette={() => setPaletteOpen(true)}
        onOpenHelp={() => setModal({ type: 'help' })}
        onShowDiagnostics={() => {
          if (!showsSource(tab) && !setTab('source')) return
          const first = file?.diagnostics[0]
          if (first && !sourceDirty) {
            setJumpLine(first.line)
            setJumpNonce((n) => n + 1)
          }
        }}
      />

      <div className="shell">
        <WorkbenchSidebar
          hidden={!sidebarVisible} canDragElements={showsDiagram(tab)} panel={sidebarTab} onPanel={openPanel}
          view={diagramView} catalog={modelViews.data} catalogError={modelViews.error}
          settingsPage={settingsPage} onSettingsPage={setSettingsPage}
          files={files} file={file} selectedId={selectedId} onSelect={selectElement}
          onOpenFile={requestOpenFile} layoutDrafts={layoutDrafts} settingsHost={setSettingsHost}
          actions={showsDiagram(tab) ? customActions : null}
          colourSettings={palette ? <KeywordPalette palette={palette} onSave={setPalette} onDirtyChange={setPaletteDirty} /> :
            paletteError ? <p className="panel-help" role="alert">{paletteError}</p> :
              PROJECT_ID ? <p className="panel-help">Loading project colours…</p> : null}
          projectBar={<ProjectBar sourceDirty={sourceDirty || viewDirty || paletteDirty} saving={saving || layoutSaving} workspaceHost={workspaceHost} />}
          modelActions={PROJECT_ID && <ActionMenu label="Model actions" iconOnly>
            <button type="button" onClick={() => setModal({ type: 'new-file' })}>New model</button>
            <button type="button" onClick={() => setModal({ type: 'import' })}>Import SysML file</button>
            <button type="button" disabled={!file} onClick={() => setModal({ type: 'history' })}>Version history</button>
            <button type="button" className="menu-destructive" disabled={!file}
              onClick={() => file && setModal({ type: 'confirm-delete-file', name: file.name })}>Delete model</button>
          </ActionMenu>}
          inspector={selectedElement && (
          <Inspector
            model={file!.model}
            element={selectedElement}
            onClose={() => setSelectedId(null)}
            onPatch={handlePatch}
            onDelete={openDeleteElement}
            onShowInSource={handleShowInSource}
            onSelect={selectElement}
          />
        )}
        />

        <main className="main">
          {file && (
            <div className="viewbar">
              <button className={cx('tab', tab === 'diagram' && 'active')} aria-pressed={tab === 'diagram'} onClick={() => setTab('diagram')}>
                <Network size={14} /> Diagram
              </button>
              <button className={cx('tab', tab === 'grid' && 'active')} aria-pressed={tab === 'grid'} onClick={() => setTab('grid')}>
                <LayoutGrid size={14} /> Grid
              </button>
              <button
                className={cx('tab', tab === 'requirements' && 'active')}
                aria-pressed={tab === 'requirements'}
                onClick={() => setTab('requirements')}
              >
                <ListChecks size={14} /> Requirements
              </button>
              <button className={cx('tab', tab === 'source' && 'active')} aria-pressed={tab === 'source'} onClick={() => setTab('source')}>
                <Code2 size={14} /> Source
              </button>
              <button className={cx('tab', tab === 'split' && 'active')} aria-pressed={tab === 'split'} onClick={() => setTab('split')}>
                <Columns2 size={14} /> Split
              </button>
              <div className="viewbar-spacer" />
              <div className="viewbar-actions">
                <button
                  className="icon-button tooltip"
                  data-tip="Undo" aria-label="Undo"
                  onClick={() => void undo()}
                  disabled={undoStack.length === 0 || sourceDirty || saving}
                >
                  <Undo2 size={15} />
                </button>
                <button
                  className="icon-button tooltip"
                  data-tip="Redo" aria-label="Redo"
                  onClick={() => void redo()}
                  disabled={redoStack.length === 0 || sourceDirty || saving}
                >
                  <Redo2 size={15} />
                </button>
              </div>
            </div>
          )}

          {loading && !file ? (
            <div className="loading-screen" role="status">
              <BrandMark className="loading-logo" />
              <div className="loading-message"><Loader2 size={14} className="spin" aria-hidden="true" /> Loading the SysML workspace…</div>
            </div>
          ) : !file ? (
            <div className="empty-state">
              <div className="icon-wrap">
                <FolderOpen size={24} />
              </div>
              <h2>{PROJECT_ID ? 'No model loaded' : 'Choose or add a project'}</h2>
              <p>{PROJECT_ID ? 'Create or import a SysML model in the selected project.' : 'Use the Projects panel to create a project or import an existing one into this workspace.'}</p>
              {PROJECT_ID ? <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-primary" onClick={() => setModal({ type: 'new-file' })}>
                  <FilePlus2 size={13} /> New model
                </button>
                <button className="btn" onClick={() => void refreshFiles()}>Refresh models</button>
              </div> : (!sidebarVisible || sidebarTab !== 'projects') &&
                <button className="btn btn-primary" onClick={() => { setSidebarTab('projects'); setSidebarVisible(true) }}>Show Projects</button>}
            </div>
          ) : tab === 'grid' ? (
            <GridEditor
              model={file.model}
              selectedId={selectedId}
              onSelect={selectElement}
              onPatch={handlePatch}
              onDelete={openDeleteElement}
              onShowInSource={handleShowInSource}
              onAddElement={(parent) => openAddElement(parent)}
              onAddConnection={(parent) => openAddConnection(parent)}
              onAddSatisfy={(requirement) => openAddSatisfy(requirement)}
            />
          ) : tab === 'requirements' ? (
            <RequirementsView
              key={file.name}
              fileName={file.name}
              model={file.model}
              selectedId={selectedId}
              onSelect={selectElement}
              onPatch={handlePatch}
              onAddRequirement={(parent) => openAddElement(parent, 'requirement', true)}
              onAddSatisfy={(requirement) => openAddSatisfy(requirement)}
              onDelete={openDeleteElement}
              onShowInSource={handleShowInSource}
            />
          ) : (
            <ModelPanes
              source={showsSource(tab) && (
                <SourceView
                  key={`${PROJECT_ID}:${file.name}`}
                  file={file}
                  linkedElement={tab === 'split' ? sourceFocus : null}
                  onCaretElement={tab === 'split' ? selectFromSource : undefined}
                  jumpLine={jumpLine}
                  jumpNonce={jumpNonce}
                  saving={saving}
                  onSave={handleSaveSource}
                  onValidate={handleValidate}
                  onNativeValidate={(content) => validateNativeFile(file.name, content)}
                  onDirtyChange={setSourceDirty}
                  onOpenHistory={() => setModal({ type: 'history' })}
                  onDownload={handleDownload}
                />
              )}
              diagram={showsDiagram(tab) && (
                <DiagramWorkspace
                  key={file.name} file={file} view={diagramView} split={tab === 'split'}
                  catalog={modelViews.data} catalogError={modelViews.error} layoutDraft={currentLayout}
                  empty={!diagramVisible}
                  tabs={<DiagramTabs tabs={openDiagrams} active={activeDiagram}
                    dirty={item => layoutDirty(layoutDrafts[item.file], item.view)}
                    onOpen={item => requestOpenFile(item.file, item.view, item.scope)} onClose={keys => void closeDiagrams(keys)} />}
                  onOpen={view => requestOpenFile(file.name, view)}
                  onSelected={(view, title, replace) => chooseDiagramView(view, file.name, { title, replaceKey: replace ? activeDiagram ?? undefined : undefined })}
                  onSaved={catalog => acceptLayouts(file.name, catalog)} onLayoutChange={updateLayouts} onLayoutSaving={setLayoutSaving}
                  paletteRevision={palette?.revision} settingsHost={settingsHost}
                  onOpenSettings={openViewSettings} onActions={setCustomActions} selectedId={selectedId} onSelectElement={selectElement}
                  onAddElement={openAddElement} onOpenElementDiagram={openElementDiagram}
                  onAddConnection={connectFromDiagram} onOpenAddConnection={openAddConnection}>
                  {navigation => <DiagramView key={currentDiagramKey} onNotice={message => pushToast('info', message)} split={tab === 'split'} navigation={navigation} requestedScope={scopeRequest} onOpenElementDiagram={openElementDiagram}
                    paletteRevision={palette?.revision} file={file} selectedId={selectedId} onSelect={selectElement}
                    onAddElement={openAddElement} onAddConnection={connectFromDiagram}
                    onOpenAddConnection={openAddConnection} onShowInSource={handleShowInSource} />}
                </DiagramWorkspace>
              )}
            />
          )}
        </main>


      </div>

      <footer className="statusbar">
        <div className="model-status">
          <span className="status-file" title={file ? `${file.name}\n${plural(elementCount, 'element')} · ${plural(connectionCount, 'connection')} · ${plural(reqCount, 'requirement')}` : undefined}>
            <FileCode2 size={13} aria-hidden="true" /><span>{file?.name.split('/').at(-1) ?? 'No model'}</span>
          </span>
          {file && <span className="status-diagnostics">
            {errors > 0 && <span className="status-error" role="img" aria-label={plural(errors, 'error')} title={plural(errors, 'error')}>
              <CircleAlert size={13} aria-hidden="true" />{errors}
            </span>}
            {warnings > 0 && <span className="status-warning" role="img" aria-label={plural(warnings, 'warning')} title={plural(warnings, 'warning')}>
              <TriangleAlert size={13} aria-hidden="true" />{warnings}
            </span>}
            {!errors && !warnings && <span role="img" aria-label="No projection errors or warnings" title="No projection errors or warnings">
              <CircleCheck size={13} aria-hidden="true" />
            </span>}
          </span>}
        </div>
        <div className="app-status">
          <StandardsVersion onIdentity={setStandards} />
          <BuildStatus about={about} unavailable={aboutUnavailable} standards={standards} modelRevision={file?.revision} />
        </div>
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
      {modal?.type === 'choose-part-diagram' && (
        <Modal title="Open a diagram" onClose={() => setModal(null)}>
          {modal.diagrams.map((view, index) => <button type="button" key={view.id} className={cx('btn', index === 0 && 'primary-focus')}
            onClick={() => { setModal(null); requestOpenFile(modal.name, view.id, undefined, true) }}>{view.title}</button>)}
        </Modal>
      )}
      {modal?.type === 'confirm-open-file' && (
        <ConfirmModal
          title="Discard unsaved changes?"
          message={`Opening this selection will discard unsaved ${modal.edits} in “${file?.name ?? modal.name}”.`}
          confirmLabel="Discard and open"
          danger={false}
          onClose={() => setModal(null)}
          onConfirm={async () => {
            await loadFile(modal.name, modal.view, modal.element, modal.newTab)
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
