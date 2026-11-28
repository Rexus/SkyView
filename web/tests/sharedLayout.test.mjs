import test from 'node:test'
import assert from 'node:assert/strict'
import { autoLayout, moveBox } from '../src/sharedLayout.ts'
import { layoutFlow } from '../src/flowLayout.ts'
import { routeOrthogonal, segments } from '../src/sharedRouting.ts'
import { routeModelEdges } from '../src/modelDiagramRouting.ts'
import { boxesOf, boxKey, lockedParent } from '../src/sharedViews.ts'

function fixture() {
 return { id: 'test', title: 'Test', subject: 'SYS', owner: '.', presentation: true, width: 1000, height: 600,
  layout: { pattern: 'horizontal' },
  boundaries: [
   { id: 'tier', label: 'Tier', x: 10, y: 10, width: 600, height: 450, layout: { pattern: 'vertical' } },
   { id: 'zone', label: 'Zone', parent: 'tier', x: 30, y: 60, width: 550, height: 280, layout: { pattern: 'horizontal' } },
  ], nodes: [
   { element: 'a', parent: 'zone', x: 60, y: 110, width: 140, height: 80 },
   { element: 'b', parent: 'zone', x: 300, y: 110, width: 140, height: 100 },
   { element: 'c', x: 750, y: 110, width: 160, height: 80 },
  ], edges: [
   { element: 'ab', from: 'a', to: 'b', points: [[200,150],[300,150]], label: [250,140] },
   { element: 'bc', from: 'b', to: 'c', points: [[440,150],[750,150]], label: [600,140] },
  ] }
}
function checkGeometry(view) {
 const boxes=boxesOf(view), byKey=new Map(boxes.map(b=>[boxKey(b),b]))
 for(const b of boxes){
  assert.ok(b.x>=0&&b.y>=0&&b.x+b.width<=view.width&&b.y+b.height<=view.height)
  if(b.parent){const p=byKey.get(b.parent);assert.ok(b.x>=p.x&&b.y>=p.y+24&&b.x+b.width<=p.x+p.width&&b.y+b.height<=p.y+p.height)}
  for(const c of boxes)if(b!==c&&(b.parent??'')===(c.parent??''))assert.ok(b.x+b.width<=c.x||c.x+c.width<=b.x||b.y+b.height<=c.y||c.y+c.height<=b.y,'siblings overlap')
 }
 for(const e of view.edges)for(let i=1;i<e.points.length;i++)assert.ok(e.points[i][0]===e.points[i-1][0]||e.points[i][1]===e.points[i-1][1],'route is not orthogonal')
}
test('auto layout sizes nested boundaries before arranging them with outside elements',()=>{
 const original=fixture(), input=structuredClone(original), out=autoLayout(input)
 assert.deepEqual(input,original,'input mutated')
 checkGeometry(out)
 assert.deepEqual(autoLayout(out),out,'same settings and geometry must be repeatable')
 assert.equal(out.nodes[0].y,out.nodes[1].y,'local horizontal arrangement ignored')
 assert.ok(out.nodes[2].x>out.boundaries[0].x+out.boundaries[0].width,'outside node overlaps boundary')
})
test('locked contents and their internal edge route move together without rearrangement',()=>{
 const input=fixture();input.boundaries[1].layout.locked=true
 const result=autoLayout(input), before=input.boundaries[1], after=result.boundaries[1]
 assert.deepEqual([after.width,after.height],[before.width,before.height])
 for(let i=0;i<2;i++)assert.deepEqual([result.nodes[i].x-after.x,result.nodes[i].y-after.y],[input.nodes[i].x-before.x,input.nodes[i].y-before.y])
 assert.deepEqual(result.edges[0].points.map(([x,y])=>[x-after.x,y-after.y]),input.edges[0].points.map(([x,y])=>[x-before.x,y-before.y]))
 assert.equal(lockedParent(result,'a'),true);assert.equal(lockedParent(result,'zone'),false)
 checkGeometry(result)
})
test('horizontal, vertical and grid are local patterns and survive a JSON round trip',()=>{
 for(const pattern of ['horizontal','vertical','grid']){
  const view=fixture();view.boundaries[1].layout={pattern,columns:1}
  const out=autoLayout(JSON.parse(JSON.stringify(view)));checkGeometry(out)
  if(pattern==='horizontal')assert.equal(out.nodes[0].y,out.nodes[1].y)
  else assert.ok(out.nodes[1].y>=out.nodes[0].y+out.nodes[0].height)
 }
})
test('dragging a boundary retains descendants and interior routes',()=>{
 const input=fixture(), out=moveBox(input,'tier',25,40)
 for(let i=0;i<2;i++)assert.deepEqual([out.nodes[i].x,out.nodes[i].y],[input.nodes[i].x+25,input.nodes[i].y+40])
 assert.deepEqual(out.nodes[2],input.nodes[2])
 assert.deepEqual(out.edges[0].points,input.edges[0].points.map(([x,y])=>[x+25,y+40]))
})

test('locked ancestors block local child moves and arrangement',()=>{
 const view=fixture();view.boundaries[0].layout.locked=true
 assert.throws(()=>moveBox(view,'a',30,0),/Unlock/)
 assert.throws(()=>autoLayout(view,'zone'),/Unlock/)
})

test('moving another element into an unlocked route recalculates that route',()=>{
 const view=fixture();view.nodes[2].width=60;view.nodes[2].height=60;view.nodes[2].parent='zone'
 const out=moveBox(view,'c',-530,20)
 assert.notDeepEqual(out.edges[0].points,view.edges[0].points)
 const obstacle=out.nodes[2]
 for(let i=1;i<out.edges[0].points.length;i++){
  const a=out.edges[0].points[i-1],b=out.edges[0].points[i]
  if(a[1]===b[1])assert.ok(a[1]<=obstacle.y||a[1]>=obstacle.y+obstacle.height||Math.max(a[0],b[0])<=obstacle.x||Math.min(a[0],b[0])>=obstacle.x+obstacle.width)
 }
})

test('local arrangement fits ancestors and surrounding groups without flattening them',()=>{
 const input=fixture();input.boundaries[1].layout.pattern='vertical'
 const out=autoLayout(input,'zone')
 checkGeometry(out)
 assert.ok(out.nodes[1].y>=out.nodes[0].y+out.nodes[0].height)
 assert.deepEqual([out.nodes[2].width,out.nodes[2].height],[input.nodes[2].width,input.nodes[2].height])
 assert.deepEqual(autoLayout(out,'zone'),out)
})

function sampleBoxes(count) {
 return Array.from({ length: count }, (_, index) => ({ id: 'node-' + index, width: 160, height: 80 }))
}

function shape(items, positions) {
 const width = Math.max(...items.map(item => positions[item.id].x + item.width))
 const height = Math.max(...items.map(item => positions[item.id].y + item.height))
 return width / height
}

test('flow packs standalone parts into a compact shape in both projections', () => {
 const items = sampleBoxes(12)
 for (const direction of ['LR', 'TB']) {
  const positions = layoutFlow(items, [], direction, 36)
  assert.ok(shape(items, positions) >= .8 && shape(items, positions) <= 1.5)
  assert.ok(new Set(Object.values(positions).map(p => p.x)).size > 1)
  assert.ok(new Set(Object.values(positions).map(p => p.y)).size > 1)
 }
})

test('flow folds a long connected chain and preserves its directed edges in a saved view', () => {
 const items = sampleBoxes(12)
 const links = items.slice(1).map((item, i) => ({ source: items[i].id, target: item.id }))
 const positions = layoutFlow(items, links, 'LR', 36)
 assert.ok(shape(items, positions) >= .8 && shape(items, positions) <= 1.5)
 const view = fixture()
 view.boundaries = []
 view.layout = { pattern: 'flow', direction: 'LR', gap: 36 }
 view.nodes = items.map(item => ({ ...item, element: item.id, x: 30, y: 40 }))
 view.edges = links.map((link, i) => ({ element: 'edge-' + i, from: link.source, to: link.target, points: [], label: [0, 0] }))
 const out = autoLayout(view)
 checkGeometry(out)
 assert.deepEqual(autoLayout(out), out, 'flow layout and connector routes are deterministic')
 assert.deepEqual(out.edges.map(({ from, to }) => ({ source: from, target: to })), links)
})

test('orthogonal routing chooses a short detour around an existing connector', () => {
 const occupied = segments([[100, 30], [100, 70]])
 const points = routeOrthogonal([20, 60], [180, 60], [], { x: 0, y: 0, width: 200, height: 120 }, occupied)
 assert.ok(points.some(([, y]) => y > 70))
 for (const [[x1, y1], [x2, y2]] of segments(points)) {
  assert.ok(y1 !== y2 || y1 < 30 || y1 > 70 || Math.max(x1, x2) < 100 || Math.min(x1, x2) > 100)
 }
})

test('automatic interconnections keep named ports and route around intervening boxes', () => {
 const box = (x, width, ports = []) => ({ x, y: 0, width, height: 100, glyph: { ports } })
 const boxes = new Map([
  ['source', box(0, 100, [{ id: 'output', y: 45 }])],
  ['blocker', box(180, 80)],
  ['target', box(360, 100, [{ id: 'input', y: 45 }])],
 ])
 const [edge] = routeModelEdges([{ id: 'connection', source: 'source', target: 'target',
  sourceHandle: 'output-out', targetHandle: 'input-in', data: { kind: 'connection' } }], boxes)
 assert.equal(edge.sourceHandle,'output-out')
 assert.equal(edge.targetHandle,'input-in')
 assert.deepEqual(edge.data.points[0], [100, 45])
 assert.deepEqual(edge.data.points.at(-1), [360, 45])
 assert.ok(edge.data.points.some(([, y]) => y <= 0 || y >= 100))
})
