import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import type { Toast } from '../types'

interface Props {
  toasts: Toast[]
  onDismiss: (id: number) => void
}

export default function Toasts({ toasts, onDismiss }: Props) {
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span className="icon">
            {t.kind === 'success' ? (
              <CheckCircle2 size={15} />
            ) : t.kind === 'error' ? (
              <XCircle size={15} />
            ) : (
              <Info size={15} />
            )}
          </span>
          <span style={{ flex: 1 }}>{t.message}</span>
          <button className="icon-button close" onClick={() => onDismiss(t.id)} aria-label="Dismiss">
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  )
}
