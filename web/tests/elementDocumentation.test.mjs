import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

test('inspector previews and saves the same Markdown draft', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const globals = new Map()
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node']) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
  }
  const temp = await mkdtemp(fileURLToPath(new URL('./.inspector-', import.meta.url)))
  const oldAct = globalThis.IS_REACT_ACT_ENVIRONMENT
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let root
  try {
    const outfile = temp + '/Inspector.mjs'
    await build({
      entryPoints: [fileURLToPath(new URL('../src/components/Inspector.tsx', import.meta.url))],
      bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic', outfile,
    })
    const { createElement, act } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { default: Inspector } = await import(pathToFileURL(outfile).href)
    const host = document.querySelector('#root')
    root = createRoot(host)
    const element = { id: 'demo::vehicle', kind: 'part', name: 'vehicle', qname: 'demo::vehicle',
      line: 1, spans: { name: { start: 0, end: 0 }, type: { start: 0, end: 0 } }, doc: '**First draft**' }
    let submitted
    await act(async () => root.render(createElement(Inspector, {
      element, model: { elements: [element], diagnostics: [] },
      onClose() {}, onSelect() {}, onDelete() {}, onShowInSource() {},
      async onPatch(id, patch) { submitted = { id, patch } },
    })))
    const button = label => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === label)
    assert.equal(host.querySelector('.element-doc strong').textContent, 'First draft')
    await act(async () => button('Code').click())
    const editor = host.querySelector('textarea')
    assert.equal(editor.value, element.doc)
    const draft = '# Updated\n\n* A list item\n\n<a href="javascript:void(0)">literal HTML</a>\n\n' +
      '[unsupported](javascript:void(0))\n\n![Image label](https://example.com/image.png)'
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(editor, draft)
      editor.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
    })
    await act(async () => button('Preview').click())
    assert.equal(host.querySelector('.element-doc h1').textContent, 'Updated')
    assert.equal(host.querySelector('.element-doc li').textContent, 'A list item')
    assert.equal(host.querySelector('.element-doc img'), null)
    assert.equal(host.querySelector('.element-doc a[href^="javascript:"]'), null)
    assert.equal(host.querySelector('.element-doc a').textContent, 'Image label')
    assert.equal(submitted, undefined)
    await act(async () => button('Save').click())
    assert.deepEqual(submitted, { id: element.id, patch: { id: element.id, doc: draft } })
    await act(async () => button('Code').click())
    assert.equal(host.querySelector('textarea').value, draft)
  } finally {
    const { act } = await import('react')
    if (root) await act(async () => root.unmount())
    dom.window.close()
    await rm(temp, { recursive: true, force: true })
    globalThis.IS_REACT_ACT_ENVIRONMENT = oldAct
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
