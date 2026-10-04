import { stripSecrets } from '../lib/vaultState'
import { createJSONStorage } from 'zustand/middleware'
import type { Attachment, Message, Person, Project, Provider } from '../types'
import { pickFile } from './helpers'
import { initialPersisted } from './defaults'
import type { Full, Persisted, S, UI } from './types'

/** Версия схемы localStorage. Менять вместе с веткой в migrate() — иначе у пользователя сбросятся данные. */
export const PERSIST_VERSION = 6

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

/* Запись откладывается: во время стрима стор меняется ~15 раз в секунду, а сериализовать весь проект столько раз незачем */
export function debouncedStorage(onQuota: () => void): import('zustand/middleware').PersistStorage<unknown> {
  let _j: ReturnType<typeof createJSONStorage> | undefined
  const J = () => (_j ??= createJSONStorage(() => safeStorage(onQuota)))!
  let pending: { k: string; v: never } | null = null
  let timer: ReturnType<typeof setTimeout> | null = null
  const flush = () => {
    if (timer) clearTimeout(timer)
    timer = null
    if (pending) {
      const p = pending
      pending = null
      void J().setItem(p.k, p.v)
    }
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', flush)
    window.addEventListener('pagehide', flush)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush()
    })
  }
  return {
    getItem: (k) => (pending && pending.k === k ? (pending.v as never) : J().getItem(k)),
    setItem: (k, v) => {
      pending = { k, v: v as never }
      if (!timer) timer = setTimeout(flush, 500)
    },
    removeItem: (k) => {
      pending = null
      return J().removeItem(k)
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
  if (!merged.authed) merged.screen = 'auth'
  if (merged.screen === 'workspace' && !merged.projects.find((x) => x.id === merged.projectId))
    merged.screen = 'launcher'
  const pr = merged.projects.find((x) => x.id === merged.projectId)
  if (pr) merged.activeFile = pickFile(pr)
  return merged
}

/* старые версии → текущая; неизвестная версия сбрасывается к начальному состоянию */
export const migrate = (old: unknown, from: number): S => {
  if (!old || typeof old !== 'object' || from < 4 || from > 5) return initialPersisted() as unknown as S
  if (from === 4) v4to5(old as { projects?: Project[] })
  return v5to6(old as Record<string, unknown>) as unknown as S
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
