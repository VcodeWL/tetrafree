import test from 'node:test'
import assert from 'node:assert/strict'
import { packVersions, unpackVersions } from './snapshots'
import type { Version } from '../types'

const v = (n: number, snapshot: Record<string, string>): Version => ({
  n,
  title: 'v' + n,
  at: n,
  by: 'human',
  author: 'me',
  tag: 'build',
  feats: [],
  changes: [],
  fixes: [],
  details: [],
  snapshot,
})

test('pack → unpack возвращает те же версии', () => {
  const vs = [
    v(1, { a: '1', b: '2' }),
    v(2, { a: '1', b: '22', c: '3' }),
    v(3, { b: '22', c: '3' }),
    v(4, {}),
    v(5, { z: 'z' }),
  ]
  assert.deepEqual(unpackVersions(JSON.parse(JSON.stringify(packVersions(vs)))), vs)
})
test('в упакованном виде неизменные файлы не дублируются', () => {
  const big = 'x'.repeat(10_000)
  const vs = Array.from({ length: 30 }, (_, i) => v(i + 1, { big, small: String(i) }))
  const size = JSON.stringify(packVersions(vs)).length
  assert.ok(size < 15_000, 'размер ' + size)
  assert.ok(JSON.stringify(vs).length > 300_000)
})
test('старый формат (с полным снимком) читается как есть', () => {
  const vs = [v(1, { a: '1' }), v(2, { a: '2' })]
  assert.deepEqual(unpackVersions(vs), vs)
})
test('пустой список', () => {
  assert.deepEqual(unpackVersions(packVersions([])), [])
})
