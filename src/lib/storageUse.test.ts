import test from 'node:test'
import assert from 'node:assert/strict'
import { storageLevel, fmtMb } from './storageUse'

test('storageLevel: пороги 70% и 90%', () => {
  assert.equal(storageLevel(1_000_000), 'ok')
  assert.equal(storageLevel(3_500_000), 'warn')
  assert.equal(storageLevel(4_600_000), 'full')
})
test('fmtMb', () => {
  assert.equal(fmtMb(250_000), '0,25 МБ')
  assert.equal(fmtMb(3_456_000), '3,5 МБ')
})
