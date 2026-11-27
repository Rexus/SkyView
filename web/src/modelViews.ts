import { useEffect, useState } from 'react'
import { API_BASE } from './api'
import type { ViewConfig } from './sharedViews'

export interface ModelViews {
  config: ViewConfig
  etag: string
}

export async function loadModelViews(file: string, signal: AbortSignal): Promise<ModelViews> {
  const response = await fetch(viewPath(file), { signal })
  if (response.status === 404) return { config: { version: 2, views: [] }, etag: '' }
  if (!response.ok) throw new Error('Saved views could not be loaded.')
  return { config: await response.json(), etag: response.headers.get('ETag') ?? '' }
}

export const viewPath = (file: string) => API_BASE + '/files/' + encodeURIComponent(file) + '/views'

export function useModelViews(file?: string) {
  const [state, setState] = useState<Record<string, { data?: ModelViews; error?: string }>>({})
  useEffect(() => {
    if (!file) return
    const request = new AbortController()
    loadModelViews(file, request.signal).then(data => {
      if (!request.signal.aborted) setState(current => ({ ...current, [file]: { data } }))
    }).catch(error => {
      if (!request.signal.aborted) setState(current => ({ ...current, [file]: { ...current[file], error: String(error.message ?? error) } }))
    })
    return () => request.abort()
  }, [file])
  return {
    data: file ? state[file]?.data : undefined,
    error: file ? state[file]?.error : undefined,
    publish: (name: string, data: ModelViews) => setState(current => ({ ...current, [name]: { data } })),
  }
}
