import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Upload, GitBranch, Download, Boxes, FolderInput } from 'lucide-react'
import { PROJECT_ID, WORKSPACE_ID } from '../api'
import { createProject, createWorkspace, importRepository, moveProject, projectRequest, uploadProject, type ExampleInfo, type ProjectInfo, type WorkspaceInfo } from '../projects'
import Modal from './Modal'
import { ConfirmModal } from './modals'
import ActionMenu from './ActionMenu'
import './ProjectBar.css'

type Mode = 'examples' | 'new' | 'upload' | 'git'
type Selection = { workspaceId: string; projectId?: string }
const defaultWorkspace: WorkspaceInfo = { id: 'default', name: 'Default workspace' }
const projectWorkspace = (project: ProjectInfo) => project.workspaceId || defaultWorkspace.id

export default function ProjectBar({ sourceDirty, saving, workspaceHost }: { sourceDirty: boolean; saving: boolean; workspaceHost?: HTMLElement | null }) {
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([defaultWorkspace])
  const [catalogReady, setCatalogReady] = useState(false)
  const [workspaceDialog, setWorkspaceDialog] = useState<'create' | 'move' | null>(null)
  const [workspaceName, setWorkspaceName] = useState('')
  const [destination, setDestination] = useState('')
  const [examples, setExamples] = useState<ExampleInfo[]>([])
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<Mode>('examples')
  const [name, setName] = useState('')
  const [repository, setRepository] = useState('')
  const [ref, setRef] = useState('HEAD')
  const [directory, setDirectory] = useState('.')
  const [archive, setArchive] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<Selection | null>(null)
  const close = useCallback(() => { if (!busy) setOpen(false) }, [busy])

  useEffect(() => {
    let active = true
    Promise.all([
      projectRequest<{ projects: ProjectInfo[]; workspaces?: WorkspaceInfo[] }>('projects'),
      projectRequest<{ examples: ExampleInfo[] }>('examples'),
    ]).then(([catalog, library]) => {
      if (!active) return
      setProjects(catalog.projects)
      setWorkspaces(catalog.workspaces ?? [defaultWorkspace])
      setExamples(library.examples)
      setCatalogReady(true)
    }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [])

  const current = projects.find(p => p.id === PROJECT_ID)
  const workspaceId = current ? projectWorkspace(current) : WORKSPACE_ID || defaultWorkspace.id
  const activeWorkspace = workspaces.find(workspace => workspace.id === workspaceId)
  const workspaceProjects = projects.filter(project => projectWorkspace(project) === workspaceId)
  const projectDestination = workspaceId === defaultWorkspace.id ? undefined : workspaceId
  const canMove = current && !['legacy', 'local'].includes(current.origin.kind) && workspaces.length > 1
  const navigate = ({ workspaceId, projectId }: Selection) => {
    // Each page keeps its original project-scoped API base until navigation.
    const url = new URL(location.href)
    url.search = ''
    url.hash = ''
    url.searchParams.set('workspace', workspaceId)
    if (projectId) url.searchParams.set('project', projectId)
    location.assign(url)
  }
  const switchTo = (selection: Selection) => {
    if (sourceDirty) setPending(selection)
    else navigate(selection)
  }
  const switchWorkspace = (id: string) => {
    if (id === workspaceId || busy || saving) return
    const preferred = projects.find(project => projectWorkspace(project) === id)
    switchTo({ workspaceId: id, projectId: preferred?.id })
  }
  const switchProject = (id: string) => {
    if (!id || id === PROJECT_ID || busy || saving) return
    switchTo({ workspaceId, projectId: id })
  }
  const run = async (action: () => Promise<ProjectInfo>) => {
    setBusy(true); setError('')
    try {
      const project = await action()
      setProjects(current => [...current, project])
      switchTo({ workspaceId: projectWorkspace(project), projectId: project.id })
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const openWorkspaceDialog = (mode: 'create' | 'move') => {
    setError('')
    setWorkspaceName('')
    setDestination(workspaces.find(workspace => workspace.id !== workspaceId)?.id ?? '')
    setWorkspaceDialog(mode)
  }
  const submitWorkspace = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      if (workspaceDialog === 'create') {
        const workspace = await createWorkspace(workspaceName)
        setWorkspaces(current => [...current, workspace])
        setWorkspaceDialog(null)
        switchTo({ workspaceId: workspace.id })
      } else if (current && destination) {
        const moved = await moveProject(current.id, destination)
        setProjects(projects => projects.map(project => project.id === moved.id ? moved : project))
        const url = new URL(location.href)
        url.searchParams.set('workspace', projectWorkspace(moved))
        window.history.replaceState(null, '', url)
        setWorkspaceDialog(null)
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const exportSaved = async () => {
    setBusy(true); setError('')
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(PROJECT_ID)}/export`)
      if (!response.ok) {
        const detail = await response.json()
        throw new Error(detail.error || 'Project export failed')
      }
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url; link.download = `${PROJECT_ID}.zip`
      document.body.appendChild(link); link.click(); link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (mode === 'new') void run(() => createProject(name, undefined, projectDestination))
    if (mode === 'git') void run(() => importRepository(name, repository, ref, directory, projectDestination))
    if (mode === 'upload' && archive) void run(() => uploadProject(name, archive, directory, projectDestination))
  }

  return <>
    {workspaceHost && createPortal(<div className="workspace-picker">
      <label htmlFor="active-workspace">Workspace</label>
      <select id="active-workspace" className="input" value={workspaceId} disabled={!catalogReady || busy || saving} onChange={e => switchWorkspace(e.target.value)}>
        {!activeWorkspace && <option value={workspaceId}>{catalogReady ? 'Unavailable workspace' : 'Loading workspaces…'}</option>}
        {workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
      </select>
    </div>, workspaceHost)}
    <div className="project-bar">
      <label className="pane-heading" htmlFor="active-project">Project</label>
      <div className="project-picker-row">
      <select id="active-project" className="input" value={PROJECT_ID} disabled={!catalogReady || busy || saving || !workspaceProjects.length} onChange={e => switchProject(e.target.value)}>
        {!current && <option value={PROJECT_ID}>{!catalogReady ? 'Loading projects…' : PROJECT_ID ? 'Unavailable project' : workspaceProjects.length ? 'Choose a project' : 'No projects yet'}</option>}
        {workspaceProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
        <ActionMenu label="Workspace and project actions" iconOnly>
          <button disabled={!catalogReady || busy || saving} onClick={() => openWorkspaceDialog('create')}>
            <Plus size={14} /> New workspace
          </button>
          <button disabled={!current || busy || saving} onClick={() => void exportSaved()}>
            <Download size={14} /> Export project
          </button>
          {canMove && <button disabled={busy || saving} onClick={() => openWorkspaceDialog('move')}>
            <FolderInput size={14} /> Move project
          </button>}
        </ActionMenu>
      </div>
      <button className="project-add" disabled={!activeWorkspace || busy || saving || !catalogReady}
        onClick={() => { setError(''); setOpen(true) }}><Plus size={14} /> Add project</button>
      {current?.origin.kind === 'git' && <span className="project-origin" title={`${current.origin.repository} · ${current.origin.commit}`}>
        <GitBranch size={13} /> {current.origin.ref} · {current.origin.commit?.slice(0, 8)} · {current.origin.directory}
      </span>}
      {current?.origin.kind === 'local' && <span className="project-origin">Server folder · edits saved directly</span>}
      {error && !open && !workspaceDialog && <span role="alert" className="form-error">{error}</span>}
    </div>
    {open && <Modal title="Add project" subtitle={`Add a project to ${activeWorkspace?.name ?? workspaceId}.`} wide onClose={close}>
      <div className="project-tabs" role="tablist" aria-label="Add a project">
        {([['examples', Boxes, 'Examples'], ['new', Plus, 'New project'], ['upload', Upload, 'Upload ZIP'], ['git', GitBranch, 'Git snapshot']] as const).map(([value, Icon, title]) =>
          <button type="button" role="tab" aria-selected={mode === value} className={`btn ${mode === value ? 'btn-primary' : ''}`} key={value} disabled={busy} onClick={() => { setMode(value); setError('') }}><Icon size={14} /> {title}</button>)}
      </div>
      {mode === 'examples' ? <div className="project-examples">
        <p className="form-hint">Start an editable copy. The bundled example stays available for your next experiment.</p>
        {examples.map(example => <div className="project-example" key={example.id}>
          <div><strong>{example.name}</strong>{example.description && <p>{example.description}</p>}</div>
          <button className="btn" disabled={busy} onClick={() => void run(() => createProject(example.name, example.id, projectDestination))}>Use example</button>
        </div>)}
      </div> : <form className="project-form" onSubmit={submit}>
        <label className="field"><span className="field-label">Project name{mode === 'upload' ? ' (optional for exported projects)' : ''}</span>
          <input className="input" value={name} maxLength={120} required={mode !== 'upload'} disabled={busy} onChange={e => setName(e.target.value)} placeholder="My project" /></label>
        {mode === 'upload' && <label className="field"><span className="field-label">ZIP archive</span>
          <input className="input" type="file" accept=".zip,application/zip" required disabled={busy} onChange={e => setArchive(e.target.files?.[0] || null)} />
          <span className="form-hint">Up to 64 MiB total, 16 MiB per file. Include at least one .sysml model. Relative paths, assets and saved views are kept.</span></label>}
        {mode === 'git' && <>
          <label className="field"><span className="field-label">Public repository URL</span><input className="input" type="url" required value={repository} disabled={busy} onChange={e => setRepository(e.target.value)} placeholder="https://github.com/owner/repository" /></label>
          <label className="field"><span className="field-label">Branch, tag or commit</span><input className="input" required value={ref} disabled={busy} onChange={e => setRef(e.target.value)} /></label>
          <p className="form-hint">Public GitHub.com and GitLab.com repositories. HEAD selects the default branch. Imports are independent snapshots; export your edits for review. Private or self-hosted repositories can be uploaded as ZIP files.</p>
        </>}
        {(mode === 'upload' || mode === 'git') && <label className="field"><span className="field-label">Directory inside {mode === 'git' ? 'repository' : 'archive'}</span>
          <input className="input" value={directory} disabled={busy} onChange={e => setDirectory(e.target.value)} placeholder="." />
          <span className="form-hint">Use . for the root or a path such as models/drone. A single enclosing ZIP folder is removed before this selection.</span></label>}
        <button className="btn btn-primary" disabled={busy || saving} type="submit">{busy ? 'Preparing project…' : mode === 'new' ? 'Create project' : 'Import project'}</button>
      </form>}
      {busy && mode === 'examples' && <p role="status">Preparing project…</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      <p className="form-hint project-local-note">Server folders and existing Git checkouts can also be made available by the person running SkyView.</p>
    </Modal>}
    {workspaceDialog && <Modal title={workspaceDialog === 'create' ? 'New workspace' : 'Move project'} onClose={() => { if (!busy) setWorkspaceDialog(null) }}>
      <form className="project-form" onSubmit={event => void submitWorkspace(event)}>
        {workspaceDialog === 'create' ? <label className="field">
          <span className="field-label">Workspace name</span>
          <input className="input" required maxLength={120} disabled={busy} value={workspaceName} onChange={event => setWorkspaceName(event.target.value)} />
        </label> : <label className="field">
          <span className="field-label">Move {current?.name} to</span>
          <select className="input" required disabled={busy} value={destination} onChange={event => setDestination(event.target.value)}>
            {workspaces.filter(workspace => workspace.id !== workspaceId).map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
        </label>}
        {error && <p role="alert" className="form-error">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy || saving}>{workspaceDialog === 'create' ? 'Create workspace' : 'Move project'}</button>
      </form>
    </Modal>}
    {pending && <ConfirmModal title="Discard unsaved changes?" message="Switching will discard the unsaved changes in the current project." confirmLabel="Discard and switch" danger={false} onClose={() => setPending(null)} onConfirm={async () => navigate(pending)} />}
  </>
}
