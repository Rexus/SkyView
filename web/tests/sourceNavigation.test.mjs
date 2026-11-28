import test from 'node:test'
import assert from 'node:assert/strict'
import { declarationAt, sourceDeclarations } from '../src/sourceNavigation.ts'

test('linked declarations use the most specific UTF-8 span after CRLF normalization', () => {
  const content = "package 'Étude' {\r\n  part 'Cart 🚀' { attribute position; }\r\n}"
  const span = (start, end) => ({
    start: Buffer.byteLength(content.slice(0, start)),
    end: Buffer.byteLength(content.slice(0, end)),
  })
  const element = (id, kind, start, end, name) => ({
    id, kind,
    spans: { decl: span(start, end), name: span(content.indexOf(name), content.indexOf(name) + name.length) },
  })
  const declarations = sourceDeclarations({ content, model: { elements: [
    element('package', 'package', 0, content.length, "'Étude'"),
    element('cart', 'part', content.indexOf('part ', 1), content.indexOf(';') + 3, "'Cart 🚀'"),
    element('position', 'attribute', content.indexOf('attribute'), content.indexOf(';') + 1, 'position'),
  ] } })
  const normalized = content.replaceAll('\r\n', '\n')
  assert.equal(declarationAt(declarations, normalized.indexOf('position')), 'position')
  assert.equal(declarationAt(declarations, normalized.indexOf("'Cart")), 'cart')
  const cartName = declarations.find(item => item.id === 'cart').name
  assert.equal(normalized.slice(cartName.from, cartName.to), "'Cart 🚀'")
  assert.equal(declarationAt(declarations, normalized.length), null)
})
