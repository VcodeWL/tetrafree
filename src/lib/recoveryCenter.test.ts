import test from 'node:test'
import assert from 'node:assert/strict'
import { recoveryEntries, recoveryVariants, restoreRecoveryCopy } from './recoveryCenter'
function tree(
  files: Record<string, string> = {},
  trash: { path: string; content: string; at: number }[] = [],
) {
  return { files, dirs: [] as string[], trash }
}
test('recovery center catalogs trash, disk/cloud copies, agent and blocked journals', () => {
  const p = tree(
    {
      'a.ts.disk-conflict': 'disk',
      'b.ts.cloud.2': 'cloud',
      'metadata.cloud.json': '{}',
      'files.journal-recovery.json': '{}',
      '.tetra/recovery/one.json': '{}',
      'regular.ts': 'live',
    },
    [{ path: 'deleted.txt', content: 'trash', at: 2 }],
  )
  assert.equal(recoveryEntries(p).length, 6)
  assert.equal(recoveryEntries(p)[0].kind, 'trash')
})
test('file variants preserve exact text including empty files; null deletion never replays', () => {
  const p = tree({
    '.tetra/recovery/one.json': JSON.stringify({
      files: { 'a.ts': 'one', empty: '', removed: null, '../outside': 'bad' },
    }),
  })
  const e = recoveryEntries(p)[0]
  assert.deepEqual(
    recoveryVariants(e).map((v) => [v.path, v.text]),
    [
      ['a.ts', 'one'],
      ['empty', ''],
    ],
  )
})
test('journal offers desired and prior files, not metadata or deletion', () => {
  const p = tree({
    'files.journal-recovery.json': JSON.stringify({
      desired: { files: { a: 'desired', b: null }, dirs: ['empty'] },
      prior: { files: { a: 'prior' } },
      meta: { password: 'not a mutation' },
    }),
  })
  assert.deepEqual(
    recoveryVariants(recoveryEntries(p)[0]).map((v) => [v.id, v.text]),
    [
      ['desired:a', 'desired'],
      ['prior:a', 'prior'],
    ],
  )
})
test('copy restoration preserves live, source and trash, choosing a new safe filename', () => {
  const p = tree({ 'a.ts': 'human', 'recovered/a.ts': 'existing' }, [{ path: 'a.ts', content: 'old', at: 1 }])
  const e = recoveryEntries(p)[0],
    v = recoveryVariants(e)[0]
  const path = restoreRecoveryCopy(p, e, v)
  assert.equal(path, 'recovered-2/a.ts')
  assert.equal(p.files['a.ts'], 'human')
  assert.equal(p.files['recovered/a.ts'], 'existing')
  assert.equal(p.files[path], 'old')
  assert.equal(p.trash.length, 1)
})
test('Windows case collisions, parent files and implicit folders are never overwritten', () => {
  for (const files of [
    { RECOVERED: 'file' },
    { 'recovered/a.ts/child': 'child' },
    { 'recovered/A.TS': 'case' },
  ] as Record<string, string>[]) {
    const p = tree(files, [{ path: 'a.ts', content: 'old', at: 1 }]),
      before = { ...p.files }
    const e = recoveryEntries(p)[0]
    const path = restoreRecoveryCopy(p, e, recoveryVariants(e)[0])
    assert.equal(path, 'recovered-2/a.ts')
    for (const [k, v] of Object.entries(before)) assert.equal(p.files[k], v)
  }
})
test('late source mutation or variant substitution cannot restore stale content', () => {
  const p = tree({ 'a.ts.disk-conflict': 'old' })
  const e = recoveryEntries(p)[0],
    v = recoveryVariants(e)[0]
  p.files[e.source] = 'new'
  assert.throws(() => restoreRecoveryCopy(p, e, v), /изменился/)
  assert.equal(Object.keys(p.files).length, 1)
  p.files[e.source] = 'old'
  assert.throws(() => restoreRecoveryCopy(p, e, { ...v, text: 'substitute' }), /изменилась/)
})
test('unknown/large metadata are downloadable data only, not interpreted mutations', () => {
  for (const text of ['bad JSON', '{"docs":[1]}', 'x'.repeat(4_000_001)]) {
    const e = recoveryEntries(tree({ 'metadata.cloud.json': text }))[0]
    assert.equal(recoveryVariants(e).length, 0)
    assert.equal(e.text, text)
  }
})
test('service file restore is detached from active configuration and never enables automations', () => {
  const p = tree({
    '.tetra/recovery/spec.json': JSON.stringify({
      files: { '.tetra/automations.json': '{"automations":[]}' },
    }),
  })
  const e = recoveryEntries(p)[0]
  const path = restoreRecoveryCopy(p, e, recoveryVariants(e)[0])
  assert.equal(path, 'recovered/automations.json')
  assert.equal(p.files['.tetra/automations.json'], undefined)
})
test('malformed imported trash path is refused; no write or path traversal', () => {
  const p = tree({}, [{ path: '../outside', content: 'old', at: 1 }])
  const e = recoveryEntries(p)[0]
  assert.throws(() => restoreRecoveryCopy(p, e, recoveryVariants(e)[0]), /Недопустимый/)
  assert.deepEqual(p.files, {})
})
