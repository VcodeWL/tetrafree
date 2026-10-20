import test from 'node:test'
import assert from 'node:assert/strict'
import {
  VAULT_OUTBOX_KEY,
  readVaultOutbox,
  enqueueVaultDelete,
  acknowledgeOutbox,
  prepareOutboxReplacement,
} from './vaultOutbox'
class Memory {
  raw: string | null = null
  drop = false
  quota = false
  getItem() {
    return this.raw
  }
  setItem(_key: string, raw: string) {
    if (this.quota) throw new Error('quota')
    if (!this.drop) this.raw = raw
  }
}
test('durable metadata survives fresh readers, retains sticky delete ACK, never stores secret/token', () => {
  const storage = new Memory()
  const gen = enqueueVaultDelete('["http://localhost:3001","account-A"]', 'provider', storage)
  assert.equal(readVaultOutbox(storage).entries[0].pending, true)
  acknowledgeOutbox('["http://localhost:3001","account-A"]', 'provider', gen, false, storage)
  assert.equal(readVaultOutbox(storage).entries[0].pending, false)
  assert.match(storage.raw!, /account-A/)
  assert.deepEqual(Object.keys(readVaultOutbox(storage).entries[0]).sort(), [
    'generation',
    'id',
    'pending',
    'scope',
  ])
})
test('ABA and cross-account/backend stale ACK never retire current clear', () => {
  const s = new Memory()
  const a = enqueueVaultDelete('backend-A/account-A', 'id', s)
  const b = enqueueVaultDelete('backend-A/account-A', 'id', s)
  assert.ok(b > a)
  assert.equal(acknowledgeOutbox('backend-A/account-A', 'id', a, true, s), false)
  assert.equal(acknowledgeOutbox('backend-B/account-A', 'id', b, true, s), false)
  assert.equal(acknowledgeOutbox('backend-A/account-B', 'id', b, true, s), false)
  assert.equal(readVaultOutbox(s).entries[0].pending, true)
})
test('quota and silent dropped write fail before ACK; corrupt/unsupported raw is preserved', () => {
  for (const kind of ['quota', 'drop'] as const) {
    const s = new Memory()
    s[kind] = true
    assert.throws(() => enqueueVaultDelete('scope', 'id', s))
    assert.equal(s.raw, null)
  }
  for (const raw of [
    '{bad',
    '{"version":2,"generation":0,"entries":[]}',
    '{"version":1,"generation":1,"entries":[{}]}',
  ]) {
    const s = new Memory()
    s.raw = raw
    assert.throws(() => enqueueVaultDelete('scope', 'id', s))
    assert.equal(s.raw, raw)
  }
})
test('failed durable ACK leaves delete pending, replacement proof is CAS and metadata only', () => {
  const s = new Memory()
  const gen = enqueueVaultDelete('scope', 'id', s)
  s.quota = true
  assert.throws(() => acknowledgeOutbox('scope', 'id', gen, false, s))
  assert.equal(readVaultOutbox(s).entries[0].pending, true)
  s.quota = false
  assert.equal(prepareOutboxReplacement('scope', 'id', gen - 1, 7, s), false)
  assert.equal(prepareOutboxReplacement('scope', 'id', gen, 7, s), true)
  assert.equal(readVaultOutbox(s).entries[0].replacementRevision, 7)
  acknowledgeOutbox('scope', 'id', gen, false, s)
  assert.equal(readVaultOutbox(s).entries[0].replacementRevision, undefined)
  assert.equal(acknowledgeOutbox('scope', 'id', gen, true, s), true)
  assert.equal(readVaultOutbox(s).entries.length, 0)
  assert.ok(VAULT_OUTBOX_KEY.length)
})
