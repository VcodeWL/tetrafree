import test from 'node:test'
import assert from 'node:assert/strict'
import { foldRanges, hiddenLines, unfoldAt, visibleIndex } from './folds'

const SRC = ['fn a() {', '  if x {', '    y()', '', '    z()', '  }', '  w()', '}', '', 'fn b() {}', 'tail']

test('foldRanges: вложенные блоки, пустые строки внутри не рвут блок', () => {
  const r = foldRanges(SRC)
  assert.equal(r.get(0), 6)
  assert.equal(r.get(1), 4) // закрывающая скобка остаётся видимой
  assert.equal(r.get(9), undefined)
  assert.equal(r.get(10), undefined)
})
test('foldRanges: хвостовые пустые строки не входят в блок', () => {
  assert.equal(foldRanges(['a', '  b', '', '', 'c']).get(0), 1)
})
test('hiddenLines и visibleIndex', () => {
  const r = foldRanges(SRC)
  const h = hiddenLines(r, new Set([1]))
  assert.deepEqual([...h], [2, 3, 4])
  assert.deepEqual(visibleIndex(8, h), [0, 1, 2, 2, 2, 2, 3, 4])
})
test('внешняя свёртка поверх внутренней; несуществующее начало игнорируется', () => {
  const r = foldRanges(SRC)
  assert.equal(hiddenLines(r, new Set([0, 1])).size, 6)
  assert.equal(hiddenLines(r, new Set([9, 99])).size, 0)
})
test('unfoldAt раскрывает только те блоки, что скрывают строку', () => {
  const r = foldRanges(SRC)
  const n = unfoldAt(r, new Set([0, 9]), 3)
  assert.deepEqual([...n], [9])
})
