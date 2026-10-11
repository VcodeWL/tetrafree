import { stripSecrets } from '../lib/vaultState'
import { createJSONStorage } from 'zustand/middleware'
import type { Attachment, Message, Person, Project, Provider } from '../types'
import { pickFile } from './helpers'
import { idbAvailable, idbGet, idbSet, idbDel } from './idb'
import { initialPersisted } from './defaults'
import { packVersions, unpackVersions, type PackedVersion } from './snapshots'
import type { Full, Persisted, S, UI } from './types'

/** Версия схемы localStorage. Менять вместе с веткой в migrate() — иначе у пользователя сбросятся данные. */
export const PERSIST_VERSION = 7

/* localStorage с защитой от переполнения: вместо падения — одно предупреждение */
let quotaWarned = false
const safeStorage = (onQuota: () => void): Storage => ({
  get length() {
    return localStorage.length
  },
  key: (i) => localStorage.key(i),
  getItem: (k) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  removeItem: (k) => {
    try {
      localStorage.removeItem(k)
    } catch {
      /* noop */
    }
  },
  clear: () => localStorage.clear(),
  setItem: (k, v) => {
    try {
      localStorage.setItem(k, v)
      quotaWarned = false
    } catch {
      if (quotaWarned) return
      quotaWarned = true
      setTimeout(onQuota, 0)
    }
  },
})

/* Состояние лежит в IndexedDB (потолок — диск, а не 5 МБ localStorage). Что здесь важно:
   — первое чтение: если в IndexedDB пусто, а в localStorage есть старые данные — они переносятся, и localStorage
     очищается только ПОСЛЕ успешной записи и повторного чтения;
   — запись откладывается: во время стрима стор меняется ~15 раз в секунду, а копировать весь проект столько раз незачем;
   — IndexedDB недоступен → прежний путь через localStorage. */
export type StoredValue = { state: unknown; version?: number }

/* В базе лежит JSON-строка: значения стора могут содержать то, что structured clone не принимает, а JSON — отбрасывает, как и раньше */
const parse = (raw: string | undefined): StoredValue | null => {
  if (typeof raw !== 'string') return null
  try {
    return JSON.parse(raw) as StoredValue
  } catch {
    return null
  }
}

export function idbStorage(onQuota: () => void): import('zustand/middleware').PersistStorage<unknown> {
  let _j: ReturnType<typeof createJSONStorage> | undefined
  const LS = () => (_j ??= createJSONStorage(() => safeStorage(onQuota)))!
  let useIdb: boolean | null = null
  let pending: { k: string; v: StoredValue } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  let migrated = false
  let flushing: Promise<void> = Promise.resolve()

  const ready = async () => (useIdb ??= await idbAvailable())

  const write = async (k: string, v: StoredValue) => {
    if (await ready()) {
      try {
        await idbSet(k, JSON.stringify(v))
        if (!migrated) {
          /* старые данные из localStorage удаляем только когда новая копия точно прочиталась */
          const back = parse(await idbGet<string>(k))
          if (back && back.state) {
            try {
              localStorage.removeItem(k)
            } catch {
              /* noop */
            }
            migrated = true
          }
        }
        quotaWarned = false
        return
      } catch {
        /* диск переполнен или база закрыта — пробуем localStorage ниже */
      }
    }
    void LS().setItem(k, v as never)
  }

  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = null
    if (!pending) return flushing
    const p = pending
    pending = null
    flushing = flushing.then(() => write(p.k, p.v)).catch(() => undefined)
    return flushing
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', () => void flush())
    window.addEventListener('pagehide', () => void flush())
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flush()
    })
  }
  return {
    getItem: async (k) => {
      if (pending && pending.k === k) return pending.v as never
      if (await ready()) {
        try {
          const v = parse(await idbGet<string>(k))
          if (v && typeof v === 'object' && 'state' in v) {
            migrated = true
            return v as never
          }
        } catch {
          /* читаем из localStorage */
        }
      }
      return LS().getItem(k) as never
    },
    setItem: (k, v) => {
      pending = { k, v: v as StoredValue }
      if (!timer) timer = setTimeout(() => void flush(), 500)
    },
    removeItem: async (k) => {
      pending = null
      if (await ready()) await idbDel(k).catch(() => undefined)
      return LS().removeItem(k)
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
    chats: p.chats.map((c) => ({ ...c, messages: c.messages.map(stripVolatile) })),
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
  }))
  if (!merged.authed) merged.screen = 'auth'
  if (merged.screen === 'workspace' && !merged.projects.find((x) => x.id === merged.projectId))
    merged.screen = 'launcher'
  const pr = merged.projects.find((x) => x.id === merged.projectId)
  if (pr) merged.activeFile = pickFile(pr)
  return merged
}

/* старые версии → текущая; неизвестная версия сбрасывается к начальному состоянию */
export const migrate = (old: unknown, from: number): S => {
  if (!old || typeof old !== 'object' || from < 4 || from > 6) return initialPersisted() as unknown as S
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
