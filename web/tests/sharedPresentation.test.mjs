import {setupFlowDOM,sceneFor} from './flowDom.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

test('boundary controls save local settings, detect conflicts and reopen without changing source', async () => {
 const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/?project=test&file=Model.sysml&view=design', pretendToBeVisual: true })
 const globals = new Map()
 for (const key of ['window','document','navigator','HTMLElement','Element','Node','location','history']) {
  globals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]})
 }
 setupFlowDOM(dom,globals)
 const originalFetch=globalThis.fetch, originalAct=globalThis.IS_REACT_ACT_ENVIRONMENT
 globalThis.IS_REACT_ACT_ENVIRONMENT=true
 const temp=await mkdtemp(fileURLToPath(new URL('./.shared-test-',import.meta.url)))
 let root
 try {
  await build({entryPoints:[fileURLToPath(new URL('../src/components/CustomViews.tsx',import.meta.url))],outfile:`${temp}/CustomViews.mjs`,bundle:true,packages:'external',format:'esm',platform:'node',jsx:'automatic'})
  const {createElement,act}=await import('react'),{createRoot}=await import('react-dom/client')
  const {default:CustomViews}=await import(pathToFileURL(`${temp}/CustomViews.mjs`).href)
  let stored={version:2,views:[{id:'design',title:'Design',owner:'.',subject:'SYS',presentation:true,width:600,height:400,
   boundaries:[{id:'zone',label:'Zone',x:20,y:20,width:500,height:300,layout:{pattern:'horizontal'}}],
   nodes:[{element:'A',parent:'zone',x:50,y:80,width:160,height:80}],edges:[]}]}
  let revision='view-one',conflict=false, holdPreview=false, releasePreview
  const saves=[],previews=[]
  globalThis.fetch=async (url,options={})=>{
   if(options.method==='POST'){previews.push(JSON.parse(options.body));if(holdPreview)await new Promise(resolve=>{releasePreview=resolve});return Response.json(sceneFor(JSON.parse(options.body)))}
   if(options.method==='PUT'){
    saves.push(options)
    if(conflict)return Response.json({error:'view changed; reload before saving'},{status:409})
    stored=JSON.parse(options.body);revision='view-two';return Response.json({ok:true},{headers:{ETag:revision}})
   }
   return Response.json(stored,{headers:{ETag:revision}})
  }
  const host=document.querySelector('#root');root=createRoot(host)
  const file={name:'Model.sysml',revision:'source-one',content:'package S { part a; }',model:{elements:[
  {id:'A',shortName:'A',qname:'S::a',name:'Cache contents',kind:'part'},
  {id:'B',shortName:'B',qname:'S::b',name:'Outside this view',kind:'part'},
 ]}}
  const pause=()=>act(()=>new Promise(r=>setTimeout(r,200)))
  const click=async text=>act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent===text).click())
  const select=async(label,value)=>act(async()=>{const el=[...host.querySelectorAll('label')].find(e=>e.firstChild?.textContent===label)?.querySelector('select');assert.ok(el,label);el.value=value;el.dispatchEvent(new dom.window.Event('change',{bubbles:true}))})
  await act(async()=>root.render(createElement(CustomViews,{file})));await pause()
  const settings=host.querySelector('[aria-label="Settings for Zone"]');assert.ok(settings,'keyboard-accessible boundary button missing')
  await act(async()=>settings.click())
  const editTarget = () => host.querySelector('[aria-label="Settings target"]')
  const highlighted = () => host.querySelector('[data-layout-target="true"]')?.getAttribute('data-view-key')
  assert.deepEqual([...editTarget().options].map(option=>option.textContent),['Whole view','Cache contents','Zone'])
  assert.equal(highlighted(),'zone')
  await select('Layout target','A')
  assert.equal(highlighted(),'A')
  assert.equal(host.querySelector('.shared-settings-head strong').textContent,'Cache contents')
  await act(async()=>host.querySelector('[data-view-key="zone"]').click())
  assert.equal(editTarget().value,'zone')
  holdPreview=true
  await select('Arrangement','grid');await pause()
  assert.match(host.querySelector('[role="status"]').textContent,/Updating preview/)
  assert.ok(host.querySelector('svg'),'slow preview blanked the previous valid drawing')
  assert.equal(host.querySelector('.react-flow__node').classList.contains('draggable'),false)
  assert.ok([...host.querySelectorAll('button')].find(b=>b.textContent==='Save views').disabled)
  holdPreview=false;await act(async()=>releasePreview());await pause()
  let lock=host.querySelector('input[type="checkbox"]');await act(async()=>lock.click());await pause()
  assert.ok([...host.querySelectorAll('button')].find(b=>b.textContent==='Arrange contents').disabled)
  await click('Save views')
  assert.equal(stored.views[0].boundaries[0].layout.pattern,'grid')
  assert.equal(stored.views[0].boundaries[0].layout.locked,true)
  assert.equal(saves[0].headers['If-Match'],'source-one');assert.equal(saves[0].headers['If-View-Match'],'view-one')
  assert.equal(file.content,'package S { part a; }')
  await act(async()=>root.render(createElement(CustomViews,{file,key:'reopen'})));await pause()
  await act(async()=>host.querySelector('[aria-label="Settings for Zone"]').click())
  assert.ok(host.querySelector('input[type="checkbox"]').checked,'lock not restored')
  await select('Layout target','A')
  assert.equal(highlighted(),'A')
  assert.equal(host.querySelector('fieldset').disabled,true)
  assert.match(host.querySelector('.shared-layout-lock').textContent,/Zone.*locked contents/)
  await click('Go to locking group')
  assert.equal(editTarget().value,'zone')
  assert.equal(highlighted(),'zone')
  assert.equal(host.querySelector('fieldset').disabled,false)
  conflict=true
  await act(async()=>host.querySelector('input[type="checkbox"]').click());await pause();await click('Save views')
  assert.match(host.querySelector('[role="alert"]').textContent,/view changed/)
  assert.equal(stored.views[0].boundaries[0].layout.locked,true,'conflict replaced saved settings')
  await click('Revert');await pause()
  assert.ok(previews.length>=3)
 } finally {
  const {act}=await import('react');if(root)await act(async()=>root.unmount())
  dom.window.close();await rm(temp,{recursive:true,force:true});globalThis.fetch=originalFetch;globalThis.IS_REACT_ACT_ENVIRONMENT=originalAct
  for(const [key,descriptor]of globals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}
 }
})
