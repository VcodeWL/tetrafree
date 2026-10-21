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

// Runtime origin must remain separate even when a project clone preserves all chat IDs.
import {
  enqueue,
  dequeue,
  queueGet,
  queueFor,
  useQueue,
  peekQueue,
  shiftQueue,
  clearQueue,
  clearAllQueues,
  queueGeneration,
  moveQueued,
  prioritize,
} from './queue'
import { runtimeKey, retryKey } from './runtimeKey'

test('runtime identities encode tuples without delimiter collisions or historical ID rewriting', () => {
  assert.notEqual(runtimeKey('A', 'c'), runtimeKey('B', 'c'))
  assert.notEqual(runtimeKey('a:b', 'c'), runtimeKey('a', 'b:c'))
  assert.notEqual(runtimeKey(undefined, 'c'), runtimeKey('', 'c'))
  assert.notEqual(retryKey('A', 'c', 'm', 'p'), retryKey('A', 'other', 'm', 'p'))
  assert.notEqual(retryKey('A', 'c', 'm', 'p'), retryKey('A', 'c', 'other', 'p'))
})
test('clone queues: every read/mutation stays scoped, legacy bucket cannot leak, empty selector is stable', () => {
  clearAllQueues()
  enqueue('c', 'legacy greeting', [])
  enqueue('c', 'A first', [], undefined, 'A')
  enqueue('c', 'A second', [], undefined, 'A')
  enqueue('c', 'B first', [], undefined, 'B')
  enqueue('c', 'B second', [], undefined, 'B')
  const a = queueGet('c', 'A'),
    b = queueGet('c', 'B')
  assert.equal(queueFor(useQueue.getState(), 'B', 'c'), b)
  assert.equal(queueGet('c', 'missing'), queueGet('other', 'missing'))
  assert.ok(Object.isFrozen(queueGet('c', 'missing')))
  dequeue('c', a[0].id, 'B')
  assert.equal(queueGet('c', 'A'), a)
  assert.equal(queueGet('c', 'B').length, 2)
  moveQueued('c', b[1].id, -1, 'B')
  assert.equal(peekQueue('c', 'B')?.text, 'B second')
  assert.equal(peekQueue('c', 'A')?.text, 'A first')
  prioritize('c', a[1].id, 'A')
  assert.equal(shiftQueue('c', 'A')?.text, 'A second')
  assert.equal(queueGet('c', 'B').length, 2)
  const ga = queueGeneration('c', 'A'),
    gb = queueGeneration('c', 'B')
  clearQueue('c', 'A')
  assert.equal(queueGeneration('c', 'A'), ga + 1)
  assert.equal(queueGeneration('c', 'B'), gb)
  assert.equal(peekQueue('c')?.text, 'legacy greeting')
  clearAllQueues()
  assert.equal(queueGeneration('c', 'B'), gb + 1)
  assert.equal(queueGet('c', 'B').length, 0)
  assert.equal(queueGet('c').length, 0)
})
