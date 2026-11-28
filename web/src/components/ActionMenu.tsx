import { useEffect, useRef, type ReactNode } from 'react'
import { ChevronDown, Ellipsis } from 'lucide-react'

export default function ActionMenu({ label, iconOnly, className, trigger, children }: {
  label: string
  iconOnly?: boolean
  className?: string
  trigger?: ReactNode
  children: ReactNode
}) {
  const ref = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (ref.current?.open && !ref.current.contains(event.target as Node)) ref.current.open = false
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [])
  return <details className={className ? `action-menu ${className}` : 'action-menu'} ref={ref} onKeyDown={event => {
    if (event.key === 'Escape' && event.currentTarget.open) {
      event.stopPropagation()
      event.currentTarget.open = false
      event.currentTarget.querySelector('summary')?.focus()
    }
  }}>
    <summary className={iconOnly ? 'icon-button' : 'btn btn-sm'} aria-label={label} title={iconOnly ? label : undefined}>
      {trigger ?? (iconOnly ? <Ellipsis size={16} /> : <>{label}<ChevronDown size={13} /></>)}
    </summary>
    <div className="action-menu-items" onClick={event => {
      if ((event.target as Element).closest('button:not(:disabled), a[href]') && ref.current) ref.current.open = false
    }}>{children}</div>
  </details>
}
