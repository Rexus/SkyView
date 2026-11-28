import { boxesOf, boxKey, descendants, interiorLocked, lockedAncestor } from '../sharedViews'
import type { DiagramScene } from '../diagramScene'
import type { SysmlElement, SysmlModel } from '../types'
import type { Arrangement, SharedView } from '../sharedViews'

interface Props {
 view: SharedView
 model: SysmlModel
 scene?: DiagramScene | null
 target: string
 onChange: (view: SharedView) => void
 onArrange: (key?: string) => void
 onClose?: () => void
 onTarget: (key: string) => void
}

export default function SharedSettings({ view, model, scene, target, onChange, onArrange, onClose, onTarget }: Props) {
 const boxes = boxesOf(view), box = boxes.find(b => boxKey(b) === target)
 const container = !target || !!box && ('id' in box || boxes.some(b => b.parent === target))
 const options = box?.layout ?? (target ? {} : view.layout ?? {})
 const frozen = interiorLocked(options)
 const locker = target ? lockedAncestor(view, target) : undefined
 const descendantsOfTarget = target ? descendants(view, target) : new Set<string>()
 const byId = new Map(model.elements.map(element => [element.id, element]))
 const sceneNames = new Map(scene?.nodes.map(node => [node.key, byId.get(node.elementId ?? '')]))
 // Resolve the draft too, so a failed preview still lets you repair its layout.
 // A reference matches only a unique qualified or short name, as on the server.
 const references = new Map<string, SysmlElement | null>()
 for (const element of model.elements) {
  for (const reference of new Set([element.qname, element.shortName])) {
   if (reference) references.set(reference, references.has(reference) ? null : element)
  }
 }
 const names = new Map(boxes.map(box => {
  if ('id' in box) return [box.id, box.label || box.id]
  const element = sceneNames.get(box.element) ?? references.get(box.element)
  return [box.element, element?.name || (element ? box.element : `Unresolved: ${box.element}`)]
 }))
 const counts = new Map<string, number>()
 for (const name of names.values()) counts.set(name, (counts.get(name) ?? 0) + 1)
 const nameOf = (key: string) => names.get(key) ?? key
 const option = (key: string) => {
  const name = nameOf(key)
  return <option key={key} value={key}>{(counts.get(name) ?? 0) > 1 ? `${name} (${key})` : name}</option>
 }
 const update = (change: (v: SharedView) => void) => { const v = structuredClone(view); v.presentation = true; change(v); onChange(v) }
 const layout = (patch: Partial<Arrangement>) => update(v => { const b = boxesOf(v).find(b => boxKey(b) === target); if (b) b.layout = { ...options, ...patch }; else v.layout = { ...options, ...patch } })
 return <aside className="shared-settings" aria-label="Layout properties">
  <div className="shared-settings-head">
   <strong>{target ? nameOf(target) : 'Whole view'}</strong>
   {onClose && <button type="button" className="btn btn-sm" onClick={onClose} aria-label="Close layout properties">×</button>}
  </div>
  <label>Layout target
   <select className="select" aria-label="Settings target" value={target} onChange={e => onTarget(e.target.value)}>
    <option value="">Whole view</option>
    {!!view.nodes.length && <optgroup label="Model elements">{view.nodes.map(node => option(node.element))}</optgroup>}
    {!!view.boundaries?.length && <optgroup label="Layout boundaries">{view.boundaries.map(boundary => option(boundary.id))}</optgroup>}
   </select>
  </label>
  {locker && <p className="shared-layout-lock">
   <strong>{nameOf(locker)}</strong> has locked contents.
   <button type="button" className="btn btn-sm" onClick={() => onTarget(locker)}>Go to locking group</button>
  </p>}
  {box && <label className="shared-checkbox"><input type="checkbox" checked={options.positionLocked ?? false}
   onChange={e => layout({ positionLocked: e.target.checked })} /> Lock placement</label>}
  <fieldset disabled={Boolean(locker)}>
   {!target && <>
    <label>View title<input className="input" value={view.title} onChange={e => update(v => { v.title = e.target.value })} /></label>
    <label>Owner folder<input className="input" value={view.owner} onChange={e => update(v => { v.owner = e.target.value })} /></label>
   </>}
   {box && 'label' in box && <label>Boundary label<input className="input" value={box.label} onChange={e => update(v => { v.boundaries!.find(b => b.id === target)!.label = e.target.value })} /></label>}
   {box && <>
    <label>Inside<select className="select" value={box.parent ?? ''} disabled={options.positionLocked} onChange={e => update(v => { boxesOf(v).find(b => boxKey(b) === target)!.parent = e.target.value || undefined })}>
     <option value="">Whole view</option>
     {boxes.filter(candidate => boxKey(candidate) === box.parent ||
      (!descendantsOfTarget.has(boxKey(candidate)) && !interiorLocked(candidate.layout) &&
       !lockedAncestor(view, boxKey(candidate)))).map(boxKey).map(option)}
    </select></label>
    <div className="shared-dimensions">{(['x', 'y', 'width', 'height'] as const).map(field => <label key={field}>{field}<input className="input" type="number" value={box[field]} disabled={field === 'x' || field === 'y' || frozen} onChange={e => update(v => { boxesOf(v).find(b => boxKey(b) === target)![field] = Number(e.target.value) })} /></label>)}</div>
   </>}
   {container && <>
   {!!target && <label className="shared-checkbox"><input type="checkbox" checked={options.locked ?? false} disabled={options.positionLocked} onChange={e => layout({ locked: e.target.checked })} /> Lock contents</label>}
    <label>Arrangement<select className="select" disabled={frozen} value={options.pattern ?? 'flow'} onChange={e => layout({ pattern: e.target.value as Arrangement['pattern'] })}>
     <option value="flow">Flow</option><option value="horizontal">Horizontal</option><option value="vertical">Vertical</option><option value="grid">Grid</option>
    </select></label>
    {(options.pattern ?? 'flow') === 'flow' && <label>Direction<select className="select" disabled={frozen} value={options.direction ?? 'LR'} onChange={e => layout({ direction: e.target.value as 'LR' | 'TB' })}><option value="LR">Left to right</option><option value="TB">Top to bottom</option></select></label>}
    {options.pattern === 'grid' && <label>Columns<input className="input" type="number" min="1" max="20" disabled={frozen} value={options.columns ?? 2} onChange={e => layout({ columns: Number(e.target.value) })} /></label>}
    <label>Spacing<input className="input" type="number" min="8" max="200" disabled={frozen} value={options.gap ?? 40} onChange={e => layout({ gap: Number(e.target.value) })} /></label>
    <button className="btn" disabled={frozen} onClick={() => onArrange(target || undefined)}>Arrange {target ? 'contents' : 'view'}</button>
   </>}
   {box && 'id' in box && <button className="btn" disabled={frozen || boxes.some(child => child.parent === target && child.layout?.positionLocked)} onClick={() => {
    update(v => {
     for (const child of boxesOf(v)) if (child.parent === target) child.parent = box.parent
     v.boundaries = v.boundaries!.filter(boundary => boundary.id !== target)
    })
    onTarget('')
   }}>Remove boundary, keep elements</button>}
  </fieldset>
  <p>Use <strong>Save views</strong> to keep changes to this diagram’s layout.</p>
 </aside>
}
