/* Подтверждение ключа действительно только для этого backend и контекста доступа. */
import type { Provider } from '../types'
import { useBackend } from './backend'
import { getToken, getTokenRevision } from './token'
import {
  readVaultOutbox,
  enqueueVaultDelete,
  acknowledgeOutbox,
  prepareOutboxReplacement,
} from './vaultOutbox'

let hydratedRevision: () => number = () => -1
let identity: (() => string | null) | undefined
let sessionRevision: () => number = () => 0
export const vaultScope = () =>
  JSON.stringify([
    useBackend.getState().base,
    getToken(),
    getTokenRevision(),
    identity?.() ?? null,
    sessionRevision(),
  ])
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
/** Identity is supplied by the vault runtime, avoiding account → store → settings cycles.
 * Until a signed-in account is known, durable mutations fail closed. No bearer is persisted.
 */
export function configureVaultIdentity(
  resolve: () => string | null,
  hydrated: () => number = () => -1,
  session: () => number = () => 0,
) {
  identity = resolve
  hydratedRevision = hydrated
  sessionRevision = session
}
export function vaultDurableScope(required = true) {
  const account = identity?.()
  if (!identity) return null // isolated pure consumers have no account runtime
  if (!account) {
    if (required) throw new Error('Дождись проверки аккаунта перед изменением ключей.')
    return null
  }
  return JSON.stringify([vaultBackendIdentity(), account])
}
export function vaultBackendIdentity() {
  const base = useBackend.getState().base
  let backend = base
  try {
    const url = new URL(base || '/', globalThis.location?.origin)
    if (url.username || url.password || url.search || url.hash) throw new Error('UNSAFE_SCOPE')
    backend = url.href.replace(/\/+$/, '')
  } catch (error) {
    if (error instanceof Error && error.message === 'UNSAFE_SCOPE')
      throw new Error('Для хранилища ключей нужен адрес backend без учётных данных и query-параметров.')
    /* relative app origin is unavailable only in pure/node consumers */
  }
  return backend
}
type KeyIntent = {
  generation: number
  scope: string
  clear: boolean
  pendingDelete: boolean
}
const intents = new Map<string, KeyIntent>()
// Metadata proof of this runtime's already-flushed replacement. Token/epoch rotation must
// not confuse it with a pre-checkpoint intent; hydrated revision is intentionally immutable.
const replacementProofs = new Map<string, { generation: number; revision: number }>()
const replacementProofKey = (id: string) => JSON.stringify([vaultDurableScope(false), id])
let intentGeneration = 0
const intentKey = (id: string) => JSON.stringify([vaultScope(), id])
function durable(id?: string) {
  const scope = vaultDurableScope(false)
  return scope
    ? readVaultOutbox().entries.filter((e) => e.scope === scope && (id === undefined || e.id === id))
    : []
}
export function recordVaultKeyIntent(id: string, clear: boolean, requireIdentity = false) {
  if (clear && requireIdentity && !identity)
    throw new Error('Проверка аккаунта для хранилища ключей ещё не запущена.')
  const scope = vaultDurableScope(clear)
  // A replacement of a tombstoned key remains deleted after a crash until SET is ACKed.
  // The new secret is never included in this journal.
  const prior = scope ? durable(id)[0] : undefined
  const generation =
    scope && (clear || prior)
      ? enqueueVaultDelete(scope, id, localStorage, intentGeneration)
      : ++intentGeneration
  intentGeneration = Math.max(intentGeneration + 1, generation)
  intents.set(intentKey(id), { generation, scope: vaultScope(), clear, pendingDelete: clear })
  vaultSynced().delete(id)
}
function activeIntent(id: string) {
  const intent = intents.get(intentKey(id))
  const entry = durable(id)[0]
  return intent && (!entry || intent.generation >= entry.generation) ? intent : undefined
}
export const vaultIntentGeneration = (id?: string): number =>
  id === undefined ? intentGeneration : (activeIntent(id)?.generation ?? durable(id)[0]?.generation ?? 0)
export const vaultClearIntent = (id: string) => {
  const intent = activeIntent(id)
  if (intent) return intent.clear
  const entry = durable(id)[0]
  const proof = replacementProofs.get(replacementProofKey(id))
  const confirmedReplacement =
    entry?.replacementRevision !== undefined &&
    (hydratedRevision() >= entry.replacementRevision ||
      (proof?.generation === entry.generation && proof.revision === entry.replacementRevision))
  return !!entry && !confirmedReplacement
}
export const vaultRemoteFillBlocked = (id: string) => vaultClearIntent(id) || !!durable(id)[0]
export function prepareVaultReplacement(id: string, generation: number, revision: number) {
  if (generation !== vaultIntentGeneration(id)) return false
  const scope = vaultDurableScope()
  const committed = !scope || prepareOutboxReplacement(scope, id, generation, revision)
  if (committed && scope) replacementProofs.set(replacementProofKey(id), { generation, revision })
  return committed
}
export const pendingVaultDeletes = () => {
  const ids = new Set(
    durable()
      .filter((e) => e.pending && vaultClearIntent(e.id))
      .map((e) => e.id),
  )
  for (const [key, intent] of intents) {
    if (intent.scope !== vaultScope()) continue
    const id = JSON.parse(key)[1] as string
    if (activeIntent(id) !== intent) continue
    if (intent.pendingDelete) ids.add(id)
    else ids.delete(id)
  }
  return [...ids]
}
export function vaultClearedProviderIds() {
  const ids = new Set(durable().map((e) => e.id))
  for (const [key, intent] of intents)
    if (intent.scope === vaultScope()) ids.add(JSON.parse(key)[1] as string)
  return [...ids].filter(vaultClearIntent)
}
export function acknowledgeVaultDelete(id: string, generation: number) {
  if (generation !== vaultIntentGeneration(id)) return
  const scope = vaultDurableScope()
  if (scope && !acknowledgeOutbox(scope, id, generation)) return
  const intent = intents.get(intentKey(id))
  if (intent) intent.pendingDelete = false
}
export function acknowledgeVaultReplacement(id: string, generation: number) {
  if (generation !== vaultIntentGeneration(id)) return false
  const scope = vaultDurableScope()
  if (scope && durable(id).length && !acknowledgeOutbox(scope, id, generation, true)) return false
  return true
}

export function stripSecrets(providers: Provider[]): Provider[] {
  const confirmed = vaultSynced()
  return providers.map((p) => (p.apiKey && confirmed.get(p.id) === p.apiKey ? { ...p, apiKey: '' } : p))
}
