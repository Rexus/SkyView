import { useEffect, useState } from 'react'
import { saveProjectPalette, type ProjectPalette } from '../api'

interface Props {
  palette: ProjectPalette
  onSave: (palette: ProjectPalette) => void
  onDirtyChange: (dirty: boolean) => void
}

export default function KeywordPalette({ palette, onSave, onDirtyChange }: Props) {
  const [filter, setFilter] = useState('')
  const matches = palette.keywords.filter(entry => entry.keyword.includes(filter.trim().toLowerCase()))
  const [draft, setDraft] = useState(palette.colours)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const dirty = Object.keys(draft).length !== Object.keys(palette.colours).length ||
    Object.entries(draft).some(([key, value]) => palette.colours[key] !== value)
  useEffect(() => { onDirtyChange(dirty || saving) }, [dirty, saving, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const next = await saveProjectPalette(palette.revision, draft)
      setDraft(next.colours)
      onSave(next)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setSaving(false)
    }
  }

  return <section className="keyword-palette" aria-labelledby="keyword-palette-title">
    <div className="keyword-palette-heading">
      <h3 id="keyword-palette-title">Project keyword colours</h3>
      <input className="input input-sm" aria-label="Filter keywords" placeholder="Filter keywords…" value={filter}
        onChange={event => setFilter(event.target.value)} />
    </div>
    <div className="keyword-list">
      {matches.map(entry => <label className="keyword-row" key={entry.keyword}>
        <input type="color" aria-label={`${entry.keyword} colour`} disabled={saving}
          value={draft[entry.keyword] ?? entry.default} onChange={event => {
            const fill = event.currentTarget.value
            setDraft(current => {
              const next = { ...current }
              if (fill === entry.default) delete next[entry.keyword]
              else next[entry.keyword] = fill
              return next
            })
          }} />
        <span>«{entry.keyword}»</span>
      </label>)}
    </div>
    {!matches.length && <p className="explorer-message">No matching keywords.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="keyword-actions">
      <button className="btn btn-sm btn-primary" disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save colours'}</button>
      {dirty && <button className="btn btn-sm" disabled={saving} onClick={() => { setDraft(palette.colours); setError('') }}>Revert</button>}
      {!!Object.keys(draft).length && <button className="btn btn-sm" disabled={saving} onClick={() => setDraft({})}>Defaults</button>}
    </div>
  </section>
}
