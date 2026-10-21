/* /loop — агент сам повторяет задачу проход за проходом. Состояние в памяти (после перезапуска приложения цикл не продолжается).
   Остановка: агент написал LOOP_DONE · набран лимит проходов · три одинаковых ответа подряд · ошибка модели ·
   «Стоп» · проект закрыт · кончился лимит расходов. */
import { automationAllowed, automationEpoch, registerAutomationStopper } from './automationControl'
import { useStore } from '../store'
import { create } from 'zustand'
import type { ID } from '../types'
import { loopDone, loopPrompt, fmtGap, type LoopSpec } from './slash'

export type LoopKind = 'loop' | 'match' | 'auto'
/** Что цикл готовит перед проходом: свой запрос, картинки, причину остановки */
export interface Pre {
  extra?: string
  imgs?: string[]
  silent?: string
  stop?: string
}
/** Вид цикла: /match и /autopilot подставляют свою подготовку прохода */
export interface Hooks {
  before?: (n: number, st: LoopState) => Promise<Pre>
  /** true — «LOOP_DONE» от агента не завершает цикл (автопилот работает, пока его не остановят) */
  ignoreDone?: boolean
  title: string
}
export interface LoopState {
  kind: LoopKind
  title: string
  chatId: ID
  pid: ID
  task: string
  max: number
  gap: number
  /** номер текущего (или только что завершённого) прохода */
  n: number
  same: number
  last: string
  startedAt: number
  phase: 'run' | 'wait'
  nextAt?: number
  /** короткая заметка для панели, например «сходство 87%» */
  note?: string
}

export const useLoops = create<{ loops: Record<ID, LoopState> }>(() => ({ loops: {} }))
const timers = new Map<ID, ReturnType<typeof setTimeout>>()
const hooks = new Map<ID, Hooks>()
const sessions = new Map<ID, symbol>()
/** Loops deliberately run only in the single selected project. Never match by chat ID alone. */
export const loopFor = (state: { loops: Record<ID, LoopState> }, pid: ID | null | undefined, chatId: ID) => {
  const loop = state.loops[chatId]
  return pid && loop?.pid === pid ? loop : undefined
}
const get = (chatId: ID, pid = useStore.getState().projectId) => loopFor(useLoops.getState(), pid, chatId)
const set = (chatId: ID, patch: Partial<LoopState> | null) =>
  useLoops.setState((s) => {
    const loops = { ...s.loops }
    if (!patch) delete loops[chatId]
    else if (loops[chatId]) loops[chatId] = { ...loops[chatId], ...patch }
    return { loops }
  })

export interface Runner {
  /** отправить проход агенту; false — не удалось начать (нет модели, лимит, нет агента) */
  send(chatId: ID, o: { text: string; extra: string; silent?: string; imgs?: string[] }, pid?: ID): boolean
  busy(chatId: ID, pid?: ID): boolean
  projectOpen(pid: ID): boolean
  say(chatId: ID, pid: ID, text: string): void
}
let R: Runner | null = null
export const setLoopRunner = (r: Runner) => {
  R = r
}

/** Подпись в панели цикла */
export const loopNote = (chatId: ID, note: string, pid = useStore.getState().projectId) => {
  if (get(chatId, pid)) set(chatId, { note })
}

export const loopActive = (chatId: ID, pid = useStore.getState().projectId) => !!get(chatId, pid)

/** Причина остановки после завершённого прохода или null — продолжаем. Чистая функция. */
export function decide(
  st: Pick<LoopState, 'n' | 'max' | 'same'>,
  text: string,
  failed: boolean,
  ignoreDone = false,
): string | null {
  if (failed) return 'ошибка модели — проверь ответ агента выше'
  if (!ignoreDone && loopDone(text)) return 'агент сообщил, что цель достигнута'
  if (st.max && st.n >= st.max) return `выполнены все ${st.max} проходов`
  if (st.same >= 3) return 'три одинаковых ответа подряд — агент ходит по кругу'
  return null
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 600)

export async function loopStart(
  chatId: ID,
  pid: ID,
  spec: LoopSpec,
  typed: string,
  h: Hooks = { title: 'Цикл' },
  kind: LoopKind = 'loop',
): Promise<boolean> {
  if (!R || useLoops.getState().loops[chatId] || !automationAllowed() || !R.projectOpen(pid)) return false
  const epoch = automationEpoch()
  const session = Symbol()
  sessions.set(chatId, session)
  hooks.set(chatId, h)
  useLoops.setState((s) => ({
    loops: {
      ...s.loops,
      [chatId]: {
        kind,
        title: h.title,
        chatId,
        pid,
        task: spec.task,
        max: spec.max,
        gap: spec.gap,
        n: 1,
        same: 0,
        last: '',
        startedAt: Date.now(),
        phase: 'run',
      },
    },
  }))
  const started = get(chatId, pid)
  if (!started) return false
  const pre: Pre = h.before ? await h.before(1, started).catch((e: Error) => ({ stop: e.message })) : {}
  if (sessions.get(chatId) !== session || !get(chatId, pid)) return false
  if (!automationAllowed(epoch) || !R.projectOpen(pid)) {
    loopStop(chatId, undefined, pid)
    return false
  } /* остановили, пока готовили первый проход */
  if (pre.stop) {
    loopStop(chatId, pre.stop, pid)
    return false
  }
  const ok = R.send(
    chatId,
    {
      text: typed,
      extra: pre.extra ?? loopPrompt(spec.task, 1, spec.max),
      imgs: pre.imgs,
    },
    pid,
  )
  if (!ok) loopStop(chatId, undefined, pid)
  return ok
}

export function loopStop(chatId: ID, why?: string, pid = useStore.getState().projectId) {
  const st = get(chatId, pid)
  if (!st) return false
  const t = timers.get(chatId)
  if (t) clearTimeout(t)
  timers.delete(chatId)
  set(chatId, null)
  hooks.delete(chatId)
  sessions.delete(chatId)
  if (why && R)
    R.say(
      chatId,
      st.pid,
      `↻ ${st.title} остановлен${st.kind === 'match' ? 'а' : ''}: ${why}. Проходов: ${st.n}${st.max ? ' из ' + st.max : ''}.`,
    )
  return true
}

/** Движок сообщает: проход закончился. Планируем следующий или завершаем цикл. */
export function loopPassEnded(
  chatId: ID,
  text: string,
  failed: boolean,
  pid = useStore.getState().projectId,
) {
  const st = get(chatId, pid)
  if (!st) return
  const h = norm(text)
  const same = h && h === st.last ? st.same + 1 : 0
  set(chatId, { last: h, same })
  const why = decide({ n: st.n, max: st.max, same }, text, failed, hooks.get(chatId)?.ignoreDone)
  if (why) {
    loopStop(chatId, why, st.pid)
    return
  }
  set(chatId, { phase: 'wait', nextAt: Date.now() + st.gap })
  schedule(chatId, st.gap)
}

function schedule(chatId: ID, ms: number) {
  const session = sessions.get(chatId)
  const old = timers.get(chatId)
  if (old) clearTimeout(old)
  timers.set(
    chatId,
    setTimeout(() => {
      if (sessions.get(chatId) === session) void fire(chatId)
    }, ms),
  )
}

async function fire(chatId: ID) {
  timers.delete(chatId)
  const st = useLoops.getState().loops[chatId]
  if (!st || !R) return
  const epoch = automationEpoch()
  if (!automationAllowed()) return void loopStop(chatId, 'автоматические запуски на паузе', st.pid)
  if (!R.projectOpen(st.pid)) return void loopStop(chatId, 'проект закрыт', st.pid)
  /* пользователь сам написал агенту — не перебиваем его, ждём конца хода */
  if (R.busy(chatId, st.pid)) return schedule(chatId, 3000)
  const n = st.n + 1
  set(chatId, { n, phase: 'run', nextAt: undefined })
  const session = sessions.get(chatId)
  const h = hooks.get(chatId)
  const pre: Pre = h?.before
    ? await h.before(n, get(chatId, st.pid) || st).catch((e: Error) => ({ stop: e.message }))
    : {}
  if (sessions.get(chatId) !== session || !get(chatId, st.pid)) return
  if (!automationAllowed(epoch) || !R.projectOpen(st.pid)) return void loopStop(chatId, undefined, st.pid)
  if (pre.stop) return void loopStop(chatId, pre.stop, st.pid)
  /* пока готовили проход, пользователь мог написать агенту */
  if (R.busy(chatId, st.pid)) {
    set(chatId, { n: n - 1, phase: 'wait', nextAt: Date.now() + 3000 })
    return schedule(chatId, 3000)
  }
  const ok = R.send(
    chatId,
    {
      text: '',
      extra: pre.extra ?? loopPrompt(st.task, n, st.max),
      imgs: pre.imgs,
      silent:
        pre.silent ?? `↻ ${st.title} · проход ${n}${st.max ? ' из ' + st.max : ''}: ${st.task.slice(0, 80)}`,
    },
    st.pid,
  )
  if (!ok)
    loopStop(chatId, 'не удалось запустить следующий проход (модель, лимит расходов или нет агента)', st.pid)
}

export const loopLabel = (st: LoopState) =>
  `${st.title} · проход ${st.n}${st.max ? ' из ' + st.max : ' · без лимита'}${st.kind === 'loop' ? ' · пауза ' + fmtGap(st.gap) : ''}`

registerAutomationStopper(() => {
  for (const loop of Object.values(useLoops.getState().loops)) loopStop(loop.chatId, undefined, loop.pid)
})

let selectedProject = useStore.getState().projectId
useStore.subscribe((s) => {
  if (s.projectId === selectedProject) return
  selectedProject = s.projectId
  for (const [id, loop] of Object.entries(useLoops.getState().loops))
    if (loop.pid !== s.projectId) loopStop(id, undefined, loop.pid)
})
