import { mkdtemp, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import test from 'node:test'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'
import { setupFlowDOM } from './flowDom.mjs'

test('Auto layout fits the new diagram after the cards are measured', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/', pretendToBeVisual: true })
  const globals = new Map()
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'Node', 'location', 'MutationObserver']) {
    globals.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
  }
  setupFlowDOM(dom, globals)
  // React Flow's renderer uses 100% dimensions, which fill a 900 x 600 test canvas.
  Object.defineProperties(dom.window.HTMLElement.prototype, {
    offsetWidth: { configurable: true, get() { return this.style.width.endsWith('px') ? parseFloat(this.style.width) : 900 } },
    offsetHeight: { configurable: true, get() {
      if (this.matches('.diagram-scope-frame > span')) return 20
      return this.style.height.endsWith('px') ? parseFloat(this.style.height) : 600
    } },
  })
  globals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'))
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  const temp = await mkdtemp(fileURLToPath(new URL('./.diagram-fit-', import.meta.url)))
  let root
  let act
  try {
    const bundle = temp + '/DiagramCanvas.mjs'
    await build({
      entryPoints: [fileURLToPath(new URL('../src/components/DiagramCanvas.tsx', import.meta.url))],
      outfile: bundle, bundle: true, packages: 'external', format: 'esm', platform: 'node', jsx: 'automatic',
    })
    const React = await import('react')
    act = React.act
    const { createRoot } = await import('react-dom/client')
    const { default: DiagramCanvas } = await import(pathToFileURL(bundle).href)
    const host = document.querySelector('#root')
    root = createRoot(host)
    let flow
    const measured = { width: 160, height: 80 }
    const original = [
      { id: 'a', position: { x: 30, y: 50 }, measured, data: { label: 'A' } },
      { id: 'b', position: { x: 240, y: 180 }, measured, data: { label: 'B' } },
    ]
    const arranged = [
      { ...original[0], position: { x: -450, y: -350 } },
      { ...original[1], position: { x: 730, y: 490 } },
    ]
    const render = (nodes, fitRevision) => act(async () => {
      root.render(React.createElement(DiagramCanvas, {
        nodes, edges: [], fitRevision, frameTitle: 'Mechanics', onInit: value => { flow = value },
      }))
    })
    const settle = () => act(() => new Promise(resolve => setTimeout(resolve, 260)))
    const fit = () => host.querySelector('[aria-label="Fit diagram to window"]')
    await render(original, 0)
    await settle()
    assert.ok(flow.viewportInitialized)
    await act(async () => fit().click())
    await settle()
    const before = flow.getViewport()
    const captionTop = ({ y, zoom }, top) => y + (top - 28 - 20) * zoom
    assert.ok(captionTop(before, original[0].position.y) >= 0, 'fit includes the diagram title')

    await render(arranged.map(node => ({ ...node, measured: undefined })), 1)
    await settle()
    assert.deepEqual(flow.getViewport(), before, 'the fit request must stay pending while card sizes are missing')

    await render(arranged, 1)
    await settle()
    const automatic = flow.getViewport()
    assert.notDeepEqual(automatic, before, 'measurement should complete the pending fit')
    assert.ok(captionTop(automatic, arranged[0].position.y) >= 0)
    assert.ok(captionTop(automatic, arranged[0].position.y) < 45, 'fit uses the canvas without an extra toolbar gutter')
    await act(async () => fit().click())
    await settle()
    assert.deepEqual(flow.getViewport(), automatic, 'manual and automatic fits should use the same new bounds')
  } finally {
    if (root) await act(async () => root.unmount())
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
    dom.window.close()
    await rm(temp, { recursive: true, force: true })
  }
})
