import { useCallback, useEffect, useRef, useState } from 'react'
import { API_BASE } from './api'
import type { ViewConfig } from './sharedViews'

export interface ModelViews {
  config: ViewConfig
  etag: string
  draft?: ViewConfig
  draftError?: string
}

export async function loadModelViews(file: string, signal: AbortSignal): Promise<ModelViews> {
  const response = await fetch(viewPath(file), { signal })
  if (response.status === 404) return { config: { version: 2, views: [] }, etag: '' }
  if (!response.ok) throw new Error('Saved views could not be loaded.')
  return { config: await response.json(), etag: response.headers.get('ETag') ?? '' }
}

export const viewPath = (file: string) => API_BASE + '/files/' + encodeURIComponent(file) + '/views'
const draftPath = (file: string) => API_BASE + '/files/' + encodeURIComponent(file) + '/view-draft'

async function loadDraft(file: string, signal: AbortSignal) {
  const response = await fetch(draftPath(file), { signal })
  if (response.status === 404) return
  if (!response.ok) throw new Error('Diagram autosave could not be loaded.')
  const draft: { base: string; config: ViewConfig } = await response.json()
  return { ...draft, etag: response.headers.get('ETag') ?? '' }
}

export function useModelViews(file?: string, recoverDraft = false) {
  const [state, setState] = useState<Record<string, { data?: ModelViews; error?: string }>>({})
  const published = useRef(new Map<string, ModelViews>())
  const draftRevisions = useRef(new Map<string, { base: string; etag: string }>())
  const pendingDrafts = useRef(new Map<string, Promise<void>>())
  useEffect(() => {
    if (!file) return
    const request = new AbortController()
    const previous = published.current.get(file)
    const autosave = recoverDraft
      ? loadDraft(file, request.signal).then(draft => ({ draft, error: '' }))
        .catch(error => ({ draft: undefined, error: String(error.message ?? error) }))
      : undefined
    Promise.all([loadModelViews(file, request.signal), autosave]).then(([catalog, recovery]) => {
      if (request.signal.aborted || published.current.get(file) !== previous) return
      const candidate = recovery?.draft
      const recovered = candidate?.base === catalog.etag ? candidate : undefined
      if (recoverDraft && draftRevisions.current.get(file)?.base !== catalog.etag) {
        draftRevisions.current.set(file, { base: catalog.etag, etag: recovered?.etag ?? '' })
      }
      const data = { ...catalog, draft: recovered?.config, draftError: recovery?.error }
      setState(current => ({ ...current, [file]: { data } }))
    }).catch(error => {
      if (!request.signal.aborted && published.current.get(file) === previous) {
        setState(current => ({ ...current, [file]: { ...current[file], error: String(error.message ?? error) } }))
      }
    })
    return () => request.abort()
  }, [file, recoverDraft])
  const autosave = useCallback((name: string, revision: string, base: string, config?: ViewConfig) => {
    const publication = published.current.get(name)
    const previous = pendingDrafts.current.get(name)
    const task = (previous?.catch(() => {}) ?? Promise.resolve()).then(async () => {
      const current = draftRevisions.current.get(name)
      if (published.current.get(name) !== publication || current && current.base !== base) return
      if (!config && !current?.etag) return
      const response = await fetch(draftPath(name), {
        method: config ? 'PUT' : 'DELETE',
        headers: { 'Content-Type': 'application/json', 'If-Match': revision,
          'If-View-Match': base, 'If-Draft-Match': current?.etag ?? '' },
        body: config ? JSON.stringify(config) : undefined,
      })
      if (published.current.get(name) !== publication || !config && response.status === 404) return
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error(body.error || 'Diagram autosave could not be updated.')
      }
      draftRevisions.current.set(name, { base, etag: response.headers.get('ETag') ?? '' })
    })
    pendingDrafts.current.set(name, task)
    const release = () => {
      if (pendingDrafts.current.get(name) === task) pendingDrafts.current.delete(name)
    }
    void task.then(release, release)
    return task
  }, [])
  return {
    data: file ? state[file]?.data : undefined,
    error: file ? state[file]?.error : undefined,
    autosave,
    publish: (name: string, data: ModelViews) => {
      published.current.set(name, data)
      draftRevisions.current.set(name, { base: data.etag, etag: '' })
      setState(current => ({ ...current, [name]: { data } }))
    },
  }
}
