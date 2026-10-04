import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchesTrigger, pipelinesFor } from './triggers'

test('matchesTrigger: свои события и push', () => {
  assert.equal(matchesTrigger(['version'], 'version'), true)
  assert.equal(matchesTrigger(['version'], 'commit'), false)
  assert.equal(matchesTrigger(['push'], 'commit'), true)
  assert.equal(matchesTrigger(['push'], 'version'), true)
})
test('matchesTrigger: manual и tag сами не запускаются', () => {
  assert.equal(matchesTrigger(['manual', 'tag'], 'version'), false)
  assert.equal(matchesTrigger([], 'commit'), false)
})
test('pipelinesFor: пустые пайплайны пропускаются, порядок сохраняется', () => {
  const defs = [
    { n: 'a', trigger: ['push'], steps: [1] },
    { n: 'b', trigger: ['push'], steps: [] },
    { n: 'c', trigger: ['manual'], steps: [1] },
    { n: 'd', trigger: ['commit'], steps: [1] },
  ]
  assert.deepEqual(
    pipelinesFor(defs, 'commit').map((d) => d.n),
    ['a', 'd'],
  )
  assert.deepEqual(
    pipelinesFor(defs, 'version').map((d) => d.n),
    ['a'],
  )
})
