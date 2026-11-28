import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

test('source validation highlights drafts, explains fixes and rejects obsolete results', async () => {
  const dom = new JSDOM('<div id="root"></div>', { pretendToBeVisual: true })
  const savedGlobals = new Map()
  for (const name of ['window', 'Window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'Text',
    'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    savedGlobals.set(name, Object.getOwnPropertyDescriptor(globalThis, name))
    Object.defineProperty(globalThis, name, { configurable: true, value: dom.window[name] })
  }
  // jsdom has no layout engine. Supply rectangles for CodeMirror's measurement;
  // these checks verify behavior and tooltip content, not visual positioning.
  const rect = () => ({ x: 0, y: 0, top: 0, left: 0, bottom: 20, right: 300, width: 300, height: 20 })
  dom.window.Range.prototype.getBoundingClientRect = rect
  dom.window.Range.prototype.getClientRects = () => [rect()]
  const temp = await mkdtemp(fileURLToPath(new URL('./.source-view-', import.meta.url)))
  let root
  const previousAct = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  try {
    await build({
      entryPoints: [fileURLToPath(new URL('../src/components/SourceView.tsx', import.meta.url))],
      outfile: `${temp}/SourceView.mjs`, bundle: true, packages: 'external',
      format: 'esm', platform: 'node', jsx: 'automatic',
    })
    const { createElement, act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { EditorView } = await import('@codemirror/view')
    const { diagnosticCount } = await import('@codemirror/lint')
    const { default: SourceView } = await import(pathToFileURL(`${temp}/SourceView.mjs`).href)
    const host = document.querySelector('#root')
    root = createRoot(host)
    const requests = []
    const nativeRequests = []
    let saves = 0
    let caretElement
    const source = 'package Example {\n  part rover : Vehcle;\n}'
    const from = source.indexOf('Vehcle')
    const diagnostic = { severity: 'warning', message: 'Unresolved type Vehcle',
      range: { start: from, end: from + 6 }, line: 2, column: 16, hint: 'Check the type name.' }
    const props = {
      file: { name: 'Example.sysml', content: source, revision: 'one', diagnostics: [], model: { elements: [
        { id: 'rover', kind: 'part', spans: {
          decl: { start: source.indexOf('part'), end: source.indexOf(';') + 1 },
          name: { start: source.indexOf('rover'), end: source.indexOf('rover') + 5 },
        } },
      ] } },
      linkedElement: { id: 'rover' }, onCaretElement: id => { caretElement = id },
      diagramVisible: true, propertiesAvailable: true, propertiesOpen: false, onToggleProperties: () => {},
      jumpLine: null, jumpNonce: 0, saving: false,
      onSave: async () => { saves++ }, onDirtyChange: () => {},
      onOpenHistory: () => {}, onDownload: () => {},
      onNativeValidate: content => new Promise((resolve, reject) => nativeRequests.push({ content, resolve, reject })),
      onValidate: content => new Promise((resolve, reject) => requests.push({ content, resolve, reject })),
    }
    const pause = ms => act(() => new Promise(resolve => setTimeout(resolve, ms)))
    const validate = async () => {
      const button = [...host.querySelectorAll('button')].find(b => /^(Quick check|Checking…)$/.test(b.textContent.trim()))
      await act(async () => button.click())
      await pause(20)
    }
    const edit = async text => {
      await act(async () => {
        const view = EditorView.findFromDOM(host.querySelector('.cm-editor'))
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } })
        assert.equal(diagnosticCount(view.state), 0, 'an edit immediately removes stale highlights')
      })
    }
    await act(async () => root.render(createElement(SourceView, { ...props, key: 'project-one/Example.sysml' })))
    await pause(550)
    assert.equal(host.querySelector('.cm-linked-declaration')?.textContent, 'part rover : Vehcle;')
    assert.equal(caretElement, undefined, 'revealing a declaration does not report an editor-driven selection')
    assert.equal(requests.length, 1, 'initial source is checked automatically')
    assert.equal(requests[0].content, source)
    await act(async () => requests[0].resolve([diagnostic]))
    assert.equal(host.querySelector('.cm-lintRange-warning')?.textContent, 'Vehcle')
    const marker = host.querySelector('.cm-lint-marker-warning')
    assert.ok(marker, 'the affected line has a gutter marker')
    await act(async () => marker.dispatchEvent(new dom.window.MouseEvent('mouseover', { bubbles: true })))
    await pause(350)
    const tooltip = host.querySelector('.cm-tooltip-lint')
    assert.match(tooltip?.textContent ?? '', /Unresolved type Vehcle/)
    assert.match(tooltip.textContent, /Suggested fix: Check the type name\./)
    const overview = host.querySelector('[aria-label="Scrollbar diagnostics"]')
    assert.match(overview.querySelector('.warning').getAttribute('aria-label'), /Line 2.*Unresolved type Vehcle/)
    await act(async () => overview.querySelector('.warning').click())
    assert.equal(caretElement, 'rover')
    let view = EditorView.findFromDOM(host.querySelector('.cm-editor'))
    assert.equal(view.state.selection.main.from, from)
    assert.equal(view.state.selection.main.to, from + 6)

    await edit(source.replace('Vehcle', 'Missing'))
    assert.equal(overview.querySelectorAll('button').length, 0, 'draft edits clear the overview markers')
    await validate()
    assert.equal(requests.length, 2)
    assert.match(requests[1].content, /Missing/, 'validation uses the unsaved draft')
    await edit('package Correct { part def Vehicle; }')
    await validate()
    assert.equal(requests.length, 3)
    await act(async () => requests[2].resolve([]))
    await act(async () => requests[1].resolve([diagnostic]))
    assert.equal(diagnosticCount(view.state), 0, 'a delayed older response cannot restore diagnostics')
    assert.match(host.querySelector('[data-testid=projection-status]').textContent, /No issues found/)

    await validate()
    await act(async () => requests[3].reject(new Error('Server disconnected')))
    assert.match(host.querySelector('[data-testid=projection-status]').textContent, /Validation unavailable: Server disconnected/)
    assert.doesNotMatch(host.querySelector('[data-testid=projection-status]').textContent, /No issues found/)

    await validate()
    await act(async () => root.render(createElement(SourceView, { ...props,
      key: 'project-two/Example.sysml', file: { ...props.file, content: 'package Second {}' } })))
    await validate()
    assert.equal(requests.length, 6)
    await act(async () => requests[5].resolve([]))
    await act(async () => requests[4].resolve([diagnostic]))
    view = EditorView.findFromDOM(host.querySelector('.cm-editor'))
    assert.equal(view.state.doc.toString(), 'package Second {}')
    assert.equal(diagnosticCount(view.state), 0, 'switching projects discards the previous file result')
    const nativeButton = () => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === 'Native check')
    const nativeStatus = () => host.querySelector('[data-testid=native-status]').textContent
    assert.match(nativeStatus(), /not checked/)
    const nativeResult = { status: 'passed', release: { release: '2026-09.1', releaseContents: 'Pilot baseline' },
      sourceSHA256: '0123456789', filesChecked: 2, diagnostics: [] }
    await act(async () => nativeButton().click())
    assert.equal(nativeRequests[0].content, 'package Second {}')
    await act(async () => nativeRequests[0].resolve(nativeResult))
    assert.match(nativeStatus(), /Official release 2026-09.1: passed.*2 files/)
    await edit('package Third {}')
    assert.match(nativeStatus(), /not checked/, 'editing immediately invalidates the native pass')
    await act(async () => nativeButton().click())
    await edit('package Fourth {}')
    await act(async () => nativeRequests[1].resolve(nativeResult))
    assert.match(nativeStatus(), /not checked/, 'a late native response cannot validate a different draft')
    await act(async () => nativeButton().click())
    await act(async () => nativeRequests[2].resolve({ ...nativeResult, status: 'unavailable', error: 'Missing toolchain' }))
    assert.match(nativeStatus(), /unavailable: Missing toolchain/)
    assert.doesNotMatch(nativeStatus(), /passed/)
    await act(async () => nativeButton().click())
    await act(async () => nativeRequests[3].resolve({ ...nativeResult, status: 'failed', diagnostics: [
      { ...diagnostic, file: 'Elsewhere.sysml', severity: 'error', source: 'Official SysML pilot' },
    ] }))
    assert.match(nativeStatus(), /issues found/)
    assert.match(host.textContent, /Elsewhere.sysml:2/)
    assert.equal(diagnosticCount(view.state), 0, 'errors in another file never underline the active document')
    await pause(40)
    assert.equal(host.querySelectorAll('.source-overview-marker').length, 0)
    await act(async () => nativeButton().click())
    await act(async () => nativeRequests[4].resolve({ ...nativeResult, status: 'failed', diagnostics: [
      { ...diagnostic, file: 'Example.sysml', line: 1, range: { start: 8, end: 14 }, severity: 'error' },
    ] }))
    await pause(40)
    assert.match(host.querySelector('.source-overview-marker.error')?.getAttribute('aria-label') ?? '', /Line 1/)
    await act(async () => host.querySelector('.source-overview-marker.error').click())
    assert.equal(view.state.selection.main.from, 8)
    assert.equal(saves, 0, 'validation never saves source')
    await act(async () => root.unmount())
    root = null
  } finally {
    if (root) root.unmount()
    await rm(temp, { recursive: true, force: true })
    dom.window.close()
    for (const [name, descriptor] of savedGlobals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor)
      else delete globalThis[name]
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousAct
  }
})
