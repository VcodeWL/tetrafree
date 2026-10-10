/* /loop — агент сам повторяет задачу проход за проходом. Состояние в памяти (после перезапуска приложения цикл не продолжается).
   Остановка: агент написал LOOP_DONE · набран лимит проходов · три одинаковых ответа подряд · ошибка модели ·
   «Стоп» · проект закрыт · кончился лимит расходов. */
import { create } from 'zustand'
import type { ID } from '../types'
import { loopDone, loopPrompt, fmtGap, type LoopSpec } from './slash'

export interface LoopState {
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
}

export const useLoops = create<{ loops: Record<ID, LoopState> }>(() => ({ loops: {} }))
const timers = new Map<ID, ReturnType<typeof setTimeout>>()
const get = (chatId: ID) => useLoops.getState().loops[chatId]
const set = (chatId: ID, patch: Partial<LoopState> | null) =>
  useLoops.setState((s) => {
    const loops = { ...s.loops }
    if (!patch) delete loops[chatId]
    else if (loops[chatId]) loops[chatId] = { ...loops[chatId], ...patch }
    return { loops }
  })

export interface Runner {
  /** отправить проход агенту; false — не удалось начать (нет модели, лимит, нет агента) */
  send(chatId: ID, o: { text: string; extra: string; silent?: string }): boolean
  busy(chatId: ID): boolean
  projectOpen(pid: ID): boolean
  say(chatId: ID, pid: ID, text: string): void
}
let R: Runner | null = null
export const setLoopRunner = (r: Runner) => {
  R = r
}

export const loopActive = (chatId: ID) => !!get(chatId)

/** Причина остановки после завершённого прохода или null — продолжаем. Чистая функция. */
export function decide(
  st: Pick<LoopState, 'n' | 'max' | 'same'>,
  text: string,
  failed: boolean,
): string | null {
  if (failed) return 'ошибка модели — проверь ответ агента выше'
  if (loopDone(text)) return 'агент сообщил, что цель достигнута'
  if (st.max && st.n >= st.max) return `выполнены все ${st.max} проходов`
  if (st.same >= 3) return 'три одинаковых ответа подряд — агент ходит по кругу'
  return null
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().slice(0, 600)

export function loopStart(chatId: ID, pid: ID, spec: LoopSpec, typed: string): boolean {
  if (!R || get(chatId)) return false
  useLoops.setState((s) => ({
    loops: {
      ...s.loops,
      [chatId]: {
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
  const ok = R.send(chatId, { text: typed, extra: loopPrompt(spec.task, 1, spec.max) })
  if (!ok) set(chatId, null)
  return ok
}

export function loopStop(chatId: ID, why?: string) {
  const st = get(chatId)
  if (!st) return false
  const t = timers.get(chatId)
  if (t) clearTimeout(t)
  timers.delete(chatId)
  set(chatId, null)
  if (why && R)
    R.say(chatId, st.pid, `↻ Цикл остановлен: ${why}. Проходов: ${st.n}${st.max ? ' из ' + st.max : ''}.`)
  return true
}

/** Движок сообщает: проход закончился. Планируем следующий или завершаем цикл. */
export function loopPassEnded(chatId: ID, text: string, failed: boolean) {
  const st = get(chatId)
  if (!st) return
  const h = norm(text)
  const same = h && h === st.last ? st.same + 1 : 0
  set(chatId, { last: h, same })
  const why = decide({ n: st.n, max: st.max, same }, text, failed)
  if (why) {
    loopStop(chatId, why)
    return
  }
  set(chatId, { phase: 'wait', nextAt: Date.now() + st.gap })
  schedule(chatId, st.gap)
}

function schedule(chatId: ID, ms: number) {
  const old = timers.get(chatId)
  if (old) clearTimeout(old)
  timers.set(
    chatId,
    setTimeout(() => fire(chatId), ms),
  )
}

function fire(chatId: ID) {
  timers.delete(chatId)
  const st = get(chatId)
  if (!st || !R) return
  if (!R.projectOpen(st.pid)) return void loopStop(chatId, 'проект закрыт')
  /* пользователь сам написал агенту — не перебиваем его, ждём конца хода */
  if (R.busy(chatId)) return schedule(chatId, 3000)
  const n = st.n + 1
  set(chatId, { n, phase: 'run', nextAt: undefined })
  const ok = R.send(chatId, {
    text: '',
    extra: loopPrompt(st.task, n, st.max),
    silent: `↻ Цикл · проход ${n}${st.max ? ' из ' + st.max : ''}: ${st.task.slice(0, 80)}`,
  })
  if (!ok) loopStop(chatId, 'не удалось запустить следующий проход (модель, лимит расходов или нет агента)')
}

export const loopLabel = (st: LoopState) =>
  `Цикл · проход ${st.n}${st.max ? ' из ' + st.max : ' · без лимита'} · пауза ${fmtGap(st.gap)}`
