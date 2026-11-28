import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

test('footer identifies the running standard and never hides a missing or mismatched checker', async()=>{
 const dom=new JSDOM('<div id="root"></div>')
 const saved=new Map()
 for(const name of ['window','document','navigator','HTMLElement','Element','Node','fetch','IS_REACT_ACT_ENVIRONMENT'])saved.set(name,Object.getOwnPropertyDescriptor(globalThis,name))
 for(const name of ['window','document','navigator','HTMLElement','Element','Node'])Object.defineProperty(globalThis,name,{configurable:true,value:dom.window[name]})
 globalThis.IS_REACT_ACT_ENVIRONMENT=true
 let result={release:{release:'2026-04',specification:'SysML 2.0 / KerML 1.0',specificationStatus:'published',releaseCommit:'commit-id'},state:'verified',lockSHA256:'lock-id',adapterSHA256:'adapter-id',scope:'Static checks'}
 let fail=false
 globalThis.fetch=async(url)=>{assert.equal(url,'/api/standards');if(fail)throw new Error('Disconnected');return {ok:true,json:async()=>result}}
 const temp=await mkdtemp(fileURLToPath(new URL('./.standards-version-',import.meta.url)))
 let root
 try{
  await build({entryPoints:[fileURLToPath(new URL('../src/components/StandardsVersion.tsx',import.meta.url))],outfile:`${temp}/view.mjs`,bundle:true,packages:'external',format:'esm',platform:'node',jsx:'automatic'})
  const {createElement,act}=await import('react')
  const {createRoot}=await import('react-dom/client')
  const {default:View}=await import(pathToFileURL(`${temp}/view.mjs`).href)
  const host=document.querySelector('#root');root=createRoot(host)
  await act(async()=>root.render(createElement(View)))
  const badge = () => host.querySelector('[data-testid="standards-version"]')
  assert.equal(host.textContent.trim(), 'SysML 2.0 · 2026-04')
  assert.match(badge().getAttribute('aria-label'), /KerML 1.0.*Verified locally/)
  assert.match(badge().title, /Lock: lock-id/)
  result={...result,state:'unavailable',error:'Checksum mismatch'}
  await act(async()=>window.dispatchEvent(new dom.window.Event('focus')))
  assert.match(badge().getAttribute('aria-label'), /Checker unavailable/)
  assert.match(badge().title, /Checksum mismatch/)
  assert.ok(badge().querySelector('svg.status-warning'))
  result={...result,state:'verified',error:undefined,release:{...result.release,release:'2026-09.1',specification:'SysML 2.1 / KerML 1.1',specificationStatus:'preview'}}
  await act(async()=>window.dispatchEvent(new dom.window.Event('focus')))
  assert.match(host.textContent,/2026-09.1 \(preview\)/)
  fail=true
  await act(async()=>window.dispatchEvent(new dom.window.Event('focus')))
  assert.match(host.textContent, /SysML unavailable/)
  assert.match(badge().title, /Disconnected/)
 }finally{
  if(root){const {act}=await import('react');await act(async()=>root.unmount())}
  await rm(temp,{recursive:true,force:true});dom.window.close()
  for(const [name,value]of saved){if(value)Object.defineProperty(globalThis,name,value);else delete globalThis[name]}
 }
})
