import type { SysmlElement } from './types'

export const elementDragType = 'application/x-skyview-element'

export const canPlaceElement = (element: SysmlElement) =>
 !element.implicit && ['part', 'item', 'package', 'requirement'].includes(element.kind)

type ElementDrag = { project: string; file: string; id: string }
export type DropPosition = { x: number; y: number }

export function startElementDrag(transfer: DataTransfer, element: ElementDrag) {
 transfer.setData(elementDragType, JSON.stringify(element))
 transfer.effectAllowed = 'copy'
}

export function readElementDrag(transfer: DataTransfer): ElementDrag | undefined {
 try {
  const value = JSON.parse(transfer.getData(elementDragType))
  return value && typeof value.project === 'string' && typeof value.file === 'string' &&
   typeof value.id === 'string' && value.id ? value : undefined
 } catch {
  return undefined
 }
}
