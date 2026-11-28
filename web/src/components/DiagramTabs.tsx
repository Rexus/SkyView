import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Network, X } from 'lucide-react'
import type { DiagramTab } from '../diagramTabs'
import UnsavedDot from './UnsavedDot'

export default function DiagramTabs({ tabs, active, dirty, onOpen, onClose }: {
 tabs: DiagramTab[]
 active: string | null
 dirty: (tab: DiagramTab) => boolean
 onOpen: (tab: DiagramTab) => void
 onClose: (keys: string[]) => void
}) {
 const [menu, setMenu] = useState<{ key: string; x: number; y: number } | null>(null)
 const menuRef = useRef<HTMLDivElement>(null)
 const opener = useRef<HTMLButtonElement | null>(null)
 useEffect(() => {
  if (!menu) return
  menuRef.current?.querySelector('button')?.focus()
  const outside = (event: PointerEvent) => {
   if (!menuRef.current?.contains(event.target as Node)) setMenu(null)
  }
  const dismiss = (event: KeyboardEvent) => {
   if (event.key !== 'Escape') return
   event.stopPropagation()
   setMenu(null)
   opener.current?.focus()
  }
  document.addEventListener('pointerdown', outside)
  document.addEventListener('keydown', dismiss)
  const resize = () => setMenu(null)
  window.addEventListener('resize', resize)
  return () => {
   document.removeEventListener('pointerdown', outside)
   document.removeEventListener('keydown', dismiss)
   window.removeEventListener('resize', resize)
  }
 }, [menu])
 const showMenu = (tab: DiagramTab, x: number, y: number, trigger: HTMLButtonElement) => {
  opener.current = trigger
  setMenu({ key: tab.key, x: Math.max(4, Math.min(x, window.innerWidth - 168)), y: Math.max(4, Math.min(y, window.innerHeight - 120)) })
 }
 const close = (keys: string[]) => { setMenu(null); onClose(keys) }
 if (!tabs.length) return null
 return <>
  <div className="diagram-tabs" role="group" aria-label="Open diagrams">
   {tabs.map(tab => {
    const changed = dirty(tab)
    const context = (x: number, y: number, button: HTMLButtonElement) => showMenu(tab, x, y, button)
    return <div className="diagram-tab" key={tab.key} data-active={tab.key === active}>
     <button className="diagram-tab-open" type="button" aria-current={tab.key === active ? 'page' : undefined}
      aria-label={tab.title + (changed ? ', unsaved changes' : '')} title={tab.file + ' · ' + tab.title}
      onClick={() => onOpen(tab)} onContextMenu={event => { event.preventDefault(); context(event.clientX, event.clientY, event.currentTarget) }}
      onKeyDown={event => {
       if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return
       event.preventDefault()
       const bounds = event.currentTarget.getBoundingClientRect()
       context(bounds.left, bounds.bottom, event.currentTarget)
      }}>
      <Network size={14} aria-hidden="true" /><span>{tab.title}</span>
      {changed && <UnsavedDot />}
     </button>
     <button className="diagram-tab-close" type="button" aria-label={'Close ' + tab.title} title="Close diagram"
      onClick={() => close([tab.key])}><X size={13} /></button>
    </div>
   })}
  </div>
  {menu && createPortal(<div ref={menuRef} className="diagram-tab-menu" role="menu" aria-label="Diagram tab actions" style={{ left: menu.x, top: menu.y }}>
   <button type="button" role="menuitem" onClick={() => close([menu.key])}>Close</button>
   <button type="button" role="menuitem" disabled={tabs.length < 2} onClick={() => close(tabs.filter(tab => tab.key !== menu.key).map(tab => tab.key))}>Close others</button>
   <button type="button" role="menuitem" onClick={() => close(tabs.map(tab => tab.key))}>Close all</button>
  </div>, document.body)}
 </>
}
