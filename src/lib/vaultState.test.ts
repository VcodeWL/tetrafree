import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stripSecrets, vaultSynced } from './vaultState'
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
