/* Ключ остаётся в durable fallback, пока именно текущий backend не подтвердит запись. */
import { useStore } from '../store'
import { flushPersistence } from '../store/persistence'
import { authHeader } from './token'
import { backendOnline, useBackend } from './backend'
import {
  vaultScope,
  vaultSynced,
  vaultIntentGeneration,
  vaultClearIntent,
  pendingVaultDeletes,
  acknowledgeVaultDelete,
} from './vaultState'
import type { Provider } from '../types'

type Mode = 'dpapi' | 'file'
type Context = {
  scope: string
  ready: boolean
  busy: boolean
  initing: boolean
  again: boolean
  failedAt: number
}
let context: Context = freshContext()
let timer: ReturnType<typeof setTimeout> | undefined
let started = false
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
export const isVaulted = (p: Pick<Provider, 'id' | 'apiKey'>) =>
  !!p.apiKey && vaultSynced().get(p.id) === p.apiKey

async function init(c: Context) {
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
      !vaultClearIntent(p.id)
    )
      fromVault[p.id] = remote
  }
  const remaining = new Set(useStore.getState().providers.map((p) => p.id))
  for (const id of before.keys()) if (!remaining.has(id) && items[id]) synced.set(id, items[id])
  // An earlier init may have failed after a local clear/remove. Preserve its intent on retry.
  for (const id of pendingVaultDeletes()) if (items[id]) synced.set(id, items[id])
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
      if (key && synced.get(id) !== key) {
        await api(c, '/api/secrets/set', { id, value: key })
        if (generation === vaultIntentGeneration(id)) synced.set(id, key)
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
  } catch {
    c.failedAt = Date.now()
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
      context = freshContext()
      vaultMode = null
      vaultSynced() // revoke old acknowledgements before persisting fallback
      void flushPersistence().catch(() => {})
    }
    const c = context
    if (c.ready || c.initing || !backendOnline() || Date.now() - c.failedAt < 30_000) return
    c.initing = true
    void init(c)
      .catch(() => {
        c.failedAt = Date.now()
        if (current(c)) c.ready = false
      })
      .finally(() => {
        c.initing = false
      })
  }
  useBackend.subscribe(tryInit)
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
