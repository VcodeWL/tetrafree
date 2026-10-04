import test from 'node:test'
import assert from 'node:assert/strict'
import { upsert, describe, isEmpty, same, EMPTY } from './taskviews'

test('upsert заменяет одноимённый вид и держит его id', () => {
  const a = upsert([], 'Горит', { ...EMPTY, late: true }, 'v1')
  const b = upsert(a, 'горит', { ...EMPTY, who: 'me' }, 'v2')
  assert.equal(b.length, 1)
  assert.equal(b[0].id, 'v1')
  assert.equal(b[0].f.who, 'me')
})
test('лимит 12 видов', () => {
  let l = [] as ReturnType<typeof upsert>
  for (let i = 0; i < 15; i++) l = upsert(l, 'v' + i, EMPTY, 'id' + i)
  assert.equal(l.length, 12)
  assert.equal(l[11].name, 'v14')
})
test('describe / isEmpty / same', () => {
  assert.equal(describe(EMPTY), 'все задачи')
  assert.equal(
    describe({ who: 'me', q: ' api ', label: 'баг', late: true }),
    'мои · просроченные · метка «баг» · «api»',
  )
  assert.ok(isEmpty({ ...EMPTY, q: '  ' }))
  assert.ok(same(EMPTY, { ...EMPTY, q: ' ' }))
})
