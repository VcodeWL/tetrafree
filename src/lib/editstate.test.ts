import test from 'node:test'
import assert from 'node:assert/strict'
import { useEdit, editPending, editSaved, editIdle } from './editstate'
test('editor observations retain origin and stale cleanup cannot clear another project', () => {
  editIdle()
  editPending('same.txt', 'A')
  assert.equal(useEdit.getState().pid, 'A')
  editSaved('same.txt', 'B')
  editIdle('A')
  assert.equal(useEdit.getState().pid, 'B')
  assert.ok(useEdit.getState().savedAt > 0)
  editPending('same.txt', 'A')
  assert.equal(useEdit.getState().savedAt, 0)
  editIdle('A')
  assert.equal(useEdit.getState().pid, null)
})
