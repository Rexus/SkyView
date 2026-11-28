import type { ReactNode } from 'react'
import { Wand2 } from 'lucide-react'
import ActionMenu from './ActionMenu'

export default function DiagramToolbar({ navigation, scopeControls, historyControls, resetControl, saveControl, onAutoLayout, children }: {
  navigation?: ReactNode
  scopeControls?: ReactNode
  historyControls?: ReactNode
  resetControl?: ReactNode
  saveControl?: ReactNode
  onAutoLayout?: () => void
  children?: ReactNode
}) {
  const commands = historyControls || resetControl || saveControl || onAutoLayout || children
  return <div className={'view-toolbar diagram-toolbar' + (scopeControls ? ' model-diagram-toolbar' : '')}>
    {navigation}
    {scopeControls}
    {commands && <div className="diagram-commands">
      {historyControls}
      {resetControl}
      {saveControl}
      {onAutoLayout && <button type="button" className="icon-button tooltip" aria-label="Auto layout" data-tip="Auto layout"
        onClick={onAutoLayout}><Wand2 size={15} /></button>}
      {children && <ActionMenu label="Diagram actions" iconOnly>{children}</ActionMenu>}
    </div>}
  </div>
}
