import { useEffect, useState } from 'react'

export interface BuildInfo {
  version: string
  tag?: string
  official: boolean
  channel: string
  revision?: string
  sourceState: string
  sourceTime?: string
  executableSHA256?: string
  platform: string
  goVersion: string
  repository: string
  copyright: string
  license: string
}

export interface AboutInfo {
  build: BuildInfo
  mode: 'single-user' | 'multi-user'
  account: string
}

export const deploymentLabel = (mode: AboutInfo['mode']) =>
  mode === 'multi-user' ? 'Hosted multi-user' : 'Local single-user'

export function useAbout() {
  const [about, setAbout] = useState<AboutInfo | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  useEffect(() => {
    let pending: AbortController
    function refresh() {
      pending?.abort()
      const request = pending = new AbortController()
      fetch('/api/about', { cache: 'no-store', signal: request.signal })
        .then(async response => {
          if (!response.ok) throw new Error('Build information is unavailable')
          const next = await response.json() as AboutInfo
          if (!next.build?.version) throw new Error('Build information is incomplete')
          if (!request.signal.aborted) {
            setAbout(next)
            setUnavailable(false)
          }
        })
        .catch(() => {
          if (!request.signal.aborted) {
            setAbout(null)
            setUnavailable(true)
          }
        })
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => {
      pending.abort()
      window.removeEventListener('focus', refresh)
    }
  }, [])
  return { about, unavailable }
}
