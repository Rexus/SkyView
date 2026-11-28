import test from 'node:test'
import assert from 'node:assert/strict'
import { autoLayout, moveBox } from '../src/sharedLayout.ts'
import { layoutFlow } from '../src/flowLayout.ts'
import { routeOrthogonal, segments } from '../src/sharedRouting.ts'
import { routeModelEdges } from '../src/modelDiagramRouting.ts'
import { placeRouteLabels } from '../src/relationshipLabels.ts'
import { slideSegment, clearConnector, reattachConnector, shiftConnectorSegment, snapConnectorAttachment, snapConnectorSegment } from '../src/connectorRoutes.ts'
import { snapPlacement } from '../src/layoutGuides.ts'
import { editSavedConnector, moveSavedLabel, routeEdges } from '../src/savedDiagramRouting.ts'
import { emptyMoves, stepMoves } from '../src/layoutMoveHistory.ts'
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
test('pinned parts keep local placement while unlocked siblings arrange around them', () => {
 for (const pattern of ['horizontal', 'vertical', 'grid', 'flow']) {
  const input = fixture(), before = input.boundaries[1]
  before.layout.pattern = pattern
  before.layout.columns = 1
  input.nodes[0].layout = { positionLocked: true }
  const result = autoLayout(input), after = result.boundaries[1]
  const local = (node, owner) => [node.x - owner.x, node.y - owner.y, node.width, node.height]
  assert.deepEqual(local(result.nodes[0], after), local(input.nodes[0], before))
  assert.notDeepEqual(local(result.nodes[1], after), local(input.nodes[1], before))
  assert.notEqual(after.x, before.x, 'the containing group should still be able to move')
  assert.deepEqual(autoLayout(result), result)
  assert.throws(() => moveBox(result, 'a', 10, 0), /Unlock placement/)
  checkGeometry(result)
 }
})

test('a pinned group holds its own box and internal route while other groups can move', () => {
 const input = fixture()
 input.boundaries[0].layout.positionLocked = true
 const result = autoLayout(input)
 assert.deepEqual(result.boundaries, input.boundaries)
 assert.deepEqual(result.nodes.slice(0, 2), input.nodes.slice(0, 2))
 assert.deepEqual(result.edges[0], input.edges[0])
 assert.notDeepEqual(result.nodes[2], input.nodes[2])
 assert.throws(() => moveBox(result, 'tier', 10, 0), /Unlock placement/)
 assert.throws(() => moveBox(result, 'b', 10, 0), /Unlock the containing/)
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

test('label placement clears cards, tracks and other labels and fits a dense fallback', () => {
 const paths = [
  { points: [[30, 80], [270, 80]], text: 'Runs on local infrastructure' },
  { points: [[40, 110], [270, 110]], text: 'Realized over network' },
 ]
 const boxes = [{ x: 80, y: 36, width: 150, height: 38 }]
 const [first, second] = placeRouteLabels(paths, boxes)
 assert.ok(first.bounds.y > 80)
 assert.ok(second.bounds.y > first.bounds.y + first.bounds.height || second.bounds.y + second.bounds.height <= first.bounds.y)
 const [fallback] = placeRouteLabels(paths.slice(0, 1), [{ x: 0, y: 0, width: 360, height: 250 }])
 assert.ok(fallback.bounds.y > 250)
 assert.deepEqual(fallback.leader, [[150, 80], [150, fallback.bounds.y]])
})

test('independent relationships get separate card attachments, while a shared port fans out', () => {
 const box = (x, y, ports = []) => ({ x, y, width: 120, height: 100, glyph: { ports } })
 const boxes = new Map([
  ['a', box(0, 120, [{ id: 'port', y: 50 }])],
  ['b', box(380, 80)],
  ['c', box(380, 200)],
 ])
 const make = (target, sourceHandle) => ({ id: target, source: 'a', target, sourceHandle, data: { kind: 'dependency' } })
 const branches = routeModelEdges([make('b'), make('c')], boxes)
 assert.ok(branches[0].data.points[0][1] < branches[1].data.points[0][1])
 assert.ok(branches.every(edge => Math.abs(edge.data.points[0][1] - 170) >= 8))
 const fromPort = routeModelEdges([make('b', 'port-out'), make('c', 'port-out')], boxes)
 for (const edge of fromPort) {
  assert.deepEqual(edge.data.points[0], [120, 170])
  const [, [x, y], [u, v]] = edge.data.points
  assert.ok(Math.abs(x - u) > 0)
  assert.equal(Math.abs(x - u), Math.abs(y - v))
 }
})

test('a remaining perpendicular crossing is marked on just one connector', () => {
 const box = (x, y) => ({ x, y, width: 80, height: 80, glyph: { ports: [] } })
 const boxes = new Map([['left', box(0, 300)], ['right', box(600, 300)], ['top', box(300, 0)], ['bottom', box(300, 600)]])
 const [horizontal, vertical] = routeModelEdges([
  { id: 'horizontal', source: 'left', target: 'right', data: { kind: 'dependency' } },
  { id: 'vertical', source: 'top', target: 'bottom', data: { kind: 'flow' } },
 ], boxes)
 assert.deepEqual(horizontal.data.gaps, [[340, 340]])
 assert.deepEqual(vertical.data.gaps, [])
})

test('routing aligns a slightly offset facing card and reserves room for the next arrowhead', () => {
 const card = (x, y) => ({ x, y, width: 100, height: 80, glyph: { ports: [] } })
 const boxes = new Map([['a', card(0, 0)], ['b', card(0, 140)], ['hub', card(270, 3)]])
 const edge = source => ({ id: source, source, target: 'hub', label: 'Uses', data: { kind: 'dependency' } })
 const model = routeModelEdges([edge('a'), edge('b')], boxes, [], {}, { a: [190, 94] })
 assert.equal(model[0].data.points.length, 2)
 assert.equal(model[0].data.points[0][1], model[0].data.points[1][1])
 assert.deepEqual(model[0].data.labelPosition, [190, 94])
 assert.deepEqual(model[0].data.labelLeader[0], [190, model[0].data.points[0][1]])
 const view = { ...fixture(), boundaries: [], nodes: [...boxes.entries()].map(([element, box]) => ({ ...box, element })),
  edges: ['a', 'b'].map(from => ({ element: from, from, to: 'hub', points: [], label: [0, 0] })) }
 routeEdges(view)
 assert.equal(view.edges[0].points.length, 2)
 for (const ends of [model.map(item => item.data.points.at(-1)), view.edges.map(item => item.points.at(-1))]) {
  assert.ok(Math.hypot(ends[0][0] - ends[1][0], ends[0][1] - ends[1][1]) >= 22)
 }
})

test('a wide receiving card takes the shortest route centered on the narrower card', () => {
 const upper = { element: 'upper', x: 540, y: 301, width: 380, height: 96 }
 const lower = { element: 'lower', x: 40, y: 482, width: 880, height: 84 }
 const view = { ...fixture(), boundaries: [], nodes: [upper, lower],
  edges: [{ element: 'link', from: 'upper', to: 'lower', points: [], label: [0, 0] }] }
 routeEdges(view)
 assert.deepEqual(view.edges[0].points, [[730, 397], [730, 482]])
 const boxes = new Map([upper, lower].map(box => [box.element, { ...box, glyph: { ports: [] } }]))
 const [edge] = routeModelEdges([{ id: 'link', source: 'upper', target: 'lower' }], boxes)
 assert.deepEqual(edge.data.points, view.edges[0].points)
 lower.y = 411
 routeEdges(view)
 assert.deepEqual(view.edges[0].points, [[730, 397], [730, 411]], 'a short gap needs no extra stubs')
})

test('moving the middle of a side route can reattach both ends in one straight drag', () => {
 const source = { x: 540, y: 301, width: 380, height: 96 }
 const target = { x: 40, y: 482, width: 880, height: 84 }
 const sideRoute = [[920, 349], [932, 349], [932, 524], [920, 524]]
 const obstacles = [source, target]
 const geometry = { source, target, obstacles, occupied: [], used: [[480, 482]] }
 assert.deepEqual(shiftConnectorSegment(sideRoute, 1, -199, 8, geometry, true).points, [[730, 397], [730, 482]])
 assert.deepEqual(shiftConnectorSegment(sideRoute, 1, -132, 8, geometry, true).points, [[800, 397], [800, 482]])
 const fixed = shiftConnectorSegment(sideRoute, 1, -202, 8, geometry, false).points
 assert.deepEqual([fixed[0], fixed.at(-1)], [sideRoute[0], sideRoute.at(-1)])
 const blocker = { x: 690, y: 422, width: 80, height: 32 }
 const blocked = shiftConnectorSegment(sideRoute, 1, -202, 8, { ...geometry, obstacles: [...obstacles, blocker] }, true)
 assert.equal(blocked.straight, undefined)
 assert.ok(clearConnector(blocked.points, [...obstacles, blocker]))
})

test('connector drag snapping straightens small jogs without using an occupied attachment', () => {
 const box = { x: 240, y: 0, width: 100, height: 80 }
 assert.deepEqual(snapConnectorAttachment([240, 43], box, [80, 40], [], 8),
  { point: [240, 40], aligned: [80, 40] })
 assert.deepEqual(snapConnectorAttachment([240, 43], box, [80, 40], [[240, 38]], 8),
  { point: [240, 60], aligned: undefined })
 const jog = [[80,40],[160,40],[160,44],[240,44]]
 const snapped = snapConnectorSegment(jog, 2, -2, 8)
 assert.equal(snapped.offset, -4)
 assert.deepEqual(slideSegment(jog, 2, snapped.offset), [[80,40],[228,40],[228,44],[240,44]])
})

test('moved labels survive another route edit and auto layout, including left of the old frame', () => {
 const view = fixture(), labels = new Map([['ab', 'Signal trace']])
 const position = [-40, 260]
 const moved = moveSavedLabel(view, 'ab', position, labels.get('ab'))
 assert.ok(moved.origin[0] < position[0])
 assert.deepEqual(moved.edges[0].points, view.edges[0].points)
 assert.equal(moved.edges[0].labelMoved, true)
 const edited = editSavedConnector(moved, 'ab', slideSegment(view.edges[0].points, 0, 12), labels)
 assert.deepEqual(edited.edges[0].label, position)
 const arranged = autoLayout(edited, undefined, labels)
 const container = arranged.boundaries.find(box => box.id === 'zone')
 const oldContainer = edited.boundaries.find(box => box.id === 'zone')
 assert.deepEqual(arranged.edges[0].label, [position[0] + container.x - oldContainer.x, position[1] + container.y - oldContainer.y])
 assert.equal(arranged.edges[0].labelMoved, true)
})

test('moving a box extends the canvas in every direction without shifting other boxes', () => {
 const input = fixture()
 const left = moveBox(input, 'tier', -15000, -12000)
 assert.deepEqual(left.nodes[2], input.nodes[2])
 assert.deepEqual(left.edges[0].points, input.edges[0].points.map(([x, y]) => [x - 15000, y - 12000]))
 assert.ok(left.origin[0] < -15000 && left.origin[1] < -12000)
 const right = moveBox(left, 'c', 17000, 12500)
 assert.deepEqual(right.boundaries, left.boundaries)
 assert.ok(right.origin[0] + right.width > 17750 && right.origin[1] + right.height > 12610)
 const undone = moveBox(right, 'c', -17000, -12500)
 assert.deepEqual(undone.nodes, left.nodes)
 assert.deepEqual(undone.edges[0], left.edges[0])
 assert.throws(() => moveBox(input, 'c', -700, -30), /already a box/)
 assert.throws(() => moveBox(input, 'a', -1000, -1000), /containing group/)
})

test('dragging a straight connector moves its middle and keeps both attachments and clearance', () => {
 const points = [[80, 40], [240, 40]]
 const moved = slideSegment(points, 0, 30)
 assert.deepEqual(moved, [[80,40],[92,40],[92,70],[228,70],[228,40],[240,40]])
 const boxes = [{x:0,y:0,width:80,height:100}, {x:240,y:0,width:80,height:100}]
 assert.ok(clearConnector(moved, boxes))
 assert.equal(clearConnector([[80,40],[83,40],[83,70],[228,70],[228,40],[240,40]], boxes), false)
 assert.equal(clearConnector([[80,40],[80,130],[240,130],[240,40]], boxes), false)
})

test('editing a saved connector preserves all other routes and respects locked group interiors', () => {
 const view = fixture()
 const before = view.edges[0].points
 const points = slideSegment(before, 0, 30)
 const adjusted = editSavedConnector(view, 'ab', points, new Map([['ab','Signal trace']]))
 assert.deepEqual(adjusted.edges[0].points, points)
 assert.deepEqual(adjusted.edges[1], view.edges[1])
 assert.deepEqual(adjusted.nodes, view.nodes)
 assert.deepEqual(view.edges[0].points, before)
 view.boundaries[1].layout.locked = true
 assert.throws(() => editSavedConnector(view, 'ab', points, new Map()), /Unlock/)
})

test('layout redo replays moves in sequence and a new move clears the redo stack', () => {
 const [a, b, c, d] = [1, 2, 3, 4].map(dx => ({ kind: 'box', key: 'box', dx, dy: 0 }))
 const original = [a, b, c].reduce((history, move) => stepMoves(history, move, 'record'), emptyMoves)
 const once = stepMoves(original, c, 'undo')
 const twice = stepMoves(once, b, 'undo')
 assert.deepEqual(twice, { undo: [a], redo: [c, b] })
 const reapplied = stepMoves(twice, b, 'redo')
 assert.deepEqual(reapplied, once)
 assert.deepEqual(stepMoves(reapplied, c, 'redo'), original)
 assert.deepEqual(stepMoves(once, d, 'record'), { undo: [a, b, d], redo: [] })
})

test('placement guides align cards and match the neighbouring gap', () => {
 const card = (x, y) => ({ x, y, width: 150, height: 80 })
 const neighbours = [card(70, 100), card(310, 100)]
 const result = snapPlacement(card(547, 105), neighbours, 8)
 assert.deepEqual(result.position, { x: 550, y: 100 })
 assert.equal(result.guides.filter(guide => guide.kind === 'spacing').length, 2)
 assert.ok(result.guides.some(guide => guide.kind === 'alignment'))
 const between = snapPlacement(card(310, 100), [card(70, 100), card(554, 100)], 8)
 assert.equal(between.position.x, 312)
 assert.equal(between.guides.filter(guide => guide.kind === 'spacing').length, 2)
 const inside = snapPlacement(card(6, 29), [card(0, 210)], 8, { x: 4, y: 0, width: 420, height: 400 })
 assert.equal(inside.position.x, 6, 'snapping must not move the child outside its parent')
})

test('the adjacent relationship routes straight and the long branch clears the intervening box', () => {
 const card = y => ({ x: 40, y, width: 220, height: 95, glyph: { ports: [] } })
 const boxes = new Map([['a', card(40)], ['b', card(210)], ['c', card(410)]])
 const edge = target => ({ id: target, source: 'a', target, data: { kind: 'dependency' } })
 const [long, short] = routeModelEdges([edge('c'), edge('b')], boxes)
 assert.deepEqual(short.data.points, [[150, 135], [150, 210]])
 assert.equal(long.data.points.length, 4)
 assert.equal(long.data.points[0][0], 260)
 assert.equal(long.data.points.at(-1)[0], 260)
 assert.ok(clearConnector(long.data.points, [...boxes.values()]))
 const changed = reattachConnector([[150, 135], [150, 385], [272, 385], [272, 457.5], [260, 457.5]],
  boxes.get('a'), boxes.get('c'), 'source', [260, 87.5], [...boxes.values()], segments(short.data.points))
 assert.deepEqual(changed, long.data.points)
})
