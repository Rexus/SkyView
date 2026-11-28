import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import { filterRequirements, projectRequirements, requirementCSV, requirementLayout } from '../src/requirementTable.ts'
import { requirementConstraints, satisfiesFor, verificationCasesFor } from '../src/utils.ts'

test('Requirements inherit constraint text while traces stay on their authored targets', () => {
 const definition = { id: 'pressure', kind: 'requirement', isDef: true, children: ['range', 'stable'] }
 const intake = { id: 'intake', kind: 'requirement', typeId: definition.id }
 const exhaust = { id: 'exhaust', kind: 'requirement', typeId: definition.id }
 const rig = { id: 'rig', kind: 'part' }
 const testCase = { id: 'intake-check', kind: 'verification case' }
 const elements = [definition, intake, exhaust, rig, testCase,
  { id: 'range', kind: 'constraint', parentId: definition.id, constraintRole: 'require' },
  { id: 'stable', kind: 'constraint', parentId: definition.id, constraintRole: 'assume' },
  { id: 'satisfy-intake', kind: 'satisfy', requirementId: intake.id, satisfierId: rig.id },
  { id: 'definition-satisfy', kind: 'satisfy', requirementId: definition.id, satisfierId: rig.id },
  { id: 'verify-intake', kind: 'verify', requirementId: intake.id, parentId: testCase.id },
  { id: 'definition-verify', kind: 'verify', requirementId: definition.id, parentId: testCase.id },
 ]
 const model = { elements }
 assert.deepEqual(requirementConstraints(model, exhaust).map(e => e.id), ['range'])
 assert.deepEqual(requirementConstraints(model, exhaust, 'assume').map(e => e.id), ['stable'])
 assert.deepEqual(satisfiesFor(model, intake), [rig])
 assert.deepEqual(verificationCasesFor(model, intake), [testCase])
 assert.deepEqual(satisfiesFor(model, exhaust), [])
 assert.deepEqual(verificationCasesFor(model, exhaust), [])
})

const make = (id, kind, fields = {}) => ({ id, kind, name: id, qname: `PumpSystem::${id}`, line: 2,
 spans: { name: { start: 0, end: 1 }, type: { start: 0, end: 0 } }, ...fields })
const model = { rootId: 'root', rootName: 'Model', diagnostics: [], elements: [
 make('root', 'root'), make('requirements', 'package'),
 make('Limit', 'requirement', { isDef: true, children: ['subject', 'constraint', 'ambient'] }),
 make('minFlow', 'requirement', { name: 'Minimum flow', shortName: 'REQ-2', parentId: 'requirements', typeId: 'Limit', doc: 'Reason for the limit.', line: 12 }),
 make('maxFlow', 'requirement', { name: 'Maximum flow', shortName: 'REQ-10', parentId: 'requirements', doc: '=2+3', line: 22 }),
 make('subject', 'subject', { name: 'pump', type: 'Pump', parentId: 'Limit' }),
 make('constraint', 'constraint', { parentId: 'Limit', constraintRole: 'require', expression: 'flow >= 10' }),
 make('ambient', 'constraint', { parentId: 'Limit', constraintRole: 'assume', expression: 'temp < 100' }),
 make('installedPump', 'part'), make('run', 'verification', { name: 'Flow test' }),
 make('flow-verify', 'verify', { parentId: 'run', requirementId: 'minFlow' }),
 make('flow-satisfy', 'satisfy', { requirementId: 'minFlow', satisfierId: 'installedPump' }),
] }

test('Requirement review and CSV use the same projected values', () => {
 const rows = projectRequirements(model)
 const all = filterRequirements(rows, '', 'all', {}, [{ id: 'id', direction: 'asc' }])
 assert.deepEqual(all.map(row => row.requirement.id), ['minFlow', 'maxFlow', 'Limit'])
 assert.equal(all[0].values.subject, 'pump : Pump')
 assert.equal(all[0].values.constraint, 'flow >= 10')
 assert.equal(all[0].values.documentation, 'Reason for the limit.')
 assert.equal(all[0].values.assumptions, 'temp < 100')
 assert.deepEqual(all[0].gaps, [])
 assert.deepEqual(filterRequirements(rows, '', 'verification', {}, []).map(row => row.requirement.id), ['maxFlow'])
 assert.deepEqual(filterRequirements(rows, 'pump test', 'all', { name: 'minimum' }, []).map(row => row.requirement.id), ['minFlow'])
 const csv = requirementCSV(all.slice(0, 2), ['documentation', 'id', 'verification'])
 assert.match(csv, /^"Documentation","ID","Planned verification"\r\n/)
 assert.match(csv, /"Reason for the limit\.","REQ-2","Flow test"/)
 assert.match(csv, /"'=2\+3","REQ-10",""/)
 assert.match(requirementCSV([{ ...all[0], values: { ...all[0].values, documentation: 'One, "two"\nthree' } }], ['documentation']), /"One, ""two""\r\nthree"/)
 const layout = requirementLayout([{ id: 'name', visible: false, width: 10000 }, { id: 'name' }, { id: 'foreign' }])
 assert.deepEqual(layout[0], { id: 'name', visible: true, width: 720 })
 assert.equal(new Set(layout.map(column => column.id)).size, layout.length)
})

test('Requirements workbench filters, rearranges, exports, and edits the selected row', async () => {
 const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
 const descriptors = new Map()
 for (const key of ['window', 'document', 'navigator', 'localStorage', 'HTMLElement', 'Element', 'Node']) {
  descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
  Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
 }
 const priorAct = globalThis.IS_REACT_ACT_ENVIRONMENT
 globalThis.IS_REACT_ACT_ENVIRONMENT = true
 const temp = await mkdtemp(fileURLToPath(new URL('./.requirements-', import.meta.url)))
 const createURL = URL.createObjectURL, revokeURL = URL.revokeObjectURL
 let root, blob, downloaded
 URL.createObjectURL = value => { blob = value; return 'blob:http://localhost/requirements' }
 URL.revokeObjectURL = () => {}
 dom.window.HTMLAnchorElement.prototype.click = function () { downloaded = this.download }
 try {
  const output = `${temp}/RequirementsView.mjs`
  await build({ stdin: { contents: 'export {default} from "../src/components/RequirementsView"',
   resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, outfile: output, bundle: true,
   packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic' })
  const { default: Workbench } = await import(pathToFileURL(output).href)
  const { act, createElement, useState } = await import('react')
  const { createRoot } = await import('react-dom/client')
  const host = document.querySelector('#root')
  let sourceLine, satisfied, added, patched, acceptSave = false
  root = createRoot(host)
  function Harness() {
   const [selectedId, setSelectedId] = useState(null)
   return createElement(Workbench, { model, fileName: 'models/Pump.sysml', selectedId, onSelect: setSelectedId,
    onShowInSource: line => { sourceLine = line }, onAddSatisfy: id => { satisfied = id },
    onAddRequirement: parent => { added = parent }, onDelete: () => {},
    onPatch: async (id, patch) => { patched = [id, patch]; return acceptSave } })
  }
  const byText = (selector, label) => [...host.querySelectorAll(selector)].find(node => node.textContent.trim() === label)
  const click = label => act(async () => byText('button', label).click())
  const change = (selector, value) => act(async () => {
   const field = host.querySelector(selector)
   const prototype = field.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype
   Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, value)
   field.dispatchEvent(new dom.window.Event(field.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true }))
  })
  const names = () => [...host.querySelectorAll('tbody th[scope="row"]')].map(element => element.textContent.trim())
  await act(async () => root.render(createElement(Harness)))
  assert.deepEqual(names(), ['Minimum flow', 'Maximum flow', 'Limit'])
  await change('[aria-label="Requirement coverage"]', 'verification')
  assert.deepEqual(names(), ['Maximum flow'])
  await click('Export CSV')
  assert.equal(downloaded, 'Pump-requirements.csv')
  assert.match(await blob.text(), /REQ-10/)
  assert.doesNotMatch(await blob.text(), /REQ-2|Satisfaction assertions/)
  await click('Clear filters')
  await click('Column filters')
  await change('[aria-label="Filter Requirement column"]', 'minimum')
  assert.deepEqual(names(), ['Minimum flow'])
  await click('Clear filters')
  await act(async () => host.querySelector('[aria-label="Move Requirement column"]').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })))
  assert.equal(byText('thead tr:first-child th', 'Requirement').cellIndex, 1)
  const handle = host.querySelector('[aria-label="Resize Requirement column"]')
  const width = Number(handle.getAttribute('aria-valuenow'))
  await act(async () => handle.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
  assert.equal(Number(handle.getAttribute('aria-valuenow')), width + 16)
  assert.match(localStorage.getItem('skyview-requirement-columns'), /"width":216/)
  await click('Minimum flow')
  await click('Source')
  assert.equal(sourceLine, 12)
  await click('Add satisfaction link')
  assert.equal(satisfied, 'minFlow')
  await click('Add requirement')
  assert.equal(added, 'requirements')
  await click('Details')
  await click('Code')
  const editor = host.querySelector('[aria-label="Documentation Markdown"]')
  await act(async () => {
   Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(editor, '**Updated rationale**')
   editor.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
  await click('Save documentation')
  assert.match(host.querySelector('[role="alert"]').textContent, /Save failed/)
  assert.ok(host.querySelector('[role="dialog"]'), 'failed saves leave the draft open')
  acceptSave = true
  await click('Save documentation')
  assert.deepEqual(patched, ['minFlow', { id: 'minFlow', doc: '**Updated rationale**' }])
  assert.equal(host.querySelector('[role="dialog"]'), null)
 } finally {
  const { act } = await import('react'); if (root) await act(async () => root.unmount())
  URL.createObjectURL = createURL; URL.revokeObjectURL = revokeURL
  globalThis.IS_REACT_ACT_ENVIRONMENT = priorAct
  dom.window.close(); await rm(temp, { recursive: true, force: true })
  for (const [key, descriptor] of descriptors) {
   if (descriptor) Object.defineProperty(globalThis, key, descriptor)
   else delete globalThis[key]
  }
 }
})
