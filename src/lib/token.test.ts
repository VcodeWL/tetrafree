import test from 'node:test'
import assert from 'node:assert/strict'
import { getToken, getTokenRevision, setToken } from './token'

test('same-value writes do not invent a token authority change', () => {
  const current = getToken()
  const revision = getTokenRevision()
  setToken(current)
  assert.equal(getTokenRevision(), revision)
})
test('token ABA and removal advance monotonic authority even if the bearer returns to its old value', () => {
  setToken('fixture-A')
  const before = getTokenRevision()
  setToken('fixture-B')
  assert.equal(getTokenRevision(), before + 1)
  setToken('fixture-A')
  assert.equal(getTokenRevision(), before + 2)
  setToken(null)
  assert.equal(getTokenRevision(), before + 3)
})
test('failed storage write never rolls back an already-published runtime token authority', () => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: () => null,
      setItem: () => {
        throw new Error('controlled quota')
      },
      removeItem: () => {
        throw new Error('controlled quota')
      },
    },
  })
  const before = getTokenRevision()
  setToken('fixture-unsaved')
  assert.equal(getToken(), 'fixture-unsaved')
  assert.equal(getTokenRevision(), before + 1)
  setToken(null)
  assert.equal(getTokenRevision(), before + 2)
})
