import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stale, nameFor, isBackupName } from './backups.mjs'

test('nameFor: формат и распознавание', () => {
  const n = nameFor(new Date(2025, 9, 5, 7, 8, 9))
  assert.equal(n, 'tetrafree-auto-20251005-070809.json')
  assert.ok(isBackupName(n))
  assert.ok(!isBackupName('../x.json'))
  assert.ok(!isBackupName('tetrafree-auto-1.json'))
})
test('stale: оставляет самые новые и не трогает чужие файлы', () => {
  const names = [
    'tetrafree-auto-20251001-000000.json',
    'tetrafree-auto-20251003-000000.json',
    'tetrafree-auto-20251002-000000.json',
    'my-notes.json',
  ]
  assert.deepEqual(stale(names, 2), ['tetrafree-auto-20251001-000000.json'])
  assert.deepEqual(stale(names, 10), [])
  assert.deepEqual(stale(names, 0), [
    'tetrafree-auto-20251001-000000.json',
    'tetrafree-auto-20251002-000000.json',
  ])
})
