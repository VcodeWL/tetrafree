import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  stripSecrets,
  vaultSynced,
  recordVaultKeyIntent,
  vaultIntentGeneration,
  vaultClearIntent,
  pendingVaultDeletes,
  acknowledgeVaultDelete,
} from './vaultState'
import { useBackend } from './backend'
import type { Provider } from '../types'

const P = (id: string, apiKey: string) => ({ id, apiKey, name: id }) as unknown as Provider

test('в хранилище уходят только подтверждённые ключи', () => {
  vaultSynced().clear()
  vaultSynced().set('a', 'KEY-A')
  const out = stripSecrets([P('a', 'KEY-A'), P('b', 'KEY-B'), P('c', '')])
  assert.deepEqual(
    out.map((p) => p.apiKey),
    ['', 'KEY-B', ''],
  )
})

test('изменённый ключ остаётся в localStorage, пока сервер его не подтвердил', () => {
  vaultSynced().clear()
  vaultSynced().set('a', 'OLD')
  assert.equal(stripSecrets([P('a', 'NEW')])[0].apiKey, 'NEW')
})

test('intent generation is monotonic through ABA and stale delete ACK cannot clear newer intent', () => {
  const id = 'intent-ABA'
  recordVaultKeyIntent(id, true)
  const first = vaultIntentGeneration(id)
  recordVaultKeyIntent(id, false)
  const middle = vaultIntentGeneration(id)
  recordVaultKeyIntent(id, true)
  const last = vaultIntentGeneration(id)
  assert.ok(first < middle && middle < last)
  assert.equal(vaultClearIntent(id), true)
  acknowledgeVaultDelete(id, first)
  assert.equal(pendingVaultDeletes().includes(id), true)
  acknowledgeVaultDelete(id, last)
  assert.equal(pendingVaultDeletes().includes(id), false)
  assert.equal(vaultClearIntent(id), true)
})
test('same empty explicit save is still a new intent; pending deletes do not cross backend scope', () => {
  const id = 'same-empty'
  const oldBase = useBackend.getState().base
  useBackend.setState({ base: 'intent-A:' })
  recordVaultKeyIntent(id, true)
  const first = vaultIntentGeneration(id)
  recordVaultKeyIntent(id, true)
  assert.ok(vaultIntentGeneration(id) > first)
  assert.equal(pendingVaultDeletes().includes(id), true)
  useBackend.setState({ base: 'intent-B:' })
  assert.equal(pendingVaultDeletes().includes(id), false)
  assert.equal(vaultClearIntent(id), false)
  useBackend.setState({ base: 'intent-A:' })
  assert.equal(vaultClearIntent(id), true)
  acknowledgeVaultDelete(id, vaultIntentGeneration(id))
  useBackend.setState({ base: oldBase })
})
