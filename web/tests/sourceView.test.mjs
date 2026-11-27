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
    let saves = 0
    const source = 'package Example {\n  part rover : Vehcle;\n}'
    const from = source.indexOf('Vehcle')
    const diagnostic = { severity: 'warning', message: 'Unresolved type Vehcle',
      range: { start: from, end: from + 6 }, line: 2, column: 16, hint: 'Check the type name.' }
    const props = {
      file: { name: 'Example.sysml', content: source, revision: 'one', diagnostics: [], elements: [] },
      jumpLine: null, jumpNonce: 0, saving: false,
      onSave: async () => { saves++ }, onDirtyChange: () => {},
      onOpenHistory: () => {}, onDownload: () => {},
      onValidate: content => new Promise((resolve, reject) => requests.push({ content, resolve, reject })),
    }
    const pause = ms => act(() => new Promise(resolve => setTimeout(resolve, ms)))
    const validate = async () => {
      const button = [...host.querySelectorAll('button')].find(b => /^(Validate|Checking…)$/.test(b.textContent.trim()))
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
    await act(async () => host.querySelector('.diag-item').click())
    let view = EditorView.findFromDOM(host.querySelector('.cm-editor'))
    assert.equal(view.state.selection.main.from, from)
    assert.equal(view.state.selection.main.to, from + 6)

    await edit(source.replace('Vehcle', 'Missing'))
    await validate()
    assert.equal(requests.length, 2)
    assert.match(requests[1].content, /Missing/, 'validation uses the unsaved draft')
    await edit('package Correct { part def Vehicle; }')
    await validate()
    assert.equal(requests.length, 3)
    await act(async () => requests[2].resolve([]))
    await act(async () => requests[1].resolve([diagnostic]))
    assert.equal(diagnosticCount(view.state), 0, 'a delayed older response cannot restore diagnostics')
    assert.match(host.querySelector('[role=status]').textContent, /No issues found/)

    await validate()
    await act(async () => requests[3].reject(new Error('Server disconnected')))
    assert.match(host.querySelector('[role=status]').textContent, /Validation unavailable: Server disconnected/)
    assert.doesNotMatch(host.querySelector('[role=status]').textContent, /No issues found/)

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
