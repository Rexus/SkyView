import { useEffect, useState } from 'react'
import type { FileResponse } from '../types'

type Selection = { id: string; title: string; owner: string }

/** Display the server's SVG unchanged: browser and CI share one renderer. */
export default function SharedViews({ file }: { file: FileResponse }) {
  const [views, setViews] = useState<Selection[]>([])
  const [selected, setSelected] = useState('')
  const [error, setError] = useState('')
  const [svg, setSvg] = useState('')
  const base = `/api/files/${encodeURIComponent(file.name)}/views`
  useEffect(() => {
    const controller = new AbortController()
    setViews([]); setSelected(''); setError(''); setSvg('')
    fetch(base, { signal: controller.signal }).then(async r => {
      if (!r.ok) throw new Error(r.status === 404 ? 'No shared views published for this model yet.' : 'Could not load shared views.')
      const config = await r.json() as { views: Selection[] }
      const requested = new URLSearchParams(location.search).get('view')
      if (requested && !config.views.some(v => v.id === requested)) throw new Error(`Shared view “${requested}” is not available in this model.`)
      setViews(config.views)
      setSelected(requested || config.views[0]?.id || '')
    }).catch(e => { if (!controller.signal.aborted) setError(String(e.message)) })
    return () => controller.abort()
  }, [base, file.revision])
  useEffect(() => {
    if (!selected) return
    const controller = new AbortController()
    let objectURL = ''
    setSvg(''); setError('')
    const page = new URL(location.href)
    page.searchParams.set('file', file.name); page.searchParams.set('view', selected)
    history.replaceState(null, '', page)
    fetch(`${base}/${encodeURIComponent(selected)}`, { signal: controller.signal }).then(async r => {
      if (!r.ok) {
        const details = await r.json()
        throw new Error(details.error || 'This view no longer matches the model. Check its selection and layout.')
      }
      const blob = await r.blob()
      if (!controller.signal.aborted) { objectURL = URL.createObjectURL(blob); setSvg(objectURL) }
    }).catch(e => { if (!controller.signal.aborted) setError(String(e.message)) })
    return () => { controller.abort(); if (objectURL) URL.revokeObjectURL(objectURL) }
  }, [base, file.name, file.revision, selected])
  return <section className="shared-views">
    <div className="shared-view-toolbar">
      <label>Shared view <select aria-label="Shared view" value={selected} onChange={e => setSelected(e.target.value)}>
        {views.map(v => <option key={v.id} value={v.id}>{v.owner === '.' ? '' : `${v.owner} / `}{v.title}</option>)}
      </select></label>
      {svg && <a className="btn" href={svg} download={`${selected}.svg`}>Download SVG</a>}
    </div>
    <p className="shared-view-note">Published selection from the SysML source. Layout is shared with the command-line SVG exporter. Full SysML conformance still requires the project’s native validator.</p>
    {error ? <p role="alert">{error}</p> : svg ? <img className="shared-view-svg" src={svg} alt={views.find(v => v.id === selected)?.title || selected} /> : <p>Loading shared view…</p>}
  </section>
}
