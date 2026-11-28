import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

test('project controls preserve drafts, expose import choices and scope every file request', async () => {
 const dom = new JSDOM('<div id="top"></div><div id="root"></div>', { url: 'http://localhost/?project=project-a', pretendToBeVisual: true })
 const saved = new Map()
 for (const name of ['window','document','navigator','HTMLElement','Element','Node','location','FormData','File']) {
  saved.set(name,Object.getOwnPropertyDescriptor(globalThis,name))
  Object.defineProperty(globalThis,name,{configurable:true,value:dom.window[name]})
 }
 const previousFetch=globalThis.fetch, previousAct=globalThis.IS_REACT_ACT_ENVIRONMENT
 const calls=[]
 globalThis.IS_REACT_ACT_ENVIRONMENT=true
 globalThis.fetch=async (url,init={})=>{
  calls.push({url,init})
  const data = url==='/api/projects' && init.method==='POST' ? {id:'project-new',name:'Drone',workspaceId:'workspace-design',origin:{kind:'example'}} :
   url==='/api/projects' ? {workspaces:[{id:'default',name:'Default workspace'},{id:'workspace-design',name:'Design'}],projects:[{id:'project-a',name:'Cart',workspaceId:'workspace-design',origin:{kind:'upload'}},{id:'project-b',name:'Other',workspaceId:'workspace-design',origin:{kind:'new'}},{id:'workspace',name:'Workspace files',origin:{kind:'legacy'}}]} :
   url==='/api/examples' ? {examples:[{id:'inspection-drone',name:'Drone'}]} : {}
  if (url.endsWith('/export')) return {ok:false,json:async()=>({error:'Project exceeds export limits'})}
  return {ok:true,json:async()=>data,text:async()=>JSON.stringify(data)}
 }
 const temp=await mkdtemp(fileURLToPath(new URL('./.projects-',import.meta.url)))
 let root,act
 try {
  await build({entryPoints:[fileURLToPath(new URL('../src/components/ProjectBar.tsx',import.meta.url)),fileURLToPath(new URL('../src/api.ts',import.meta.url))],outdir:temp,bundle:true,packages:'external',format:'esm',platform:'node',jsx:'automatic',outExtension:{'.js':'.mjs'},loader:{'.css':'empty'}})
  const React=await import('react');act=React.act
  const {createRoot}=await import('react-dom/client')
  const {default:ProjectBar}=await import(pathToFileURL(`${temp}/components/ProjectBar.mjs`).href)
  const host=document.querySelector('#root');root=createRoot(host)
  await act(async()=>root.render(React.createElement(ProjectBar,{sourceDirty:true,saving:false,workspaceHost:document.querySelector('#top')})))
  assert.equal(document.querySelector('#top #active-workspace').value,'workspace-design','a direct older project link resolves its workspace')
  assert.deepEqual([...host.querySelector('#active-project').options].map(option=>option.value),['project-a','project-b'],'the project list is scoped to the header selection')
  await act(async()=>{const select=document.querySelector('#active-workspace');select.value='default';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}))})
  assert.match(host.textContent,/Discard unsaved changes/,'switching workspaces protects the current draft')
  await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent.trim()==='Cancel').click())
  assert.equal(document.querySelector('#active-workspace').value,'workspace-design')
  assert.equal(host.querySelector('#active-project').value,'project-a')
  await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent.trim()==='Export project').click())
  assert.equal(calls.at(-1).url,'/api/projects/project-a/export')
  assert.match(host.querySelector('[role=alert]').textContent,/exceeds export limits/,'failed export stays in the editor')
  await act(async()=>{const select=host.querySelector('select');select.value='project-b';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}))})
  assert.match(host.textContent,/Discard unsaved changes/)
  const click=async text=>act(async()=>{
   const button=[...host.querySelectorAll('button')].find(b=>b.textContent.trim()===text)
   assert.ok(button,`missing ${text}`);button.click()
  })
  await click('Cancel')
  assert.equal(host.querySelector('#active-project').value,'project-a','cancel keeps current project')
  await click('Add project')
  await click('Use example')
  const created=calls.find(c=>c.init.method==='POST')
  assert.deepEqual(JSON.parse(created.init.body),{name:'Drone',example:'inspection-drone',workspaceId:'workspace-design'})
  assert.match(host.textContent,/Discard unsaved changes/,'creating a project also protects drafts')
  await click('Cancel')
  await click('Git snapshot')
  assert.match(host.textContent,/Branch, tag or commit/)
  assert.match(host.textContent,/Directory inside repository/)
  await click('Upload ZIP')
  assert.ok(host.querySelector('input[type=file]'))
  assert.match(host.textContent,/Directory inside archive/)
  const api=await import(pathToFileURL(`${temp}/api.mjs`).href)
  dom.reconfigure({url:'http://localhost/?project=project-b'})
  await api.createFile('models/New.sysml')
  assert.deepEqual(JSON.parse(calls.at(-1).init.body),{name:'models/New.sysml'},'new files use the server starter')
  await api.createFile('models/Empty.sysml','')
  assert.equal(JSON.parse(calls.at(-1).init.body).content,'','explicit empty imports remain verbatim')
  await api.getFile('models/Plant.sysml')
  assert.equal(calls.at(-1).url,'/api/projects/project-a/files/models%2FPlant.sysml','old page cannot retarget outstanding requests')
  await act(async()=>root.unmount());root=null
 } finally {
  if(root) await act(async()=>root.unmount())
  await rm(temp,{recursive:true,force:true});dom.window.close()
  for(const [name,descriptor] of saved){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name]}
  globalThis.fetch=previousFetch;globalThis.IS_REACT_ACT_ENVIRONMENT=previousAct
 }
})
