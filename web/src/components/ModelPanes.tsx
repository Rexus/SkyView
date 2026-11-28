import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'

export default function ModelPanes({ source, diagram }: { source?: ReactNode; diagram?: ReactNode }) {
  const [fraction, setFraction] = useState(48)
  const [stacked, setStacked] = useState(false)
  const split = Boolean(source && diagram)
  useEffect(() => {
    const media = window.matchMedia?.('(max-width: 830px)')
    if (!media) return
    const update = () => setStacked(media.matches)
    update()
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  const resize = (value: number) => setFraction(Math.round(Math.max(28, Math.min(72, value))))
  return <div className={'model-panes' + (split ? ' split-panes' : '')}
    style={{ '--source-share': fraction + '%' } as CSSProperties}>
    {source && <section className="model-pane source-pane" aria-label="Model source">{source}</section>}
    {split && <div className="split-divider" role="separator" tabIndex={0} aria-label="Resize source and diagram"
      aria-orientation={stacked ? 'horizontal' : 'vertical'} aria-valuemin={28} aria-valuemax={72} aria-valuenow={fraction}
      onPointerDown={event => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        event.currentTarget.focus()
      }}
      onPointerMove={event => {
        if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
        const box = event.currentTarget.parentElement!.getBoundingClientRect()
        resize(stacked ? 100 * (event.clientY - box.top) / box.height : 100 * (event.clientX - box.left) / box.width)
      }}
      onKeyDown={event => {
        const smaller = stacked ? 'ArrowUp' : 'ArrowLeft', larger = stacked ? 'ArrowDown' : 'ArrowRight'
        if (event.key !== smaller && event.key !== larger && event.key !== 'Home' && event.key !== 'End') return
        event.preventDefault()
        resize(event.key === 'Home' ? 28 : event.key === 'End' ? 72 : fraction + (event.key === smaller ? -4 : 4))
      }} />}
    {diagram && <section className="model-pane diagram-pane" aria-label="Model diagram">{diagram}</section>}
  </div>
}
