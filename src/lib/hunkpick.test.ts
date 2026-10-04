import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffLines } from './diff'
import { changeBlocks, applyPicked } from './hunkpick'

const A = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n')
const B = ['a', 'B', 'c', 'd', 'e', 'f', 'G', 'G2', 'h'].join('\n')

test('changeBlocks: два отдельных блока', () => {
  const b = changeBlocks(diffLines(A, B))
  assert.equal(b.length, 2)
  assert.deepEqual([b[0].add, b[0].del, b[1].add, b[1].del], [1, 1, 2, 1])
})
test('applyPicked: все блоки = новый текст, ни одного = старый', () => {
  const d = diffLines(A, B)
  assert.equal(applyPicked(d, new Set([0, 1])), B)
  assert.equal(applyPicked(d, new Set()), A)
})
test('applyPicked: только один блок', () => {
  const d = diffLines(A, B)
  assert.equal(applyPicked(d, new Set([1])), ['a', 'b', 'c', 'd', 'e', 'f', 'G', 'G2', 'h'].join('\n'))
  assert.equal(applyPicked(d, new Set([0])), ['a', 'B', 'c', 'd', 'e', 'f', 'g', 'h'].join('\n'))
})
test('applyPicked: завершающий перевод строки сохраняется', () => {
  const d = diffLines('x\ny\n', 'x\nz\n')
  assert.equal(applyPicked(d, new Set([0])), 'x\nz\n')
  assert.equal(applyPicked(d, new Set()), 'x\ny\n')
})
