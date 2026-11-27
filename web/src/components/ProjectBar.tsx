import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { FolderOpen, Plus, Upload, GitBranch, Download, Boxes } from 'lucide-react'
import { PROJECT_ID } from '../api'
import { createProject, importRepository, projectRequest, uploadProject, type ExampleInfo, type ProjectInfo } from '../projects'
import Modal from './Modal'
import { ConfirmModal } from './modals'
import './ProjectBar.css'

type Mode = 'examples' | 'new' | 'upload' | 'git'

export default function ProjectBar({ sourceDirty, saving }: { sourceDirty: boolean; saving: boolean }) {
  const [projects, setProjects] = useState<ProjectInfo[]>([])
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
  const [pending, setPending] = useState('')
  const close = useCallback(() => { if (!busy) setOpen(false) }, [busy])

  useEffect(() => {
    let active = true
    Promise.all([
      projectRequest<{ projects: ProjectInfo[] }>('projects'),
      projectRequest<{ examples: ExampleInfo[] }>('examples'),
    ]).then(([catalog, library]) => {
      if (active) { setProjects(catalog.projects); setExamples(library.examples) }
    }).catch(e => { if (active) setError(e.message) })
    return () => { active = false }
  }, [])

  const current = projects.find(p => p.id === PROJECT_ID)
  const navigate = (id: string) => {
    // Reload clears file drafts, validation, undo and view state together. All
    // requests from the old page retain their immutable project-scoped API base.
    const url = new URL(location.href)
    url.search = ''; url.searchParams.set('project', id); url.hash = ''
    location.assign(url)
  }
  const switchProject = (id: string) => {
    if (id === PROJECT_ID || busy || saving) return
    if (sourceDirty) setPending(id)
    else navigate(id)
  }
  const run = async (action: () => Promise<ProjectInfo>) => {
    setBusy(true); setError('')
    try {
      const project = await action()
      setProjects(current => [...current, project])
      if (sourceDirty) setPending(project.id)
      else navigate(project.id)
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
    if (mode === 'new') void run(() => createProject(name))
    if (mode === 'git') void run(() => importRepository(name, repository, ref, directory))
    if (mode === 'upload' && archive) void run(() => uploadProject(name, archive, directory))
  }

  return <>
    <div className="project-bar">
      <FolderOpen size={16} aria-hidden="true" />
      <label htmlFor="active-project">Project</label>
      <select id="active-project" className="input" value={PROJECT_ID} disabled={busy || saving} onChange={e => switchProject(e.target.value)}>
        {!current && <option value={PROJECT_ID}>{projects.length ? 'Unavailable project' : 'Loading projects…'}</option>}
        {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
      <button className="btn" disabled={saving} onClick={() => { setError(''); setOpen(true) }}><Plus size={14} /> Projects</button>
      {current?.origin.kind === 'git' && <span className="project-origin" title={`${current.origin.repository} · ${current.origin.commit}`}>
        <GitBranch size={13} /> {current.origin.ref} · {current.origin.commit?.slice(0, 8)} · {current.origin.directory}
      </span>}
      {current?.origin.kind === 'local' && <span className="project-origin">Server folder · edits saved directly</span>}
      <span className="spacer" />
      <button className="btn" disabled={busy || saving} onClick={() => void exportSaved()} title="Download saved models, views and supporting files as a ZIP"><Download size={14} /> Export project</button>
      {error && !open && <span role="alert" className="form-error">{error}</span>}
    </div>
    {open && <Modal title="Projects" subtitle="Keep models, views and supporting files together." wide onClose={close}>
      <div className="project-tabs" role="tablist" aria-label="Add a project">
        {([['examples', Boxes, 'Examples'], ['new', Plus, 'New project'], ['upload', Upload, 'Upload ZIP'], ['git', GitBranch, 'Git snapshot']] as const).map(([value, Icon, title]) =>
          <button type="button" role="tab" aria-selected={mode === value} className={`btn ${mode === value ? 'btn-primary' : ''}`} key={value} disabled={busy} onClick={() => { setMode(value); setError('') }}><Icon size={14} /> {title}</button>)}
      </div>
      {mode === 'examples' ? <div className="project-examples">
        <p className="form-hint">Start an editable copy. The bundled example stays available for your next experiment.</p>
        {examples.map(example => <div className="project-example" key={example.id}>
          <div><strong>{example.name}</strong>{example.description && <p>{example.description}</p>}</div>
          <button className="btn" disabled={busy} onClick={() => void run(() => createProject(example.name, example.id))}>Use example</button>
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
    {pending && <ConfirmModal title="Discard source edits?" message="Switching projects will discard the unsaved source draft. Your saved files remain in their current project." confirmLabel="Discard and switch" danger={false} onClose={() => setPending('')} onConfirm={async () => navigate(pending)} />}
  </>
}
