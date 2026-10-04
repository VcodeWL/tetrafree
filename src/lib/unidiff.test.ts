import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseDiff } from './unidiff'

test('parseDiff: нумерация строк и типы', () => {
  const d = parseDiff('diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n one\n-two\n+TWO\n three\n')
  const kinds = d.map((l) => l.t).join(',')
  assert.equal(kinds, 'meta,meta,meta,hunk,ctx,del,add,ctx')
  const del = d.find((l) => l.t === 'del')!,
    add = d.find((l) => l.t === 'add')!
  assert.equal(del.a, 2)
  assert.equal(add.b, 2)
  assert.equal(d[d.length - 1].a, 3)
})
test('parseDiff: пустой diff', () => assert.deepEqual(parseDiff(''), []))
