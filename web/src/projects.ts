export type ProjectInfo = {
  id: string
  version: number
  name: string
  origin: { kind: string; repository?: string; ref?: string; commit?: string; directory?: string; example?: string }
}
export type ExampleInfo = { id: string; name: string; description?: string }

export async function projectRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/${path}`, init)
  const data = await response.json()
  if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`)
  return data as T
}
export function createProject(name: string, example?: string) {
  return projectRequest<ProjectInfo>('projects', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, example }),
  })
}
export function importRepository(name: string, repository: string, ref: string, directory: string) {
  return projectRequest<ProjectInfo>('projects/git', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, repository, ref, directory }),
  })
}
export function uploadProject(name: string, file: File, directory: string) {
  const body = new FormData()
  body.set('name', name); body.set('file', file); body.set('directory', directory)
  return projectRequest<ProjectInfo>('projects/upload', { method: 'POST', body })
}
