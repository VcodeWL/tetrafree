import { stripSecrets } from '../lib/vaultState'
import type { Attachment, Message, Person, Project, Provider } from '../types'
import { pickFile } from './helpers'
import { idbGet, idbSet } from './idb'
import { packVersions, unpackVersions, type PackedVersion } from './snapshots'
import type { Full, Persisted, S, UI } from './types'

/** Версия схемы localStorage. Менять вместе с веткой в migrate() — иначе у пользователя сбросятся данные. */
export const PERSIST_VERSION = 7

/** revision относится к завершённой записи; отсутствующая revision — старый формат (0). */
export type StoredValue = { state: unknown; version?: number; revision?: number; deleted?: boolean }
export type PersistenceGeneration = { current: number; hydrated: number }
export type DurableStorage = import('zustand/middleware').PersistStorage<unknown> & {
  flush(): Promise<void>
  completeHydration(error?: unknown): void
  captureGeneration(): PersistenceGeneration
  reserveRevision(): void
  captureRuntimeRevision(): number
}
let checkpoint: (() => Promise<void>) | undefined
let generationReader: (() => PersistenceGeneration) | undefined
let runtimeReader: (() => number) | undefined
/** current is an issued ordering watermark, NOT a durability proof; hydrated is the loaded envelope revision. */
export function capturePersistenceGeneration(): PersistenceGeneration {
  if (!generationReader) throw new Error('Стор хранилища ещё не зарегистрирован')
  return generationReader()
}
/** Зарегистрирован стором: снимок берётся заново, а не из старого debounce-таймера. */
/** Conservative runtime mutation counter since successful hydration; never a durable read proof. */
export function capturePersistenceRuntimeRevision(): number {
  if (!runtimeReader) throw new Error('Стор хранилища ещё не зарегистрирован')
  return runtimeReader()
}
export function registerPersistenceCheckpoint(
  flush: () => Promise<void>,
  capture?: () => PersistenceGeneration,
  captureRuntime?: () => number,
) {
  checkpoint = flush
  if (capture) generationReader = capture
  if (captureRuntime) runtimeReader = captureRuntime
}
/** Нельзя подтверждать sync baseline, если хотя бы одна durable-запись не удалась. */
export async function flushPersistence(): Promise<void> {
  if (!checkpoint) throw new Error('Хранилище ещё не загружено')
  await checkpoint()
}

/* Для recovery-экспорта сохраняем исходные байты, в том числе неразбираемый JSON. */
export const recoverySnapshots: Record<string, string> = {}
const parse = (raw: string | undefined | null): StoredValue | null => {
  if (raw == null) return null
  const v: unknown = JSON.parse(raw)
  if (!v || typeof v !== 'object' || !('state' in v)) throw new Error('Повреждён снимок состояния')
  const value = v as StoredValue
  if (value.revision !== undefined && (!Number.isSafeInteger(value.revision) || value.revision < 0))
    throw new Error('Повреждена ревизия состояния')
  return value
}

function validateState(value: unknown, currentSchema: boolean) {
  const bad = () => {
    throw new Error('Повреждено состояние. Исходные данные сохранены для восстановления.')
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return bad()
  const p = value as Record<string, unknown>
  const object = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v)
  if (
    currentSchema &&
    (!Array.isArray(p.projects) || !Array.isArray(p.providers) || !object(p.people) || !object(p.settings))
  )
    bad()
  for (const key of ['projects', 'providers']) if (p[key] !== undefined && !Array.isArray(p[key])) bad()
  for (const pr of (p.projects || []) as Record<string, unknown>[]) {
    if (!object(pr) || typeof pr.id !== 'string' || !object(pr.files) || !Array.isArray(pr.chats)) bad()
    for (const c of pr.chats as Record<string, unknown>[]) if (!object(c) || !Array.isArray(c.messages)) bad()
  }
}

export function idbStorage(onQuota: () => void): DurableStorage {
  let revision = 0
  let hydratedRevision = 0
  let runtimeRevision = 0
  const nextRevision = () => {
    if (!Number.isSafeInteger(revision + 1)) throw new Error('Исчерпано пространство ревизий хранилища')
    return ++revision
  }
  let writable = false
  let hydrationError: unknown
  let pending: { k: string; raw: string; revision: number } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let queue: Promise<void> = Promise.resolve()
  let lastError: unknown
  let warned = false
  const notify = () => {
    if (!warned) {
      warned = true
      setTimeout(onQuota, 0)
    }
  }
  const enqueue = (operation: () => Promise<void>) => {
    const next = queue.catch(() => {}).then(operation)
    queue = next
    // Background debounce must not produce an unhandled rejection. Explicit flush still rejects.
    void next.catch((error: unknown) => {
      lastError = error
      notify()
    })
    return next
  }
  const authorityKey = (k: string) => k + ':authority'
  const write = async (k: string, raw: string) => {
    const rev = (JSON.parse(raw) as StoredValue).revision!
    const mark = (backend: 'pending' | 'idb' | 'ls') => {
      const marker = JSON.stringify({ revision: rev, backend })
      localStorage.setItem(authorityKey(k), marker)
      if (localStorage.getItem(authorityKey(k)) !== marker)
        throw new Error('Запись указателя актуального снимка не подтверждена')
    }
    // Invalidate the previous LS authority BEFORE a newer IDB commit. If even this small
    // journal cannot be written while a fallback exists, don't create an unknowably stale fallback.
    let allowIdb = true
    try {
      mark('pending')
    } catch {
      try {
        allowIdb = localStorage.getItem(k) === null
      } catch {
        allowIdb = false
      }
    }
    try {
      if (!allowIdb) throw new Error('Нельзя обновить указатель актуального снимка')
      await idbSet(k, raw)
      try {
        mark('idb')
      } catch {
        /* pending marker forces safe recovery if IDB later becomes unreadable */
      }
      try {
        localStorage.removeItem(k)
      } catch {
        /* stale fallback cannot regain authority */
      }
    } catch {
      localStorage.setItem(k, raw)
      if (localStorage.getItem(k) !== raw) throw new Error('Запись состояния не подтверждена')
      // A durable raw without a readable authority is NOT a usable fallback checkpoint.
      // Keep the raw for recovery, but reject so callers cannot advance their baseline.
      mark('ls')
    }
    lastError = undefined
    warned = false
  }
  const flush = async () => {
    if (!writable) throw hydrationError || new Error('Состояние ещё не загружено; запись заблокирована')
    if (timer) clearTimeout(timer)
    timer = null
    if (pending) {
      const p = pending
      pending = null
      await enqueue(async () => {
        try {
          await write(p.k, p.raw)
        } catch (error) {
          // Keep failed current state retryable unless a newer state has superseded it.
          if (!pending && p.revision === revision) pending = p
          throw error
        }
      })
    } else {
      await queue
      if (lastError) throw lastError
    }
  }
  const schedule = () => {
    if (writable && pending && !timer) timer = setTimeout(() => void flush().catch(() => {}), 500)
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => void flush().catch(() => {}))
    window.addEventListener('pagehide', () => void flush().catch(() => {}))
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flush().catch(() => {})
    })
  }
  return {
    flush,
    captureGeneration: () => ({ current: revision, hydrated: hydratedRevision }),
    // Zustand notifies subscribers BEFORE persist.setItem. Reserve a lower bound before
    // publishing each runtime mutation; the actual following setItem issues a newer revision.
    captureRuntimeRevision: () => runtimeRevision,
    reserveRevision: () => {
      nextRevision()
      if (writable) {
        if (!Number.isSafeInteger(runtimeRevision + 1))
          throw new Error('Исчерпано пространство runtime-ревизий')
        runtimeRevision++
      }
    },
    completeHydration(error) {
      hydrationError = error
      writable = !error
      if (error) pending = null
      else {
        runtimeRevision = 0
        schedule()
      }
    },
    getItem: async (k) => {
      writable = false
      let idbRaw: string | undefined
      let readError: unknown
      try {
        idbRaw = await idbGet<string>(k)
      } catch (error) {
        readError = error
      }
      const lsRaw = localStorage.getItem(k) // unreadable storage is NOT an empty first run
      if (idbRaw !== undefined) recoverySnapshots.indexedDB = idbRaw
      if (lsRaw !== null) recoverySnapshots.localStorage = lsRaw
      const disk = parse(idbRaw),
        fallback = parse(lsRaw)
      let authority: { backend?: string; revision?: number } | null = null
      try {
        authority = JSON.parse(localStorage.getItem(authorityKey(k)) || 'null')
      } catch {
        /* validate snapshots independently */
      }
      if (readError && (!fallback || authority?.backend !== 'ls' || authority.revision !== fallback.revision))
        throw new Error(
          'IndexedDB недоступен; актуальность запасного снимка не подтверждена. Данные не изменены.',
        )
      const latest = !disk
        ? fallback
        : !fallback
          ? disk
          : (fallback.revision ?? 0) > (disk.revision ?? 0)
            ? fallback
            : disk
      if (
        authority &&
        (authority.backend === 'idb' || authority.backend === 'ls') &&
        Number.isSafeInteger(authority.revision) &&
        authority.revision! > (latest?.revision ?? 0)
      )
        throw new Error('Актуальный снимок недоступен; старые данные не будут восстановлены поверх него.')
      revision = Math.max(revision, disk?.revision ?? 0, fallback?.revision ?? 0)
      if (
        latest &&
        (latest.version === undefined ||
          !Number.isInteger(latest.version) ||
          latest.version < 4 ||
          latest.version > PERSIST_VERSION)
      )
        throw new Error(
          `Схема ${latest.version} не поддерживается этой версией TetraFree. Нужна совместимая версия приложения.`,
        )
      if (latest && !latest.deleted) validateState(latest.state, latest.version === PERSIST_VERSION)
      // Assign only after a successful supported read; migration's queued writes must not change it.
      hydratedRevision = latest?.revision ?? 0
      if (latest?.deleted) return null
      return latest as never
    },
    setItem: (k, v) => {
      if (hydrationError) throw hydrationError
      // Serialize immediately: a delayed write must not capture later object mutations.
      pending = { k, raw: JSON.stringify({ ...v, revision: nextRevision() }), revision }
      schedule()
    },
    removeItem: async (k) => {
      if (!writable) throw hydrationError || new Error('Удаление до загрузки запрещено')
      if (timer) clearTimeout(timer)
      timer = null
      pending = null
      // A revisioned tombstone protects against an old IDB copy after failed delete.
      const raw = JSON.stringify({
        state: null,
        version: PERSIST_VERSION,
        revision: nextRevision(),
        deleted: true,
      })
      await enqueue(async () => {
        await write(k, raw)
        // Retain the tombstone even after a successful IDB write. Physically deleting it
        // could expose an uncleared older LS copy on restart. The next set supersedes it.
      })
    },
  }
}

/* незавершённые стримы после перезагрузки превращаем в законченные сообщения */
export function stripVolatile(m: Message): Message {
  if (m.kind === 'agent' && m.streaming)
    return {
      ...m,
      streaming: false,
      thinking: undefined,
      text: m.text || '_Ответ прерван перезагрузкой страницы._',
      parts: m.parts?.map((x) =>
        x.k === 'file' && x.state === 'writing'
          ? { ...x, state: 'error' as const, error: 'Прервано перезагрузкой' }
          : x.k === 'cmd' && x.state === 'running'
            ? { ...x, state: 'error' as const }
            : x,
      ),
    }
  if (m.kind === 'human' && m.attachments)
    return {
      ...m,
      attachments: m.attachments.map((a: Attachment) => ({
        ...a,
        url: a.url && a.url.startsWith('data:') && a.url.length < 300_000 ? a.url : undefined,
      })),
    }
  return m
}

/* что именно сохраняем: без тостов, модалок и прочего временного */
export const partialize = (
  s: Full,
): Persisted &
  Pick<UI, 'screen' | 'projectId' | 'center' | 'rightOpen' | 'rightTab' | 'drafts' | 'sideHidden'> => ({
  authed: s.authed,
  people: s.people,
  projects: s.projects.map((p) => ({
    ...p,
    versions: packVersions(p.versions) as unknown as Project['versions'],
    chats: p.chats.map((c) => ({ ...c, running: false, messages: c.messages.map(stripVolatile) })),
  })),
  providers: stripSecrets(s.providers),
  settings: s.settings,
  model: s.model,
  rightWidth: s.rightWidth,
  taskView: s.taskView,
  lastProject: s.lastProject,
  sort: s.sort,
  screen: s.screen,
  projectId: s.projectId,
  center: s.center,
  rightOpen: s.rightOpen,
  rightTab: s.rightTab,
  drafts: s.drafts,
  sideHidden: s.sideHidden,
})

export const merge = (persisted: unknown, current: Full): Full => {
  const p = persisted as Partial<S>
  const merged = { ...current, ...p } as Full
  /* версии лежат в хранилище как разница с предыдущей — собираем полные снимки обратно */
  merged.projects = (merged.projects || []).map((pr) => ({
    ...pr,
    versions: unpackVersions((pr.versions || []) as unknown as PackedVersion[]),
    chats: (pr.chats || []).map((c) => ({ ...c, running: false, messages: c.messages.map(stripVolatile) })),
  }))
  if (!merged.authed) merged.screen = 'auth'
  if (merged.screen === 'workspace' && !merged.projects.find((x) => x.id === merged.projectId))
    merged.screen = 'launcher'
  const pr = merged.projects.find((x) => x.id === merged.projectId)
  if (pr) merged.activeFile = pickFile(pr)
  return merged
}

/* старые поддерживаемые версии → текущая; неизвестные нельзя перезаписывать */
export const migrate = (old: unknown, from: number): S => {
  if (!old || typeof old !== 'object' || from < 4 || from > 6)
    throw new Error(`Схема ${from} не поддерживается. Исходные данные не изменены.`)
  if (from === 4) v4to5(old as { projects?: Project[] })
  /* 6 → 7 («Разница версий»): формат читается и старый, и новый — переносить нечего */
  if (from <= 5) return v5to6(old as Record<string, unknown>) as unknown as S
  return old as S
}

/* v4 → v5: в демо остался один агент (builder) — переносим старые данные, ничего не теряя */
function v4to5(o: { projects?: Project[] }) {
  const fix = (n?: string) => (n === 'reviewer' || n === 'docs' || n === 'builder-2' ? 'builder' : n)
  for (const p of o.projects || []) {
    for (const c of p.chats || []) {
      for (const a of c.agents) {
        a.name = fix(a.name) as string
        a.sub = a.sub.filter((x) => x !== 'docs-writer')
      }
      for (const m of c.messages as Array<{ agent?: string }>) if (m.agent) m.agent = fix(m.agent)
      if (c.creator.kind === 'agent') c.creator.name = fix(c.creator.name) as string
    }
    p.lanes = (p.lanes || [])
      .filter((l) => l.who !== 'reviewer')
      .map((l) => ({
        ...l,
        who: fix(l.who) as string,
        subs: l.subs.filter((x) => !x.startsWith('docs-writer')),
      }))
    for (const t of p.tasks || [])
      if (t.assignee && t.assignee.kind === 'agent') t.assignee.name = fix(t.assignee.name) as string
    for (const m of p.memory || []) if (m.by) m.by = fix(m.by) as string
  }
}

/** Демо-данные версий до 2.0: проекты, вымышленные коллеги, провайдеры без ключа, имитации */
export const DEMO_PROJECT_IDS = ['nebula', 'atlas', 'lumen']
const DEMO_PEOPLE = ['el', 'mx', 'ig', 'ol']
const DEMO_HOSTS = ['api.anthropic.com', 'api.openai.com', 'localhost:11434', 'api.internal.dev']
const FAKE_PIPELINE = /\btetra (env|test|build|deploy|agent)\b/
const FAKE_FILES = ['env/tetra.env.yaml']

/* v5 → v6 («Релиз»): всё вымышленное убираем, настоящее — проекты пользователя, ключи, чаты — остаётся */
function v5to6(o: Record<string, unknown>) {
  const people = (o.people || {}) as Record<string, Person>
  for (const id of DEMO_PEOPLE) delete people[id]
  if (people.me && people.me.email === 'nikita@studio.dev') {
    people.me = {
      ...people.me,
      name: 'Я',
      initials: 'Я',
      email: '',
      role: undefined,
      tz: undefined,
      tags: undefined,
    }
  }
  o.people = people
  const projects = ((o.projects || []) as (Project & { env?: unknown })[]).filter(
    (p) => !DEMO_PROJECT_IDS.includes(p.id),
  )
  for (const p of projects) {
    delete p.env
    p.members = (p.members || []).filter((m) => !DEMO_PEOPLE.includes(m))
    if (p.path && !/^([a-zA-Z]:[\\/]|\/|\\\\)/.test(p.path)) p.path = '' // «~/dev/…» было заглушкой: настоящий путь придёт с сервера
    p.lanes = (p.lanes || []).filter((l) => (l.id || 'long-id').length > 3)
    p.files = p.files || {}
    for (const f of Object.keys(p.files)) {
      if (FAKE_FILES.includes(f)) delete p.files[f]
      else if (f.startsWith('.tetra/pipelines/') && FAKE_PIPELINE.test(p.files[f])) delete p.files[f]
    }
    for (const c of p.chats || []) {
      c.messages = (c.messages as Array<{ kind: string }>).filter(
        (m) => m.kind !== 'perm' && m.kind !== 'build',
      ) as Message[]
      for (const a of c.agents) a.sub = []
      c.running = false
    }
    for (const r of p.deploy?.runs || []) {
      const x = r as unknown as Record<string, unknown>
      delete x.url
      delete x.review
    }
  }
  o.projects = projects
  const providers = ((o.providers || []) as Provider[]).filter(
    (pr) => pr.apiKey || !DEMO_HOSTS.some((h) => pr.baseUrl.includes(h)),
  )
  o.providers = providers
  const model = String(o.model || '')
  if (!providers.some((pr) => model.startsWith(pr.id + ':'))) o.model = ''
  if (!projects.some((p) => p.id === o.lastProject)) o.lastProject = null
  return o
}
