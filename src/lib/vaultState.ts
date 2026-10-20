/* Подтверждение ключа действительно только для этого backend и контекста доступа. */
import type { Provider } from '../types'
import { useBackend } from './backend'
import { getToken } from './token'

export const vaultScope = () => JSON.stringify([useBackend.getState().base, getToken()])
let scope = vaultScope()
let synced = new Map<string, string>()
/** На смене backend/token прежние подтверждения НЕ разрешают удаление fallback-ключей. */
export function vaultSynced() {
  const current = vaultScope()
  if (current !== scope) {
    scope = current
    synced = new Map()
  }
  return synced
}
/** Local mutation intent is not inferred from key equality (empty → key → empty is ABA).
 * Pure in-memory metadata: no store import, no secrets, no persistence or network side effects.
 */
type KeyIntent = { generation: number; scope: string; clear: boolean; pendingDelete: boolean }
const intents = new Map<string, KeyIntent>()
let intentGeneration = 0
export function recordVaultKeyIntent(id: string, clear: boolean) {
  const generation = ++intentGeneration
  intents.set(id, { generation, scope: vaultScope(), clear, pendingDelete: clear })
  vaultSynced().delete(id)
}
export const vaultIntentGeneration = (id?: string) =>
  id === undefined ? intentGeneration : (intents.get(id)?.generation ?? 0)
export const vaultClearIntent = (id: string) => {
  const intent = intents.get(id)
  return intent?.scope === vaultScope() && intent.clear
}
export const pendingVaultDeletes = () =>
  [...intents].filter(([, intent]) => intent.scope === vaultScope() && intent.pendingDelete).map(([id]) => id)
export function acknowledgeVaultDelete(id: string, generation: number) {
  const intent = intents.get(id)
  if (intent?.generation === generation) intent.pendingDelete = false
  // Keep clear intent after ACK: a retry GET cannot turn it back into a hydration placeholder.
}

export function stripSecrets(providers: Provider[]): Provider[] {
  const confirmed = vaultSynced()
  return providers.map((p) => (p.apiKey && confirmed.get(p.id) === p.apiKey ? { ...p, apiKey: '' } : p))
}
