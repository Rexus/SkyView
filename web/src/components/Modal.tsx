import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  title: string
  subtitle?: string
  icon?: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  onClose: () => void
}

export default function Modal({ title, subtitle, icon, children, footer, wide, onClose }: ModalProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const first = ref.current?.querySelector<HTMLElement>(
      'input:not([type=checkbox]), textarea, select, button.primary-focus',
    )
    first?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className={wide ? 'modal wide' : 'modal'} role="dialog" aria-modal="true">
        <div className="modal-head">
          {icon && <div style={{ color: 'var(--accent)' }}>{icon}</div>}
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{title}</h2>
            {subtitle && <div className="sub">{subtitle}</div>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}
