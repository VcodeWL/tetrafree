import test from 'node:test'
import assert from 'node:assert/strict'
import { rowAction } from './a11y'

test('rowAction: Enter и Пробел открывают, F2/Delete/стрелки — свои действия', () => {
  assert.equal(rowAction('Enter'), 'open')
  assert.equal(rowAction(' '), 'open')
  assert.equal(rowAction('F2'), 'rename')
  assert.equal(rowAction('Delete'), 'remove')
  assert.equal(rowAction('ArrowUp'), 'prev')
  assert.equal(rowAction('ArrowDown'), 'next')
  assert.equal(rowAction('a'), null)
})
