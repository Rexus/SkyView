export type ProjectInfo = {
  id: string
  version: number
  workspaceId?: string
  name: string
  origin: { kind: string; repository?: string; ref?: string; commit?: string; directory?: string; example?: string }
}
export type WorkspaceInfo = { id: string; name: string }
export type ExampleInfo = { id: string; name: string; description?: string }

export async function projectRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, init)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`)
  return data as T
}
export function createProject(name: string, example?: string, workspaceId?: string) {
  return projectRequest<ProjectInfo>('projects', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, example, workspaceId }),
  })
}
export function importRepository(name: string, repository: string, ref: string, directory: string, workspaceId?: string) {
  return projectRequest<ProjectInfo>('projects/git', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, repository, ref, directory, workspaceId }),
  })
}
export function uploadProject(name: string, file: File, directory: string, workspaceId?: string) {
  const body = new FormData()
  body.set('name', name); body.set('file', file); body.set('directory', directory)
  if (workspaceId) body.set('workspaceId', workspaceId)
  return projectRequest<ProjectInfo>('projects/upload', { method: 'POST', body })
}

export function createWorkspace(name: string) {
  return projectRequest<WorkspaceInfo>('workspaces', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  })
}

export function renameWorkspace(id: string, name: string) {
  return projectRequest<WorkspaceInfo>(`workspaces/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }),
  })
}

export function removeWorkspace(id: string) {
  return projectRequest<{ ok: boolean }>(`workspaces/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

export function updateProject(id: string, name: string, workspaceId: string) {
  return projectRequest<ProjectInfo>(`projects/${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, workspaceId }),
  })
}

export function removeProject(id: string) {
  return projectRequest<{ ok: boolean }>(`projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
}
