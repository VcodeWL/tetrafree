import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isDue, DAY } from './autobackup'
test('isDue: никогда не делали, свежая и просроченная копия', () => {
  assert.ok(isDue(0))
  assert.ok(!isDue(1000, 1000 + DAY - 1))
  assert.ok(isDue(1000, 1000 + DAY))
})
