// ReactFlow needs browser measurements; tests retain real components and interactions.
export function setupFlowDOM(dom, globals) {
 class ResizeObserver { constructor(callback){this.callback=callback} observe(target){this.callback([{target,contentRect:{width:900,height:600}}])} unobserve(){} disconnect(){} }
 class DOMMatrixReadOnly { constructor(){this.m22=1;this.a=1;this.b=0;this.c=0;this.d=1;this.e=0;this.f=0} }
 for (const [key,value] of Object.entries({ResizeObserver,DOMMatrixReadOnly,getComputedStyle:dom.window.getComputedStyle.bind(dom.window),requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window)})) {
  if(!globals.has(key))globals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));Object.defineProperty(globalThis,key,{configurable:true,value});dom.window[key]=value
 }
 Object.defineProperties(dom.window.HTMLElement.prototype,{offsetWidth:{configurable:true,get(){return parseFloat(this.style.width)||900}},offsetHeight:{configurable:true,get(){return parseFloat(this.style.height)||600}}})
 dom.window.SVGElement.prototype.getBBox=()=>({x:0,y:0,width:100,height:20})
}
export function sceneFor(config,id) {
 const view=config.views.find(v=>v.id===id)||config.views[0]
 return {svg:'<svg viewBox="0 0 600 400"></svg>',resources:'',nodes:[
  ...(view.boundaries||[]).map(b=>({key:b.id,annotation:true,parent:b.parent,x:b.x,y:b.y,width:b.width,height:b.height,ports:[],svg:`<svg><rect width="${b.width}" height="${b.height}"/></svg>`})),
  ...view.nodes.map(n=>({key:n.element,elementId:n.element,parent:n.parent,x:n.x,y:n.y,width:n.width,height:n.height,ports:[],svg:`<svg><text>${n.element}</text></svg>`}))],edges:[]}
}
