import { test } from 'node:test'
import assert from 'node:assert/strict'
import { wantsGit, clipDiff } from './gitctx'

test('wantsGit: только про изменения', () => {
  for (const s of [
    'отревьюй текущий diff',
    'что я изменил?',
    'сделай коммит',
    'проверь правки',
    'review my changes',
  ])
    assert.ok(wantsGit(s), s)
  for (const s of ['напиши функцию сортировки', 'объясни, как работает кэш']) assert.ok(!wantsGit(s), s)
})
test('clipDiff: убирает служебные строки и режет', () => {
  const d = 'diff --git a/x b/x\nindex 1..2\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n'
  assert.ok(!clipDiff(d, 999).includes('index '))
  assert.ok(clipDiff(d, 999).includes('+b'))
  assert.ok(clipDiff('x'.repeat(100), 10).endsWith('обрезано'))
})
