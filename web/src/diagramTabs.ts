import type { SysmlModel } from './types'
import type { ModelViews } from './modelViews'
import type { ViewConfig, SharedView } from './sharedViews'

export type DiagramTab = { key: string; file: string; view: string | null; scope?: string; title: string }
export type LayoutDraft = { base: ModelViews; config: ViewConfig }

export const diagramTabKey = (file: string, view: string | null, scope?: string) => JSON.stringify([file, view, scope])

function subjectIdentity(model: SysmlModel, reference: string) {
 const exact = model.elements.find(element => element.qname === reference)
 if (exact) return exact.id
 const matches = model.elements.filter(element => element.shortName === reference)
 return matches.length === 1 ? matches[0].id : undefined
}

export function diagramDestinations(model: SysmlModel, views: SharedView[], elementId: string): SharedView[] {
 const element = model.elements.find(item => item.id === elementId && ['part', 'package'].includes(item.kind))
 if (!element) return []
 const related = [element.id, element.typeId, element.specializesId]
 for (const id of related) {
  if (!id) continue
  const matching = views.filter(view => subjectIdentity(model, view.subject) === id)
  if (!matching.length) continue
  const depth = (view: SharedView) => view.owner === '.' ? 0 : view.owner.split('/').length
  const overview = Math.min(...matching.map(depth))
  return matching.filter(view => depth(view) === overview)
 }
 return []
}

export function layoutDirty(draft: LayoutDraft | undefined, view: string | null) {
 if (!draft || !view) return false
 return JSON.stringify(draft.base.config.views.find(item => item.id === view)) !==
  JSON.stringify(draft.config.views.find(item => item.id === view))
}

export function discardLayouts(config: ViewConfig, base: ViewConfig, ids: Set<string>): ViewConfig {
 const current = new Map(config.views.filter(view => !ids.has(view.id)).map(view => [view.id, view]))
 for (const view of base.views) if (ids.has(view.id)) current.set(view.id, view)
 // Restore the saved order while retaining newly opened or edited views.
 const ordered = base.views.map(view => current.get(view.id)).filter((view): view is SharedView => !!view)
 const savedIds = new Set(base.views.map(view => view.id))
 const restored = { ...config, views: [...ordered, ...[...current.values()].filter(view => !savedIds.has(view.id))] }
 return JSON.stringify({ ...restored, version: base.version }) === JSON.stringify(base) ? base : restored
}
