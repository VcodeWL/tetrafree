import test from 'node:test'
import assert from 'node:assert/strict'
import { put, purge, freePath, daysLeft, TRASH_DAYS } from './trash'

const D = 864e5
test('put заменяет тот же путь и чистит старое', () => {
  const now = 100 * D
  const old = [
    { path: 'a.ts', content: 'old', at: now - 5 * D },
    { path: 'x.ts', content: 'x', at: now - 31 * D },
  ]
  const r = put(old, { 'a.ts': 'new', 'b.ts': 'b' }, now)
  assert.deepEqual(r.map((x) => x.path).sort(), ['a.ts', 'b.ts'])
  assert.equal(r.find((x) => x.path === 'a.ts')!.content, 'new')
})
test('большие файлы не попадают', () => assert.equal(put([], { 'big.bin': 'x'.repeat(500_000) }).length, 0))
test('purge и daysLeft', () => {
  assert.equal(purge([{ path: 'a', content: '', at: 0 }], (TRASH_DAYS + 1) * D).length, 0)
  assert.equal(daysLeft(0, 10 * D), 20)
})
test('freePath', () => {
  const have = new Set(['src/a.ts', 'src/a (восстановлено).ts'])
  assert.equal(
    freePath((p) => have.has(p), 'src/b.ts'),
    'src/b.ts',
  )
  assert.equal(
    freePath((p) => have.has(p), 'src/a.ts'),
    'src/a (восстановлено 2).ts',
  )
  assert.equal(
    freePath((p) => p === 'Makefile', 'Makefile'),
    'Makefile (восстановлено)',
  )
})
