import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Plus, Upload, GitBranch, Download, Boxes, Settings2, Trash2 } from 'lucide-react'
import { PROJECT_ID, WORKSPACE_ID } from '../api'
import { createProject, createWorkspace, importRepository, projectRequest, removeProject, removeWorkspace, renameWorkspace, updateProject, uploadProject, type ExampleInfo, type ProjectInfo, type WorkspaceInfo } from '../projects'
import Modal from './Modal'
import { ConfirmModal } from './modals'
import ActionMenu from './ActionMenu'
import './ProjectBar.css'

type Mode = 'examples' | 'new' | 'upload' | 'git'
type Selection = { workspaceId: string; projectId?: string }
const defaultWorkspace: WorkspaceInfo = { id: 'default', name: 'Default workspace' }
const projectWorkspace = (project: ProjectInfo) => project.workspaceId || defaultWorkspace.id

type Dialog = 'addProject' | 'addWorkspace' | 'workspaceSettings' | 'projectSettings'
type CatalogItem = 'workspace' | 'project'

function CatalogControls({ kind, onAdd, addDisabled, menu, children }: {
  kind: CatalogItem
  onAdd: () => void
  addDisabled: boolean
  menu: ReactNode
  children: ReactNode
}) {
  const add = kind === 'workspace' ? 'New workspace' : 'Add project'
  const actions = kind === 'workspace' ? 'Workspace actions' : 'Project actions'
  return <div className="catalog-controls">
    {children}
    <button type="button" className="icon-button tooltip" aria-label={add} data-tip={add}
      disabled={addDisabled} onClick={onAdd}><Plus size={16} /></button>
    <ActionMenu label={actions} iconOnly>{menu}</ActionMenu>
  </div>
}

export default function ProjectBar({ sourceDirty, saving, workspaceHost }: { sourceDirty: boolean; saving: boolean; workspaceHost?: HTMLElement | null }) {
  const [projects, setProjects] = useState<ProjectInfo[]>([])
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([defaultWorkspace])
  const [catalogReady, setCatalogReady] = useState(false)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [removing, setRemoving] = useState<CatalogItem | null>(null)
  const [settingsName, setSettingsName] = useState('')
  const [destination, setDestination] = useState('')
  const [examples, setExamples] = useState<ExampleInfo[]>([])
  const [mode, setMode] = useState<Mode>('examples')
  const [name, setName] = useState('')
  const [repository, setRepository] = useState('')
  const [ref, setRef] = useState('HEAD')
  const [directory, setDirectory] = useState('.')
  const [archive, setArchive] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState<Selection | null>(null)
  const close = useCallback(() => { if (!busy) setDialog(null) }, [busy])

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
  const managedProject = !!current && !['legacy', 'local'].includes(current.origin.kind)
  const canRemoveWorkspace = !!activeWorkspace && workspaceId !== defaultWorkspace.id && !workspaceProjects.length
  const controlsDisabled = !catalogReady || busy || saving
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
  const openDialog = (next: Dialog) => {
    setError('')
    setSettingsName(next === 'workspaceSettings' ? activeWorkspace?.name ?? '' :
      next === 'projectSettings' ? current?.name ?? '' : '')
    setDestination(workspaceId)
    setDialog(next)
  }
  const submitSettings = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || saving) return
    setBusy(true)
    setError('')
    try {
      if (dialog === 'addWorkspace') {
        const workspace = await createWorkspace(settingsName)
        setWorkspaces(list => [...list, workspace])
        switchTo({ workspaceId: workspace.id })
      } else if (dialog === 'workspaceSettings' && activeWorkspace) {
        const workspace = await renameWorkspace(activeWorkspace.id, settingsName)
        setWorkspaces(list => list.map(item => item.id === workspace.id ? workspace : item))
      } else if (dialog === 'projectSettings' && current) {
        const updated = await updateProject(current.id, settingsName, destination)
        setProjects(list => list.map(item => item.id === updated.id ? updated : item))
        const url = new URL(location.href)
        url.searchParams.set('workspace', projectWorkspace(updated))
        window.history.replaceState(null, '', url)
      }
      setDialog(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }
  const removeSelected = async () => {
    if (busy || saving) throw new Error('Wait for the current operation to finish.')
    if (removing === 'workspace' && activeWorkspace) {
      await removeWorkspace(activeWorkspace.id)
      const preferred = projects.find(project => projectWorkspace(project) === defaultWorkspace.id)
      navigate({ workspaceId: defaultWorkspace.id, projectId: preferred?.id })
    } else if (removing === 'project' && current) {
      if (sourceDirty) throw new Error('Save or discard your changes before removing this project.')
      await removeProject(current.id)
      const next = workspaceProjects.find(project => project.id !== current.id)
      navigate({ workspaceId, projectId: next?.id })
    }
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
      <CatalogControls kind="workspace" onAdd={() => openDialog('addWorkspace')} addDisabled={controlsDisabled}
        menu={<>
          <button disabled={controlsDisabled || !activeWorkspace} onClick={() => openDialog('workspaceSettings')}>
            <Settings2 size={14} /> Workspace settings
          </button>
          <button className="menu-destructive" disabled={controlsDisabled || !canRemoveWorkspace}
            title={workspaceId === defaultWorkspace.id ? 'The default workspace is required' :
              workspaceProjects.length ? 'Move or remove its projects first' : undefined}
            onClick={() => setRemoving('workspace')}><Trash2 size={14} /> Remove workspace</button>
        </>}>
        <select id="active-workspace" className="input" value={workspaceId} disabled={controlsDisabled} onChange={e => switchWorkspace(e.target.value)}>
          {!activeWorkspace && <option value={workspaceId}>{catalogReady ? 'Unavailable workspace' : 'Loading workspaces…'}</option>}
          {workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
        </select>
      </CatalogControls>
    </div>, workspaceHost)}
    <div className="project-bar">
      <label className="pane-heading" htmlFor="active-project">Project</label>
      <CatalogControls kind="project" onAdd={() => openDialog('addProject')} addDisabled={controlsDisabled || !activeWorkspace}
        menu={<>
          <button disabled={controlsDisabled || !managedProject} onClick={() => openDialog('projectSettings')}>
            <Settings2 size={14} /> Project settings
          </button>
          <button disabled={controlsDisabled || !current} onClick={() => void exportSaved()}>
            <Download size={14} /> Export project
          </button>
          <button className="menu-destructive" disabled={controlsDisabled || !managedProject || sourceDirty}
            title={sourceDirty ? 'Save or discard your changes first' : undefined} onClick={() => setRemoving('project')}>
            <Trash2 size={14} /> Remove project
          </button>
        </>}>
        <select id="active-project" className="input" value={PROJECT_ID} disabled={controlsDisabled || !workspaceProjects.length} onChange={e => switchProject(e.target.value)}>
          {!current && <option value={PROJECT_ID}>{!catalogReady ? 'Loading projects…' : PROJECT_ID ? 'Unavailable project' : workspaceProjects.length ? 'Choose a project' : 'No projects yet'}</option>}
          {workspaceProjects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        </select>
      </CatalogControls>
      {current?.origin.kind === 'git' && <span className="project-origin" title={`${current.origin.repository} · ${current.origin.commit}`}>
        <GitBranch size={13} /> {current.origin.ref} · {current.origin.commit?.slice(0, 8)} · {current.origin.directory}
      </span>}
      {current?.origin.kind === 'local' && <span className="project-origin">Server folder · edits saved directly</span>}
      {error && !dialog && <span role="alert" className="form-error">{error}</span>}
    </div>
    {dialog === 'addProject' && <Modal title="Add project" subtitle={`Add a project to ${activeWorkspace?.name ?? workspaceId}.`} wide onClose={close}>
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
    {dialog && dialog !== 'addProject' && <Modal
      title={dialog === 'addWorkspace' ? 'New workspace' : dialog === 'workspaceSettings' ? 'Workspace settings' : 'Project settings'}
      onClose={close}>
      <form className="project-form" onSubmit={event => void submitSettings(event)}>
        <label className="field">
          <span className="field-label">{dialog === 'projectSettings' ? 'Project name' : 'Workspace name'}</span>
          <input className="input" required maxLength={120} disabled={busy}
            value={settingsName} onChange={event => setSettingsName(event.target.value)} />
        </label>
        {dialog === 'projectSettings' && <label className="field">
          <span className="field-label" id="project-settings-workspace-label">Workspace</span>
          <select className="input" aria-labelledby="project-settings-workspace-label" required disabled={busy} value={destination} onChange={event => setDestination(event.target.value)}>
            {workspaces.map(workspace => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
        </label>}
        {error && <p role="alert" className="form-error">{error}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy || saving}>
          {dialog === 'addWorkspace' ? 'Create workspace' : 'Save changes'}
        </button>
      </form>
    </Modal>}
    {removing && <ConfirmModal
      title={removing === 'workspace' ? 'Remove workspace?' : 'Remove project?'}
      confirmLabel={removing === 'workspace' ? 'Remove workspace' : 'Remove project'}
      message={removing === 'workspace' ? `Remove “${activeWorkspace?.name}” from the workspace selector?` :
        `Remove “${current?.name}” from this workspace? Saved files are retained on the server.`}
      onClose={() => setRemoving(null)} onConfirm={removeSelected} />}
    {pending && <ConfirmModal title="Discard unsaved changes?" message="Switching will discard the unsaved changes in the current project." confirmLabel="Discard and switch" danger={false} onClose={() => setPending(null)} onConfirm={async () => navigate(pending)} />}
  </>
}
