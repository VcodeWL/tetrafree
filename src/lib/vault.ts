/* Ключ остаётся в durable fallback, пока именно текущий backend не подтвердит запись. */
import { useStore } from '../store'
import { flushPersistence, capturePersistenceGeneration } from '../store/persistence'
import { authHeader } from './token'
import { useAccount, confirmedAccountId, verifySession } from './account'
import { backendOnline, useBackend } from './backend'
import {
  vaultScope,
  vaultSynced,
  vaultIntentGeneration,
  vaultClearIntent,
  pendingVaultDeletes,
  acknowledgeVaultDelete,
  acknowledgeVaultReplacement,
  configureVaultIdentity,
  vaultDurableScope,
  vaultRemoteFillBlocked,
  prepareVaultReplacement,
  vaultClearedProviderIds,
  vaultBackendIdentity,
} from './vaultState'
import { readVaultOutbox } from './vaultOutbox'
import type { Provider } from '../types'

configureVaultIdentity(confirmedAccountId, () => capturePersistenceGeneration().hydrated)

type Mode = 'dpapi' | 'file'
type Context = {
  scope: string
  ready: boolean
  busy: boolean
  initing: boolean
  again: boolean
  failedAt: number
  warned?: boolean
}
let context: Context = freshContext()
let timer: ReturnType<typeof setTimeout> | undefined
let started = false
let retry: ReturnType<typeof setTimeout> | undefined
export let vaultMode: Mode | null = null
function freshContext(): Context {
  return { scope: vaultScope(), ready: false, busy: false, initing: false, again: false, failedAt: 0 }
}
const current = (c: Context) => c === context && c.scope === vaultScope()
async function api<T>(c: Context, path: string, body?: unknown): Promise<T> {
  if (!current(c)) throw new Error('Хранилище сменилось')
  const r = await fetch(useBackend.getState().base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...authHeader() },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  const value = await r.json()
  if (!current(c)) throw new Error('Ответ прежнего хранилища отклонён')
  return value as T
}
export function isVaulted(p: Pick<Provider, 'id' | 'apiKey'>) {
  try {
    return !!p.apiKey && !vaultClearIntent(p.id) && vaultSynced().get(p.id) === p.apiKey
  } catch {
    return false
  } // corrupt metadata is never an ACK and must not crash provider rendering
}
function warn(c: Context) {
  if (!current(c) || c.warned) return
  c.warned = true
  useStore.getState().toast({
    title: 'Хранилище ключей требует внимания',
    desc: 'Не удалось подтвердить запись или удаление. Намерение сохранено, если хранилище устройства доступно; автоматическое восстановление удалённых ключей заблокировано. Повторим через 30 секунд.',
    tone: 'warn',
    icon: 'warn',
  })
}
function retryAfter(c: Context, work: () => void) {
  if (!current(c)) return
  clearTimeout(retry)
  retry = setTimeout(() => {
    if (current(c) && backendOnline()) work()
  }, 30_000)
}

export type VaultRecoveryState = { blocked: boolean; checking: boolean; error: string | null }
let recoveryState: VaultRecoveryState = { blocked: false, checking: false, error: null }
let recoveredScope: string | undefined
let recoveryFlight: Promise<void> | undefined
const recoveryListeners = new Set<() => void>()
function recoveryStatus(patch: Partial<VaultRecoveryState>) {
  const next = { ...recoveryState, ...patch }
  if (
    next.blocked === recoveryState.blocked &&
    next.checking === recoveryState.checking &&
    next.error === recoveryState.error
  )
    return
  recoveryState = next
  for (const listener of recoveryListeners) listener()
}
function relevantRecovery() {
  const backend = vaultBackendIdentity()
  return readVaultOutbox().entries.some((entry) => {
    let scope: unknown
    try {
      scope = JSON.parse(entry.scope)
    } catch {
      throw new Error('Журнал удаления ключей повреждён. Исходные данные сохранены.')
    }
    if (!Array.isArray(scope) || scope.length !== 2 || scope.some((x) => typeof x !== 'string'))
      throw new Error('Журнал удаления ключей повреждён. Исходные данные сохранены.')
    return scope[0] === backend
  })
}
function refreshRecovery() {
  try {
    recoveryStatus({ blocked: relevantRecovery() && recoveredScope !== vaultScope() })
  } catch (error) {
    recoveryStatus({
      blocked: true,
      error: error instanceof Error ? error.message : 'Журнал ключей недоступен.',
    })
  }
}
/** Stable snapshot + subscription for useSyncExternalStore. Keep Auth reachable when blocked. */
export const vaultRecoveryState = () => recoveryState
/** Action-boundary guard must also see token-only changes before account subscribers publish.
 * Keep this read pure: React's stable recovery snapshot is updated by subscriptions/preparation.
 */
export function vaultStartupBlocked(): boolean {
  try {
    return recoveryState.blocked || (relevantRecovery() && recoveredScope !== vaultScope())
  } catch {
    return true
  }
}
export function subscribeVaultRecovery(listener: () => void) {
  recoveryListeners.add(listener)
  return () => {
    recoveryListeners.delete(listener)
  }
}
/** After hydration, BEFORE writable UI/background work. Unknown identity rejects without
 * modifying raw metadata or a possibly different account's fallback. Login can retry this API.
 */
export function prepareVaultRecovery(): Promise<void> {
  if (recoveryFlight) return recoveryFlight
  refreshRecovery()
  recoveryStatus({ checking: true, error: null })
  recoveryFlight = (async () => {
    if (!useStore.persist.hasHydrated()) throw new Error('Сначала дождись загрузки состояния приложения.')
    if (relevantRecovery()) {
      if (!confirmedAccountId()) await verifySession()
      if (!confirmedAccountId())
        throw new Error(
          'Нужно подтвердить аккаунт для восстановления удаления ключей. Подключись к прежнему backend и повтори проверку либо войди в аккаунт.',
        )
      const scope = vaultScope()
      await reconcileClearedKeys()
      if (scope !== vaultScope())
        throw new Error('Аккаунт или backend сменился во время восстановления ключей. Повтори проверку.')
    }
    recoveredScope = vaultScope()
    recoveryStatus({ blocked: false, error: null })
  })()
    .catch((error: unknown) => {
      recoveryStatus({
        blocked: true,
        error: error instanceof Error ? error.message : 'Не удалось восстановить удаление ключей.',
      })
      throw error
    })
    .finally(() => {
      recoveryFlight = undefined
      recoveryStatus({ checking: false })
    })
  return recoveryFlight
}
// Identity/base changes block synchronously; successful login may reconcile without remounting Auth.
const identityChanged = () => {
  refreshRecovery()
  if (recoveryState.blocked && confirmedAccountId() && useStore.persist.hasHydrated() && !recoveryFlight)
    void prepareVaultRecovery().catch(() => {})
}
useBackend.subscribe(identityChanged)
useAccount.subscribe(identityChanged)
refreshRecovery()
async function reconcileClearedKeys() {
  // Tombstones win even over a pre-clear app snapshot left by an interrupted checkpoint.
  const blocked = useStore.getState().providers.filter((p) => p.apiKey && vaultClearIntent(p.id))
  if (blocked.length) {
    const ids = new Set(blocked.map((p) => p.id))
    useStore.setState((s) => {
      for (const p of s.providers) if (ids.has(p.id)) p.apiKey = ''
    })
  }
  // Also retry a previously FAILED reconciliation: an already-empty in-memory key is NOT a durable proof.
  if (blocked.length || vaultClearedProviderIds().length) await flushPersistence()
}
async function init(c: Context) {
  // Commit reconciliation before any GET/SET; never upload a resurrected fallback key.
  await reconcileClearedKeys()
  if (!current(c)) return
  // Empty AFTER this GET started may be an intentional local clear, not an invitation
  // to restore the old remote value. Capture the key set before the first await.
  const before = new Map(
    useStore.getState().providers.map((p) => [
      p.id,
      {
        key: p.apiKey,
        generation: vaultIntentGeneration(p.id),
      },
    ]),
  )
  const { mode, items } = await api<{ mode: Mode; items: Record<string, string> }>(c, '/api/secrets')
  vaultMode = mode
  const synced = vaultSynced()
  const fromVault: Record<string, string> = {}
  for (const p of useStore.getState().providers) {
    const remote = items[p.id]
    if (!remote) continue
    // Record what actually exists remotely so push can delete a locally-cleared key.
    synced.set(p.id, remote)
    const captured = before.get(p.id)
    if (
      !p.apiKey &&
      captured?.key === p.apiKey &&
      captured.generation === vaultIntentGeneration(p.id) &&
      !vaultRemoteFillBlocked(p.id)
    )
      fromVault[p.id] = remote
  }
  const remaining = new Set(useStore.getState().providers.map((p) => p.id))
  for (const id of before.keys()) if (!remaining.has(id) && items[id]) synced.set(id, items[id])
  // An earlier init may have failed after a local clear/remove. Preserve its intent on retry.
  for (const id of vaultClearedProviderIds()) if (items[id]) synced.set(id, items[id])
  c.ready = true
  if (Object.keys(fromVault).length)
    useStore.setState((s) => {
      s.providers = s.providers.map((p) => (fromVault[p.id] ? { ...p, apiKey: fromVault[p.id] } : p))
    })
  // Persist acknowledgement without manufacturing another provider change/subscriber loop.
  await flushPersistence()
  await push(c)
}
async function push(c: Context) {
  if (!current(c) || !c.ready) return
  if (c.busy) {
    c.again = true
    return
  }
  c.busy = true
  let changed = false
  try {
    const synced = vaultSynced()
    const now = new Map(useStore.getState().providers.map((p) => [p.id, p.apiKey]))
    for (const [id, key] of now) {
      const generation = vaultIntentGeneration(id)
      if (key && !vaultClearIntent(id) && synced.get(id) !== key) {
        // A replacement must have an app checkpoint before its server ACK retires a tombstone.
        const checkpointRevision = capturePersistenceGeneration().current
        await flushPersistence()
        if (!current(c) || generation !== vaultIntentGeneration(id)) {
          c.again = true
          continue
        }
        if (!prepareVaultReplacement(id, generation, checkpointRevision)) {
          c.again = true
          continue
        }
        await api(c, '/api/secrets/set', { id, value: key })
        if (generation === vaultIntentGeneration(id) && acknowledgeVaultReplacement(id, generation))
          synced.set(id, key)
        else c.again = true // never acknowledge a stale SET after a local ABA
        changed = true
      } else if (!key && (synced.has(id) || pendingVaultDeletes().includes(id))) {
        await api(c, '/api/secrets/delete', { id })
        synced.delete(id)
        acknowledgeVaultDelete(id, generation)
        if (generation !== vaultIntentGeneration(id)) c.again = true
        changed = true
      }
    }
    for (const id of new Set([...synced.keys(), ...pendingVaultDeletes()]))
      if (!now.has(id)) {
        const generation = vaultIntentGeneration(id)
        await api(c, '/api/secrets/delete', { id })
        synced.delete(id)
        acknowledgeVaultDelete(id, generation)
        if (generation !== vaultIntentGeneration(id)) c.again = true
        changed = true
      }
    if (changed && current(c)) await flushPersistence()
    c.failedAt = 0
    c.warned = false
    if (current(c)) {
      clearTimeout(retry)
      retry = undefined
    }
  } catch {
    c.failedAt = Date.now()
    warn(c)
    retryAfter(c, () => void push(c))
  } finally {
    c.busy = false
    if (c.again && current(c)) {
      c.again = false
      void push(c)
    }
  }
}
const signature = (providers: Provider[]) =>
  JSON.stringify([vaultIntentGeneration(), providers.map((p) => [p.id, p.apiKey]).sort()])
export function startVault() {
  if (started) return
  started = true
  const tryInit = () => {
    if (context.scope !== vaultScope()) {
      clearTimeout(timer)
      clearTimeout(retry)
      context = freshContext()
      vaultMode = null
      vaultSynced() // revoke old acknowledgements before persisting fallback
      void flushPersistence().catch(() => {})
    }
    const c = context
    if (
      c.ready ||
      c.initing ||
      !backendOnline() ||
      !vaultDurableScope(false) ||
      Date.now() - c.failedAt < 30_000
    )
      return
    c.initing = true
    void init(c)
      .catch(() => {
        c.failedAt = Date.now()
        if (current(c)) {
          c.ready = false
          warn(c)
          retryAfter(c, tryInit)
        }
      })
      .finally(() => {
        c.initing = false
      })
  }
  useBackend.subscribe(tryInit)
  useAccount.subscribe(tryInit)
  let prev = signature(useStore.getState().providers)
  useStore.subscribe((s) => {
    tryInit()
    const next = signature(s.providers)
    if (prev === next) return
    prev = next
    if (!context.ready) return
    clearTimeout(timer)
    const c = context
    timer = setTimeout(() => void push(c), 500)
  })
  tryInit()
}
