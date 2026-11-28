import type { SharedView } from './sharedViews'

export type LayoutMove = { before: SharedView; after: SharedView; refit: boolean }
export type HistoryStep = 'record' | 'undo' | 'redo'
export type MoveStacks = { undo: LayoutMove[]; redo: LayoutMove[] }

export type ViewHistories = Record<string, MoveStacks>

export const emptyMoves: MoveStacks = { undo: [], redo: [] }

export function sameLayout(a?: SharedView, b?: SharedView) {
 return a === b || JSON.stringify(a) === JSON.stringify(b)
}

export function stepMoves(stacks: MoveStacks, move: LayoutMove, step: HistoryStep): MoveStacks {
 const undo = stacks.undo.filter(entry => entry !== move)
 const redo = stacks.redo.filter(entry => entry !== move)
 switch (step) {
  case 'record': return { ...stacks, undo: [...undo.slice(-39), move], redo: [] }
  case 'undo': return { ...stacks, undo, redo: [...redo.slice(-39), move] }
  case 'redo': return { ...stacks, undo: [...undo.slice(-39), move], redo }
 }
}
