import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import test from 'node:test'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

test('footer distinguishes publisher, version, model revision and hosting in its report', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' })
  const temp = await mkdtemp(fileURLToPath(new URL('./.build-status-', import.meta.url)))
  const globals = new Map(['window', 'document', 'navigator', 'IS_REACT_ACT_ENVIRONMENT']
    .map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  for (const key of ['window', 'document', 'navigator']) {
    Object.defineProperty(globalThis, key, { configurable: true, value: dom.window[key] })
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  let root
  try {
    const output = temp + '/BuildStatus.mjs'
    await build({ entryPoints: [fileURLToPath(new URL('../src/components/BuildStatus.tsx', import.meta.url))],
      outfile: output, bundle: true, packages: 'external', platform: 'node', format: 'esm', jsx: 'automatic' })
    const { act, createElement } = await import('react')
    const { createRoot } = await import('react-dom/client')
    const { default: BuildStatus } = await import(pathToFileURL(output).href)
    const host = document.querySelector('#root')
    root = createRoot(host)

    const buildInfo = {
      version: 'v0.2.0-beta.1', tag: 'v0.2.0-beta.1', official: true, channel: 'beta',
      revision: 'a'.repeat(40), sourceState: 'clean', executableSHA256: 'b'.repeat(64),
      platform: 'linux/amd64', goVersion: 'go1.24.0', repository: 'https://github.com/Rexus/SkyView',
      copyright: '© 2026 Carl Maier and Viktor Ingre', license: 'MIT',
    }
    const props = { about: { mode: 'multi-user', account: 'private-user', build: buildInfo },
      unavailable: false, modelRevision: 'c'.repeat(16),
      standards: { release: { release: '2026-04', specification: 'SysML 2.0', releaseCommit: 'release-sha' },
        lockSHA256: 'lock-hash', adapterSHA256: 'adapter-hash', state: 'verified' } }
    let copied
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      async writeText(value) { copied = value },
    } })
    await act(async () => root.render(createElement(BuildStatus, props)))
    assert.match(host.textContent, /Official beta/)
    assert.match(host.textContent, /Hosted multi-user/)
    const attribution = host.querySelector('.build-copyright')
    const version = host.querySelector('summary')
    assert.equal(attribution.href, buildInfo.repository)
    assert.equal(attribution.textContent.trim(), '© SkyView')
    assert.match(attribution.title, /Carl Maier and Viktor Ingre/)
    assert.equal(version.textContent.trim(), 'v0.2.0-beta.1')
    assert.match(version.getAttribute('aria-label'), /Official beta/)
    await act(async () => version.click())
    assert.equal(host.querySelector('details').open, true)
    assert.match(host.querySelector('.build-status-panel').textContent, new RegExp(props.modelRevision))
    await act(async () => host.querySelector('button').click())
    const report = JSON.parse(copied)
    assert.equal(report.build.revision, buildInfo.revision)
    assert.equal(report.modelRevision, props.modelRevision)
    assert.equal(report.sysml.lockSHA256, 'lock-hash')
    assert.equal(report.deployment, 'multi-user')
    assert.doesNotMatch(copied, /private-user/)

    await act(async () => root.render(createElement(BuildStatus, {
      ...props, about: { ...props.about, mode: 'single-user',
        build: { ...buildInfo, tag: undefined, official: false, revision: undefined, sourceState: 'unknown' } },
    })))
    assert.match(host.textContent, /Unofficial build/)
    assert.match(host.textContent, /Local single-user/)
    assert.match(host.textContent, /Unknown/)
    assert.doesNotMatch(host.textContent, /Official beta/)
  } finally {
    if (root) {
      const { act } = await import('react')
      await act(async () => root.unmount())
    }
    dom.window.close()
    await rm(temp, { recursive: true, force: true })
    for (const [key, descriptor] of globals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
})
