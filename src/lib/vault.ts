/* Ключи API провайдеров живут не в localStorage, а в хранилище на этом компьютере (server/secrets.mjs):
   на Windows шифруются DPAPI от имени пользователя. Здесь — синхронизация между памятью приложения и хранилищем.
   Пока хранилище недоступно (нет сервера), ключ остаётся в localStorage как раньше — потерять его нельзя. */
import { useStore } from '../store'
import { authHeader } from './token'
import { backendOnline, useBackend } from './backend'
import { vaultSynced } from './vaultState'
import type { Provider } from '../types'

type Mode = 'dpapi' | 'file'
let ready = false
let busy = false
let initing = false
let again = false
let failedAt = 0
let timer = 0
let started = false
export let vaultMode: Mode | null = null

async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(useBackend.getState().base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...authHeader() },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return (await r.json()) as T
}

/** сохранён ли ключ провайдера в защищённом хранилище (для подписи в настройках) */
export const isVaulted = (p: Pick<Provider, 'id' | 'apiKey'>) =>
  !!p.apiKey && vaultSynced().get(p.id) === p.apiKey

async function init() {
  const { mode, items } = await api<{ mode: Mode; items: Record<string, string> }>('/api/secrets')
  vaultMode = mode
  const synced = vaultSynced()
  const fromVault: Record<string, string> = {}
  for (const p of useStore.getState().providers) {
    const remote = items[p.id]
    if (remote && !p.apiKey) {
      fromVault[p.id] = remote
      synced.set(p.id, remote)
    } else if (remote && remote === p.apiKey) synced.set(p.id, remote)
  }
  ready = true
  /* setState заодно перезаписывает localStorage уже без подтверждённых ключей */
  useStore.setState((s) => {
    s.providers = s.providers.map((p) => (fromVault[p.id] ? { ...p, apiKey: fromVault[p.id] } : p))
  })
  await push()
}

/** отправляет изменившиеся ключи и удаляет пропавшие */
async function push() {
  if (!ready) return
  if (busy) {
    again = true
    return
  }
  busy = true
  try {
    const synced = vaultSynced()
    const now = new Map(useStore.getState().providers.map((p) => [p.id, p.apiKey]))
    for (const [id, key] of now) {
      if (key && synced.get(id) !== key) {
        await api('/api/secrets/set', { id, value: key })
        synced.set(id, key)
      } else if (!key && synced.has(id)) {
        await api('/api/secrets/delete', { id })
        synced.delete(id)
      }
    }
    for (const id of [...synced.keys()]) {
      if (!now.has(id)) {
        await api('/api/secrets/delete', { id })
        synced.delete(id)
      }
    }
    /* перезаписать localStorage без ключей */
    useStore.setState((s) => {
      s.providers = s.providers.map((p) => ({ ...p }))
    })
  } catch {
    failedAt = Date.now() /* ключи остаются в localStorage, повторим при следующем изменении */
  } finally {
    busy = false
    if (again) {
      again = false
      void push()
    }
  }
}

export function startVault() {
  if (started) return
  started = true
  const tryInit = () => {
    if (ready || initing || !backendOnline() || Date.now() - failedAt < 30_000) return
    initing = true
    init()
      .catch(() => {
        failedAt = Date.now()
      })
      .finally(() => {
        initing = false
      })
  }
  useBackend.subscribe(tryInit)
  let prev = useStore.getState().providers
  useStore.subscribe((s) => {
    if (!ready) return tryInit()
    if (s.providers === prev) return
    prev = s.providers
    window.clearTimeout(timer)
    timer = window.setTimeout(() => void push(), 500)
  })
  tryInit()
}
