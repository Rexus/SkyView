import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'esbuild'
import { JSDOM } from 'jsdom'

test('Project panels navigate files and authored endpoints without inferring dependencies', async () => {
 const dom = new JSDOM('<div id="root"></div>', {url:'http://localhost/', pretendToBeVisual:true})
 const globals = new Map()
 for (const key of ['window','document','navigator','HTMLElement','Element','Node','location','history']) { globals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]}) }
 const temp=await mkdtemp(fileURLToPath(new URL('./.workbench-',import.meta.url)))
 const oldAct=globalThis.IS_REACT_ACT_ENVIRONMENT, oldFetch=globalThis.fetch;globalThis.IS_REACT_ACT_ENVIRONMENT=true
 let root
 try {
  await build({entryPoints:[fileURLToPath(new URL('../src/components/WorkbenchSidebar.tsx',import.meta.url))],outfile:`${temp}/Sidebar.mjs`,bundle:true,packages:'external',format:'esm',platform:'node',jsx:'automatic'})
  const {createElement,act}=await import('react'),{createRoot}=await import('react-dom/client'),{default:Sidebar}=await import(pathToFileURL(`${temp}/Sidebar.mjs`).href)
  const host=document.querySelector('#root');root=createRoot(host)
  let opened,selected,added,panel
  const elements=[{id:'root',name:'root',kind:'root'}, {id:'pkg',name:'Architecture',kind:'package',qname:'Architecture',parentId:'root'}, {id:'p',name:'A',kind:'part',qname:'A',parentId:'root'}, {id:'q',name:'B',kind:'part',qname:'B',parentId:'root'}, {id:'d',name:'uses B',kind:'dependency',sourceId:'p',targetId:'q'}, {id:'u',name:'unknown',kind:'dependency',source:'external',targetId:'q'}]
  elements.forEach(e=>{e.spans={bodyOpen:-1,bodyClose:-1};e.line=1;e.qname??=e.name})
  const props={panel:'projects',onPanel:value=>panel=value,files:[{name:'models/A.sysml'},{name:'models/nested/B.sysml'}],file:{name:'models/A.sysml',model:{rootId:'root',elements,diagnostics:[],imports:['External::*']}},selectedId:'p',onSelect:id=>selected=id,onOpenFile:(...args)=>opened=args,view:null,catalog:{ config:{views:[{id:'overview',title:'System Overall',owner:'.'}]},etag:'one' },settingsPage:'colours',settingsHost:()=>{},actions:{addElement:id=>added=id},projectBar:createElement('div',null,'Project picker')}
  await act(async()=>root.render(createElement(Sidebar,props)))
  assert.equal(host.querySelectorAll('.project-file').length,2)
  const button = text => [...host.querySelectorAll('button')].find(b => b.textContent.trim() === text)
  await act(async()=>button('System Overall').click())
  assert.deepEqual(opened,['models/A.sysml','overview'])
  await act(async()=>button('Architecture').click())
  assert.deepEqual(opened,['models/A.sysml',null,'pkg'])
  globalThis.fetch = async (url) => Response.json(url.endsWith('/views')
    ? {version:2,views:[{id:'detail',title:'Secondary view',owner:'.'}]}
    : {name:'models/nested/B.sysml',model:{rootId:'root',elements}})
  await act(async()=>host.querySelector('[aria-label="Expand B.sysml"]').click())
  await act(async()=>button('Secondary view').click())
  assert.deepEqual(opened,['models/nested/B.sysml','detail'])
  await act(async()=>button('B.sysml').click())
  assert.deepEqual(opened,['models/nested/B.sysml'])
  await act(async()=>button('Elements').click())
  assert.equal(panel,'elements')
  await act(async()=>root.render(createElement(Sidebar,{...props,panel:'elements'})))
  assert.equal(host.querySelector('.elements-panel').hidden,false)
  await act(async()=>{ const links = host.querySelector('.model-links'); links.open = true; links.dispatchEvent(new dom.window.Event('toggle')) })
  assert.equal(host.querySelectorAll('.model-link [aria-label="to"]').length,1,'only resolved relationships have arrows')
  await act(async()=>host.querySelector('.model-link button').click());assert.equal(selected,'p')
  await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent.includes('Add selected to view')).click());assert.equal(added,'p')
  assert.equal(host.querySelector('[aria-label="Element properties"]'), null)
 } finally {
  const {act}=await import('react');if(root) await act(async()=>root.unmount())
  dom.window.close();await rm(temp,{recursive:true,force:true});globalThis.IS_REACT_ACT_ENVIRONMENT=oldAct;globalThis.fetch=oldFetch
  for(const[key,descriptor]of globals){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key]}
 }
})
