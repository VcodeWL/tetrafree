import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mmRows, contentH, viewRect, scrollForY } from './minimap'

test('mmRows: пустые, комментарии, код; свёрнутые строки пропускаются', () => {
  const r = mmRows(['// a', '', '  foo(1)', 'hidden'], new Set([3]))
  assert.deepEqual(
    r.map((x) => x.k),
    ['c', 'e', 't'],
  )
  assert.equal(r[2].indent, 2)
  assert.equal(r[2].len, 6)
})
test('mmRows: длинные строки ограничены', () => {
  assert.equal(mmRows(['x'.repeat(500)], new Set())[0].len, 70)
})
test('contentH: не выше области', () => {
  assert.equal(contentH(10, 500), 20)
  assert.equal(contentH(1000, 500), 500)
})
test('viewRect: пропорции и границы', () => {
  assert.deepEqual(viewRect(0, 500, 1000, 200), { top: 0, h: 100 })
  assert.deepEqual(viewRect(500, 500, 1000, 200), { top: 100, h: 100 })
  const r = viewRect(99999, 500, 1000, 200)
  assert.equal(r.top + r.h, 200)
  assert.equal(viewRect(0, 10, 100000, 200).h, 8)
})
test('scrollForY: центрирует и не выходит за границы', () => {
  assert.equal(scrollForY(0, 200, 1000, 400), 0)
  assert.equal(scrollForY(100, 200, 1000, 400), 300)
  assert.equal(scrollForY(200, 200, 1000, 400), 600)
})
