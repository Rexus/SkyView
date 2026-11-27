import test from 'node:test'
import assert from 'node:assert/strict'
import {parentFirst,relativePosition,sceneNodeId} from '../src/diagramScene.ts'
import {connectModelPorts} from '../src/diagramConnections.ts'
import {addViewConnection} from '../src/viewSelection.ts'
test('interactive scene preserves native identity and relative nested placement',()=>{
 const nodes=[{key:'part',elementId:'native-part',parent:'zone',x:80,y:90},{key:'zone',annotation:true,x:20,y:30}]
 assert.deepEqual(parentFirst(nodes).map(n=>n.key),['zone','part'])
 assert.equal(sceneNodeId(nodes[0]),'native-part');assert.equal(sceneNodeId(nodes[1]),'annotation:zone')
 assert.deepEqual(relativePosition(nodes[0],{nodes}),{x:60,y:60})
 assert.throws(()=>parentFirst([{key:'bad',parent:'bad'}]),/cyclic/)
})
test('both diagram selections use native port connection semantics',async()=>{
 const model={elements:[{id:'a',name:'a',qname:'S::a',parentId:'scope'},{id:'b',name:'b',qname:'S::b',parentId:'scope'},{id:'p',name:'io',kind:'port'},{id:'q',name:'io',kind:'port'}]}
 const calls=[];await connectModelPorts(model,{source:'a',target:'b',sourceHandle:'p-out',targetHandle:'q-in'},async c=>calls.push(c))
 assert.deepEqual(calls,[{from:{nodeId:'a',portId:'p'},to:{nodeId:'b',portId:'q'}}])
 await connectModelPorts(model,{source:'a',target:'b',sourceHandle:'a-generic-out',targetHandle:'q-in'},async c=>calls.push(c))
 assert.equal(calls.length,1,'non-port handles cannot invent semantic connections')
})
test('a native connection can be routed in the saved view without moving either element',()=>{
 const view={width:600,height:400,edges:[],nodes:[
  {element:'A',x:40,y:70,width:120,height:65},
  {element:'B',x:310,y:90,width:120,height:65},
 ]}
 const changed=addViewConnection(view,'S::connection_3','A','B')
 assert.deepEqual(changed.nodes,view.nodes)
 assert.equal(view.edges.length,0)
 assert.equal(changed.edges[0].element,'S::connection_3')
 assert.ok(changed.edges[0].points.length>=2)
})
