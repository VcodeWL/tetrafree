/* Исполнитель автоматизаций: следит за часами, файлами, задачами и открытием проекта (см. automations.ts). */
import { useStore, toast } from '../store'
import type { ID } from '../types'
import { sendMessage, isRunning } from './engine'
import {
  AUTO_FILE,
  parseAutomations,
  dueNow,
  matchFiles,
  expand,
  autoHash,
  underLimit,
  useAutos,
  type Auto,
} from './automations'

const S = () => useStore.getState()
const bootedAt = Date.now()
/* когда автоматизация срабатывала в последний раз — переживает перезапуск, чтобы «ежедневно» не сработало дважды */
const lastRun = new Map<string, number>(
  (() => {
    try {
      return Object.entries(JSON.parse(localStorage.getItem('tf-auto-last') || '{}')) as [string, number][]
    } catch {
      return []
    }
  })(),
)
const saveLast = () => {
  try {
    localStorage.setItem('tf-auto-last', JSON.stringify(Object.fromEntries([...lastRun].slice(-300))))
  } catch {
    /* хранилище недоступно */
  }
}
const quietUntil = new Map<string, number>()
const watching = new Map<string, ID>()
const key = (pid: ID, a: Auto) => pid + ':' + a.id

const project = (pid: ID) => S().projects.find((p) => p.id === pid)
export const autosOf = (pid: ID) => parseAutomations(project(pid)?.files[AUTO_FILE]).list

function mark(pid: ID, a: Auto, patch: { ok: boolean; note: string }, fired: boolean) {
  const k = key(pid, a)
  const now = Date.now()
  useAutos.setState((s) => {
    const old = s.runs[k] || { recent: [] }
    return {
      runs: {
        ...s.runs,
        [k]: {
          ...old,
          last: { at: now, ok: patch.ok, note: patch.note },
          recent: fired ? [...old.recent.filter((t) => now - t < 3600_000), now] : old.recent,
        },
      },
    }
  })
}
const setRunning = (pid: ID, a: Auto, running: boolean) =>
  useAutos.setState((s) => {
    const k = key(pid, a)
    return { runs: { ...s.runs, [k]: { ...(s.runs[k] || { recent: [] }), running } } }
  })

export interface Ctx {
  files?: string[]
  task?: string
}

/** Запуск одной автоматизации. Возвращает короткий итог для показа пользователю. */
export async function fireAuto(
  pid: ID,
  a: Auto,
  ctx: Ctx,
  why: string,
): Promise<{ ok: boolean; note: string }> {
  const p = project(pid)
  const k = key(pid, a)
  const fail = (note: string, quiet = false) => {
    if (!quiet) mark(pid, a, { ok: false, note }, false)
    return { ok: false, note }
  }
  if (!p || S().projectId !== pid) return fail('проект не открыт', true)
  if (!a.enabled) return fail('выключена', true)
  const ok = useAutos.getState().approved[await autoHash(pid, a)]
  if (!ok) return fail('не разрешена — откройте «Настройки → Автоматизации»', true)
  const info = useAutos.getState().runs[k]
  if (info?.running) return fail('предыдущий запуск ещё идёт', true)
  if (!underLimit(info?.recent || [], Date.now()))
    return fail('слишком часто (лимит запусков в час) — остановлена до следующего часа')
  const now = Date.now()
  const c = { ...ctx, name: a.name, project: p.name, now }
  lastRun.set(k, now)
  saveLast()
  if ('notify' in a.do) {
    toast({ title: a.name, desc: expand(a.do.notify, c), icon: 'bolt' })
    mark(pid, a, { ok: true, note: why }, true)
    return { ok: true, note: why }
  }
  if ('task' in a.do) {
    S().saveTask({
      title: expand(a.do.task, c).slice(0, 200),
      desc: `Создано автоматизацией «${a.name}»`,
      status: 'backlog',
      assignee: null,
      priority: 'med',
    })
    mark(pid, a, { ok: true, note: 'задача создана' }, true)
    return { ok: true, note: 'задача создана' }
  }
  const title = '⚙ ' + a.name
  let chat = project(pid)!.chats.find((x) => x.title === title)
  if (!chat) {
    const id = S().createChat({
      title,
      creator: { kind: 'human', id: 'me' },
      agents: [{ name: 'Builder', tier: a.do.tier, sub: [] }],
    })
    chat = project(pid)!.chats.find((x) => x.id === id)
  }
  if (!chat) return fail('не удалось создать чат')
  if (isRunning(chat.id)) return fail('агент в этом чате занят', true)
  const sent = sendMessage(chat.id, expand(a.do.agent, c), [], '', 0, {
    silent: `⚙ Автоматизация «${a.name}» — ${why}`,
  })
  if (!sent) return fail('агент не запустился (нет модели или лимит расходов)')
  setRunning(pid, a, true)
  watching.set(k, chat.id)
  mark(pid, a, { ok: true, note: why + ' · агент работает' }, true)
  return { ok: true, note: why }
}

/* ------------------------------------------------------------------ слежение */

let pendingFiles = new Set<string>()
let flushTimer: ReturnType<typeof setTimeout> | undefined

function flushFiles() {
  flushTimer = undefined
  const pid = S().projectId
  const paths = [...pendingFiles]
  pendingFiles = new Set()
  if (!pid || !paths.length) return
  for (const a of autosOf(pid)) {
    if (!('files' in a.when)) continue
    if ((quietUntil.get(key(pid, a)) || 0) > Date.now()) continue
    const hit = matchFiles(a.when.files, paths)
    if (hit.length)
      void fireAuto(
        pid,
        a,
        { files: hit },
        `изменены файлы: ${hit.slice(0, 3).join(', ')}${hit.length > 3 ? '…' : ''}`,
      )
  }
}

function tick() {
  const pid = S().projectId
  if (!pid) return
  const now = Date.now()
  /* завершившиеся запуски агента: снимаем «идёт» и на 20 с глушим слежение за файлами (свои же правки) */
  for (const [k, chatId] of [...watching]) {
    if (!k.startsWith(pid + ':') || isRunning(chatId)) continue
    watching.delete(k)
    quietUntil.set(k, now + 20_000)
    useAutos.setState((s) => ({
      runs: { ...s.runs, [k]: { ...(s.runs[k] || { recent: [] }), running: false } },
    }))
  }
  for (const a of autosOf(pid)) {
    const k = key(pid, a)
    const last = lastRun.get(k) ?? ('daily' in a.when ? 0 : bootedAt)
    if (!('every' in a.when) && !('daily' in a.when)) continue
    if (dueNow(a.when, now, last))
      void fireAuto(pid, a, {}, 'daily' in a.when ? 'ежедневное время' : `прошло ${a.when.label}`)
  }
}

let started = false
export function startAutomations() {
  if (started) return
  started = true
  setInterval(tick, 15_000)
  let prev = S()
  const onOpen = (pid: ID) =>
    setTimeout(() => {
      for (const a of autosOf(pid)) if ('open' in a.when) void fireAuto(pid, a, {}, 'проект открыт')
    }, 2500)
  if (prev.projectId) onOpen(prev.projectId)
  useStore.subscribe((s) => {
    const was = prev
    prev = s
    const pid = s.projectId
    if (pid !== was.projectId) {
      pendingFiles = new Set()
      if (pid) onOpen(pid)
      return
    }
    if (!pid) return
    const a = s.projects.find((p) => p.id === pid)
    const b = was.projects.find((p) => p.id === pid)
    if (!a || !b) return
    if (a.files !== b.files) {
      for (const f of Object.keys(a.files)) if (a.files[f] !== b.files[f]) pendingFiles.add(f)
      for (const f of Object.keys(b.files)) if (!(f in a.files)) pendingFiles.add(f)
      if (!flushTimer) flushTimer = setTimeout(flushFiles, 8000)
    }
    if (a.tasks !== b.tasks) {
      const old = new Map(b.tasks.map((t) => [t.id, t.status]))
      for (const t of a.tasks) {
        if (old.get(t.id) === undefined || old.get(t.id) === t.status) continue
        for (const au of autosOf(pid))
          if ('task' in au.when && au.when.task === t.status)
            void fireAuto(pid, au, { task: t.title }, `задача «${t.title}» → ${t.status}`)
      }
    }
  })
}
