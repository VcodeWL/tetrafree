import test from 'node:test'
import assert from 'node:assert/strict'
import { wrapIndex } from './useFocus'

test('Tab с последнего элемента уходит на первый, с первого Shift+Tab — на последний', () => {
  assert.equal(wrapIndex(4, 3, false), 0)
  assert.equal(wrapIndex(4, 0, true), 3)
})
test('в середине списка решает браузер', () => {
  assert.equal(wrapIndex(4, 1, false), -1)
  assert.equal(wrapIndex(4, 2, true), -1)
})
test('фокус вне окна возвращается внутрь; пустое окно — ничего', () => {
  assert.equal(wrapIndex(3, -1, false), 0)
  assert.equal(wrapIndex(3, -1, true), 2)
  assert.equal(wrapIndex(0, -1, false), -1)
})
