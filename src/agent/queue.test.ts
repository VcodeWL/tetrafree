import test from 'node:test'
import assert from 'node:assert/strict'
import { moveItem } from './queue'

const L = ['a', 'b', 'c', 'd'].map((id) => ({ id }))
const ids = (l: { id: string }[]) => l.map((x) => x.id).join('')

test('moveItem: на одну позицию вверх и вниз', () => {
  assert.equal(ids(moveItem(L, 'c', -1)), 'acbd')
  assert.equal(ids(moveItem(L, 'b', 1)), 'acbd')
})
test('moveItem: в начало и в конец, за границы не выходит', () => {
  assert.equal(ids(moveItem(L, 'd', -1e9)), 'dabc')
  assert.equal(ids(moveItem(L, 'a', 1e9)), 'bcda')
  assert.equal(moveItem(L, 'a', -1), L)
})
test('moveItem: неизвестный id и исходный массив не меняются', () => {
  assert.equal(moveItem(L, 'zzz', 1), L)
  moveItem(L, 'b', 2)
  assert.equal(ids(L), 'abcd')
})
