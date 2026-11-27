import type {
  Diagnostic,
  FileInfo,
  FileResponse,
  LayoutFile,
  Revision,
} from './types'

const BASE = '/api'

class ApiError extends Error {
  diagnostics?: unknown
  status: number

  constructor(message: string, status: number, diagnostics?: unknown) {
    super(message)
    this.status = status
    this.diagnostics = diagnostics
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : {}
  if (!res.ok) {
    throw new ApiError(data.error ?? `HTTP ${res.status}`, res.status, data.diagnostics)
  }
  return data as T
}

export async function listFiles(): Promise<FileInfo[]> {
  const data = await request<{ files: FileInfo[] }>('/files')
  return data.files ?? []
}

export function getFile(name: string): Promise<FileResponse> {
  return request<FileResponse>(`/files/${encodeURIComponent(name)}`)
}

export function saveFile(name: string, content: string): Promise<FileResponse> {
  return request<FileResponse>(`/files/${encodeURIComponent(name)}`, {
    method: 'PUT',
    body: JSON.stringify({ content }),
  })
}

export function createFile(name: string, content = ''): Promise<FileResponse> {
  return request<FileResponse>('/files', {
    method: 'POST',
    body: JSON.stringify({ name, content }),
  })
}

export function deleteFile(name: string): Promise<void> {
  return request<void>(`/files/${encodeURIComponent(name)}`, { method: 'DELETE' })
}

export interface ElementPatch {
  id: string
  name?: string
  type?: string
  doc?: string
  value?: string
}

export function patchElement(name: string, patch: ElementPatch): Promise<FileResponse> {
  return request<FileResponse>(`/files/${encodeURIComponent(name)}/element`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

export interface NewElement {
  parent: string
  kind: string
  isDef: boolean
  name: string
  type?: string
  doc?: string
  value?: string
}

export function addElement(name: string, element: NewElement): Promise<FileResponse> {
  return request<FileResponse>(`/files/${encodeURIComponent(name)}/element`, {
    method: 'POST',
    body: JSON.stringify(element),
  })
}

export function deleteElement(name: string, id: string): Promise<FileResponse> {
  return request<FileResponse>(
    `/files/${encodeURIComponent(name)}/element?id=${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  )
}

export interface NewConnection {
  parent: string
  name?: string
  source: string
  target: string
}

export function addConnection(name: string, conn: NewConnection): Promise<FileResponse> {
  return request<FileResponse>(`/files/${encodeURIComponent(name)}/connection`, {
    method: 'POST',
    body: JSON.stringify(conn),
  })
}

export interface NewSatisfy {
  parent: string
  requirement: string
  satisfier: string
}

export function addSatisfy(name: string, link: NewSatisfy): Promise<FileResponse> {
  return request<FileResponse>(`/files/${encodeURIComponent(name)}/satisfy`, {
    method: 'POST',
    body: JSON.stringify(link),
  })
}

export function getLayout(name: string): Promise<LayoutFile> {
  return request<LayoutFile>(`/files/${encodeURIComponent(name)}/layout`)
}

export function putLayout(name: string, layout: LayoutFile): Promise<void> {
  return request<void>(`/files/${encodeURIComponent(name)}/layout`, {
    method: 'PUT',
    body: JSON.stringify(layout),
  })
}

export function getHistory(name: string): Promise<Revision[]> {
  return request<{ revisions: Revision[] }>(`/files/${encodeURIComponent(name)}/history`).then(
    (d) => d.revisions ?? [],
  )
}

export function restoreRevision(name: string, revision: string): Promise<FileResponse> {
  return request<FileResponse>(`/files/${encodeURIComponent(name)}/restore`, {
    method: 'POST',
    body: JSON.stringify({ revision }),
  })
}

export async function validateFile(name: string, content: string): Promise<Diagnostic[]> {
  const data = await request<{ diagnostics: Diagnostic[] }>(
    `/files/${encodeURIComponent(name)}/validate`,
    { method: 'POST', body: JSON.stringify({ content }) },
  )
  return data.diagnostics ?? []
}

export function downloadUrl(name: string): string {
  return `${BASE}/files/${encodeURIComponent(name)}/download`
}

export { ApiError }
