import {setupFlowDOM,sceneFor} from './flowDom.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

test('One diagram picker exposes automatic and saved layouts and edits presentation independently of source', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/?project=test', pretendToBeVisual: true })
  const globals = new Map()
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'location', 'history', 'localStorage', 'Window', 'Text', 'MutationObserver']) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
  }
  setupFlowDOM(dom,globals)
  const rect = () => ({ x: 0, y: 0, top: 0, left: 0, bottom: 20, right: 300, width: 300, height: 20 })
  dom.window.Range.prototype.getBoundingClientRect = rect
  dom.window.Range.prototype.getClientRects = () => [rect()]
  const originalFetch = globalThis.fetch, originalAct = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const temp = await mkdtemp(fileURLToPath(new URL('./.diagram-workspace-', import.meta.url)))
  let root
  try {
    await build({ stdin: { contents: 'export {default} from "../src/components/DiagramWorkspace"; export {useModelViews} from "../src/modelViews"; export {default as App} from "../src/App"', resolveDir: fileURLToPath(new URL('.', import.meta.url)) }, outfile: `${temp}/DiagramWorkspace.mjs`, bundle: true, packages: 'external', format: 'esm', platform: 'node', jsx: 'automatic', loader: { '.css': 'empty' } })
    const { createElement, useState, act } = await import('react'), { createRoot } = await import('react-dom/client')
    const { default: DiagramWorkspace, useModelViews, App } = await import(pathToFileURL(`${temp}/DiagramWorkspace.mjs`).href)
    const config = { version: 2, views: [{ id: 'overview', title: 'System Overall', owner: '.', subject: 'SYS', presentation: true, width: 600, height: 400,
      boundaries: [{ id: 'zone', label: 'Zone', x: 20, y: 20, width: 500, height: 300 }],
      nodes: [{ element: 'A', parent: 'zone', x: 50, y: 80, width: 160, height: 80 }], edges: [] }] }
    let lastPreview, savedConfig
    globalThis.fetch = async (url, options = {}) => {
      if (options.method === 'POST') lastPreview = JSON.parse(options.body)
      if (options.method === 'PUT') { savedConfig = JSON.parse(options.body); return Response.json(savedConfig, {headers: {ETag: 'saved'}}) }
      if (url.includes('Empty.sysml')) return Response.json({ error: 'no shared views' }, { status: 404 })
      return options.method === 'POST' ? Response.json(sceneFor(JSON.parse(options.body))) : Response.json(config, { headers: { ETag: 'views-one' } })
    }
    const host = document.querySelector('#root'); root = createRoot(host)
    const file = { name: 'Model.sysml', content: 'package Test { part existing; }', revision: 'source-one', model: { elements: [{id: 'existing', shortName: 'EX', qname: 'Test::existing', name: 'Existing part', kind: 'part'}] } }
    let actions
    const settingsHost = document.createElement('div'); host.after(settingsHost)
    const receiveActions = value => { actions = value }
    function Harness({ model, settingsHost }) {
      const [view, setView] = useState(() => new URLSearchParams(location.search).get('view'))
      const catalog = useModelViews(model.name)
      return createElement(DiagramWorkspace, {
        file: model, view, catalog: catalog.data, catalogError: catalog.error,
        onOpen: setView, onSelected: setView, onSaved: saved => catalog.publish(model.name, saved), onDirtyChange: () => {},
        onActions: receiveActions, settingsHost,
      }, navigation => createElement('div', { id: 'model-diagram' }, navigation))
    }
    const render = (model, key, target) => act(async () => root.render(createElement(Harness, { model, key, settingsHost: target })))
    const picker = () => host.querySelector('[aria-label="Diagram view"]')
    const choose = value => act(async () => {
      picker().value = value
      picker().dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    const pause = () => act(() => new Promise(resolve => setTimeout(resolve, 200)))
    const click = async name => act(async () => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === name).click())
    await render(file, 'first'); await pause()
    assert.ok(host.querySelector('#model-diagram'))
    assert.equal(picker().value, 'model')
    assert.equal([...picker().options].find(option => option.value === 'view:overview').textContent, 'System Overall')
    await choose('view:overview'); await pause()
    assert.equal(picker().value, 'view:overview')
    assert.ok(host.querySelector('[aria-label="Diagram viewport tools"]'))
    const pan = host.querySelector('[aria-label="Pan diagram"]')
    await act(async () => pan.click())
    assert.equal(pan.getAttribute('aria-pressed'), 'true')
    assert.ok(host.querySelector('.diagram-canvas.pan-mode'))
    await act(async () => host.querySelector('[aria-label="Select elements"]').click())
    assert.equal(pan.getAttribute('aria-pressed'), 'false')
    await act(async () => host.querySelector('[aria-label="Settings for Zone"]').click())
    await act(async () => { const choice = [...host.querySelectorAll('label')].find(l => l.firstChild?.textContent === 'Arrangement').querySelector('select'); choice.value = 'grid'; choice.dispatchEvent(new dom.window.Event('change', { bubbles: true })) })
    await pause()
    assert.equal(lastPreview.views[0].boundaries[0].layout.pattern, 'grid')
    await choose('model')
    assert.ok(host.querySelector('#model-diagram'))
    await choose('view:overview'); await pause()
    assert.equal(lastPreview.views[0].boundaries[0].layout, undefined)
    assert.equal(picker().value, 'view:overview')
    // A reused element changes only the view selection, preserving the accepted layout.
    const source = file.content
    await act(async () => actions.addElement('existing')); await pause()
    assert.equal(lastPreview.views[0].nodes.length, 2)
    assert.equal(lastPreview.views[0].nodes[0].x, 50)
    assert.equal(lastPreview.views[0].nodes[1].element, 'EX')
    assert.equal(file.content, source)
    await act(async () => actions.addElement('existing')); await pause()
    assert.equal(lastPreview.views[0].nodes.length, 2, 'reuse is idempotent')
    await click('View settings')
    assert.equal(host.querySelector('input[type="color"]'), null, 'workspace layout cannot override model colours')
    await act(async () => {
      const arrangement = [...host.querySelectorAll('label')].find(label => label.firstChild?.textContent === 'Arrangement').querySelector('select')
      arrangement.value = 'horizontal'
      arrangement.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    await pause()
    assert.equal(lastPreview.views[0].layout.pattern, 'horizontal')
    await click('Save views'); await pause()
    assert.equal(savedConfig.views[0].layout.pattern, 'horizontal')
    assert.equal(file.content, source)
    // Settings are movable UI, not an extra diagram category; a portal keeps drafts intact.
    await render(file, 'first', settingsHost)
    await pause()
    assert.ok(settingsHost.querySelector('[aria-label="Presentation settings"]'))

    dom.reconfigure({ url: 'http://localhost/?project=test&view=overview' })
    await render(file, 'deep-link'); await pause()
    assert.equal(picker().value, 'view:overview', 'existing view links remain supported')
    dom.reconfigure({ url: 'http://localhost/?project=test' })
    await render({ ...file, name: 'Empty.sysml' }, 'no-sidecar'); await pause()
    assert.ok(host.querySelector('#model-diagram'), 'models without custom views retain the automatic diagram')

    // Exercise routing and the discard guard through the actual application.
    dom.reconfigure({ url: 'http://localhost/?project=test&file=Model.sysml&view=overview' })
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: dom.window.localStorage })
    const partName = file.content.indexOf('existing')
    const appConfig = structuredClone(config)
    appConfig.views[0].nodes[0].element = 'existing'
    appConfig.views.push(
      { ...appConfig.views[0], id: 'logical', title: 'Subsystem | Logical design', owner: 'subsystem', subject: 'EX',
        nodes: [{ element: 'inner', x: 70, y: 90, width: 160, height: 80 }], boundaries: [] },
      { ...appConfig.views[0], id: 'solution', title: 'Subsystem | Solution design', owner: 'subsystem/solution', subject: 'Test::existing',
        nodes: [{ element: 'inner', x: 100, y: 90, width: 160, height: 80 }], boundaries: [] },
    )
    const { EditorView } = await import('@codemirror/view')
    const appElements = [{ id: 'root', kind: 'root', name: 'Model', qname: 'Model' },
      { id: 'pkg', kind: 'package', name: 'Test', qname: 'Test', children: ['existing'], parentId: 'root' },
      { id: 'requirement', name: 'Mission requirement', qname: 'Test::req', shortName: 'REQ', parentId: 'pkg', kind: 'requirement' },
      { ...file.model.elements[0], parentId: 'pkg', children: ['inner'] },
      { id: 'inner', name: 'Inner part', qname: 'Test::existing::inner', kind: 'part', parentId: 'existing' }].map(element => ({
      ...element, isDef: false, line: 1, col: 1, spans: { bodyOpen: -1, bodyClose: -1, name: element.id === 'existing' ? { start: partName, end: partName + 8 } : { start: 0, end: 0 },
        type: { start: 0, end: 0 },
        decl: element.id === 'existing' ? { start: file.content.indexOf('part'), end: file.content.indexOf(';') + 1 } : { start: 0, end: 0 } },
    }))
    const appFile = { ...file, diagnostics: [], model: { ...file.model, rootId: 'root', rootName: 'Model',
      elements: appElements, diagnostics: [], imports: [] } }
    const otherFile = { ...appFile, name: 'Other.sysml', revision: 'source-other' }
    globalThis.fetch = async (input, options = {}) => {
      const url = new URL(input, location.href)
      const path = url.pathname
      if (path.endsWith('/views/preview') && options.method === 'POST') {
        lastPreview = JSON.parse(options.body)
        return Response.json(sceneFor(lastPreview, url.searchParams.get('view')))
      }
      if (path.endsWith('/Other.sysml/views')) return Response.json({ error: 'no shared views' }, { status: 404 })
      if (path.endsWith('/views') && options.method === 'PUT') return Response.json(JSON.parse(options.body), { headers: { ETag: 'views-two' } })
      if (path.endsWith('/views')) return Response.json(appConfig, { headers: { ETag: 'views-one' } })
      if (path.endsWith('/validate')) return Response.json({ diagnostics: [] })
      if (path.endsWith('/palette')) return Response.json({ keywords: [], colours: {}, revision: 'palette-one' })
      if (path.endsWith('/diagram/nodes')) return Response.json({})
      if (path.endsWith('/files')) return Response.json({ files: [{name: appFile.name}, {name: otherFile.name}] })
      if (path.endsWith('/' + otherFile.name)) return Response.json(otherFile)
      if (path.endsWith('/' + appFile.name)) return Response.json(appFile)
      if (path === '/api/projects') return Response.json({ projects: [] })
      if (path === '/api/examples') return Response.json({ examples: [] })
      return Response.json({ error: 'Unavailable' }, { status: 404 })
    }
    await act(async () => root.render(createElement(App)))
    await pause()
    assert.equal(picker().value, 'view:overview')
    const tabStrip = () => host.querySelector('[aria-label="Open diagrams"]')
    assert.equal(tabStrip(), null, 'a diagram deep link starts in the browsing view')
    const projectView = title => [...host.querySelectorAll('.project-tree button')].find(button => button.textContent.trim() === title)
    const projectTab = async entry => {
      await act(async () => entry.dispatchEvent(new dom.window.MouseEvent('contextmenu', {
        bubbles: true, cancelable: true, clientX: 100, clientY: 90,
      })))
      const menu = document.querySelector('[aria-label="Project diagram actions"]')
      assert.equal(menu.textContent, 'Open in new tab')
      await act(async () => menu.querySelector('button').click())
      await pause()
    }
    await act(async () => projectView('Subsystem | Solution design').click()); await pause()
    assert.equal(picker().value, 'view:solution')
    assert.equal(tabStrip(), null, 'single clicks in the project keep the diagram in place')
    await choose('view:overview'); await pause()
    assert.equal(tabStrip(), null, 'the diagram picker does not add a tab')
    await projectTab(projectView('System Overall'))
    assert.equal(tabStrip().querySelectorAll('.diagram-tab').length, 1)
    assert.ok(host.querySelector('.diagram-scope-frame'))
    assert.ok(host.querySelector('.topbar #active-workspace'))
    assert.equal(host.querySelector('.topbar .action-menu'), null)
    assert.doesNotMatch(host.querySelector('.topbar').textContent, /Model\.sysml/)
    const modelMenu = host.querySelector('.project-tree [aria-label="Model actions"]')
    await act(async () => modelMenu.click())
    await click('New model')
    assert.match(host.querySelector('[role="dialog"]').textContent, /New model/)
    await click('Cancel')
    await click('Split')
    assert.ok(host.querySelector('.split-panes .source-pane'))
    assert.ok(host.querySelector('.split-panes .diagram-pane'))
    const sidebar = host.querySelector('#workbench-sidebar')
    const toggle = host.querySelector('#sidebar-toggle')
    const code = host.querySelector('.cm-editor')
    await act(async () => toggle.click())
    assert.equal(sidebar.hidden, true)
    assert.equal(toggle.getAttribute('aria-expanded'), 'false')
    assert.equal(localStorage.getItem('skyview-sidebar-visible'), 'false')
    assert.ok(host.querySelector('#active-workspace'), 'the workspace picker stays in the header')
    const shortcut = new dom.window.KeyboardEvent('keydown', {
      key: 'b', ctrlKey: true, bubbles: true, cancelable: true,
    })
    await act(async () => code.querySelector('.cm-content').dispatchEvent(shortcut))
    assert.equal(shortcut.defaultPrevented, true)
    assert.equal(sidebar.hidden, false)
    assert.equal(host.querySelector('.cm-editor'), code, 'reopening the sidebar preserves the editor')
    assert.equal(picker().value, 'view:overview')
    const separator = host.querySelector('[role="separator"]')
    await act(async () => separator.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    assert.equal(separator.getAttribute('aria-valuenow'), '52')
    const box = () => host.querySelector('.native-diagram-node[data-native-id="existing"]')
    const diagramTab = name => [...host.querySelectorAll('.diagram-tab-open')].find(button => button.textContent.trim() === name)
    await act(async () => box().dispatchEvent(new dom.window.MouseEvent('dblclick', { bubbles: true })))
    await pause()
    assert.equal(picker().value, 'view:logical', 'double-click follows the subject to its overview')
    assert.ok(host.querySelector('[data-native-id="inner"]'), 'the clicked route shows the subsystem’s own contents')
    assert.equal(diagramTab('Subsystem | Logical design').getAttribute('aria-current'), 'page')
    assert.ok(diagramTab('System Overall'), 'the previous diagram stays open')
    await act(async () => diagramTab('System Overall').click()); await pause()
    await act(async () => box().click())
    assert.equal(host.querySelector('.cm-linked-declaration')?.textContent, 'existing')
    const editor = EditorView.findFromDOM(host.querySelector('.cm-editor'))
    await act(async () => editor.dispatch({ selection: { anchor: 0 } }))
    await act(async () => editor.dispatch({ selection: { anchor: partName } }))
    assert.ok(box().classList.contains('selected'))
    await act(async () => editor.dispatch({ changes: { from: editor.state.doc.length, insert: '\n// draft' } }))
    await choose('model')
    assert.equal(tabStrip().querySelectorAll('.diagram-tab').length, 2, 'browsing does not add a third tab')
    assert.equal(host.querySelector('[role="dialog"]'), null)
    assert.equal(EditorView.findFromDOM(host.querySelector('.cm-editor')), editor)
    assert.match(editor.state.doc.toString(), /draft/)
    await click('Source')
    assert.equal(EditorView.findFromDOM(host.querySelector('.cm-editor')), editor)
    assert.match(editor.state.doc.toString(), /draft/)
    await click('Split')
    await choose('view:overview'); await pause()
    assert.match(editor.state.doc.toString(), /draft/)
    await click('Revert')
    await click('Elements')
    const requirement = [...host.querySelectorAll('.tree-row[draggable="true"]')].find(row => row.textContent.includes('Mission requirement'))
    assert.ok(requirement)
    const data = new Map()
    const transfer = {
      get types() { return [...data.keys()] },
      setData(kind, text) { data.set(kind, text) },
      getData(kind) { return data.get(kind) ?? '' },
    }
    const drag = (type, target) => {
      const event = new dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientX: 690, clientY: 120 })
      Object.defineProperty(event, 'dataTransfer', { value: transfer })
      return target.dispatchEvent(event)
    }
    await act(async () => drag('dragstart', requirement))
    const canvas = host.querySelector('.diagram-pane .diagram-canvas')
    await act(async () => {
      assert.equal(drag('dragover', canvas), false)
      assert.equal(drag('drop', canvas), false)
    })
    await pause()
    assert.ok(lastPreview.views[0].nodes.some(node => node.element === 'REQ'))
    assert.ok(host.querySelector('[data-view-key="REQ"]'))
    assert.equal(editor.state.doc.toString(), file.content)
    await click('Revert')
    await act(async () => toggle.click())
    assert.equal(sidebar.hidden, true)
    await click('View settings')
    assert.equal(sidebar.hidden, false, 'a diagram settings action reveals its panel')
    assert.ok(host.querySelector('.layout-settings-host [aria-label="Presentation settings"]'))
    const arrangement = host.querySelector('.layout-settings-host [aria-label="Settings target"]').parentElement.parentElement
    const layout = [...arrangement.querySelectorAll('label')].find(label => label.firstChild?.textContent === 'Arrangement').querySelector('select')
    await act(async () => {
      layout.value = 'horizontal'
      layout.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    const dirty = name => diagramTab(name)?.getAttribute('aria-label').includes('unsaved changes')
    assert.equal(dirty('System Overall'), true)
    await act(async () => diagramTab('Subsystem | Logical design').click()); await pause()
    assert.equal(host.querySelector('[role="dialog"]'), null)
    assert.equal(dirty('System Overall'), true, 'opening a related diagram preserves the layout draft')
    await click('View settings')
    const logicalArrangement = [...host.querySelectorAll('.layout-settings-host label')].find(label => label.firstChild?.textContent === 'Arrangement').querySelector('select')
    await act(async () => {
      logicalArrangement.value = 'vertical'
      logicalArrangement.dispatchEvent(new dom.window.Event('change', { bubbles: true }))
    })
    assert.equal(dirty('Subsystem | Logical design'), true)
    await click('Projects')
    const otherModel = () => host.querySelector('.project-file[title="Other.sysml"]')
    await act(async () => otherModel().click()); await pause()
    assert.equal(diagramTab('Other diagram'), undefined)
    assert.equal(picker().value, 'model')
    await projectTab(otherModel())
    assert.equal(diagramTab('Other diagram').getAttribute('aria-current'), 'page')
    assert.equal(dirty('System Overall'), true, 'drafts survive opening another source file')
    await act(async () => diagramTab('Subsystem | Logical design').click()); await pause()
    const menu = async name => act(async () => diagramTab(name).dispatchEvent(new dom.window.MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, clientX: 225, clientY: 55,
    })))
    const chooseAction = async name => act(async () => [...document.querySelectorAll('.diagram-tab-menu button')].find(button => button.textContent === name).click())
    const confirmations = []
    let accept = false
    dom.window.confirm = message => { confirmations.push(message); return accept }
    await menu('System Overall'); await chooseAction('Close')
    assert.equal(dirty('System Overall'), true, 'cancel keeps the tab and draft')
    assert.match(confirmations.at(-1), /Discard unsaved diagram changes/)
    accept = true
    await menu('System Overall'); await chooseAction('Close')
    assert.equal(diagramTab('System Overall'), undefined)
    assert.equal(dirty('Subsystem | Logical design'), true, 'closing one view leaves the other draft intact')
    await choose('view:overview'); await pause()
    assert.equal(diagramTab('System Overall'), undefined, 'reopening through the picker uses the browsing view')
    assert.equal(picker().selectedOptions[0].textContent, 'System Overall', 'reopening restores the saved layout')
    await click('Save views')
    assert.equal(dirty('Subsystem | Logical design'), false, 'saving clears the indicator across the file’s tabs')
    await act(async () => diagramTab('Subsystem | Logical design').click()); await pause()
    await menu('Subsystem | Logical design'); await chooseAction('Close all')
    assert.equal(host.querySelector('[aria-label="Open diagrams"]'), null)
    assert.equal(picker().value, 'closed')
    await choose('model')
    assert.equal(picker().value, 'model')
    assert.equal(new URLSearchParams(location.search).has('view'), false)
    assert.equal(host.querySelector('.workbench-tabs [aria-label="Grid"]'), null)
    await click('Grid')
    assert.ok(host.querySelector('.viewbar .tab.active').textContent.includes('Grid'))
    assert.ok(host.querySelector('table.grid'))
    await click('Projects')
    assert.ok(host.querySelector('table.grid'), 'changing navigator panels keeps the main view')
    await click('Diagram')
    assert.equal(picker().value, 'model')
    assert.equal(host.querySelector('.workbench-tabs [aria-label="Projects"]').getAttribute('aria-pressed'), 'true')
    await act(async () => toggle.click())
    await act(async () => root.render(createElement(App, { key: 'reopened' })))
    await pause()
    assert.equal(host.querySelector('#workbench-sidebar').hidden, true, 'visibility is restored across app loads')
    assert.equal(host.querySelector('#sidebar-toggle').getAttribute('aria-label'), 'Show sidebar')
  } finally {
    const { act } = await import('react'); if (root) await act(async () => root.unmount())
    dom.window.close(); await rm(temp, { recursive: true, force: true })
    globalThis.fetch = originalFetch; globalThis.IS_REACT_ACT_ENVIRONMENT = originalAct
    for (const [key, descriptor] of globals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key] }
  }
})
