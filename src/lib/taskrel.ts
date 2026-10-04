/* Повторяющиеся задачи и зависимости между задачами — чистые функции без стора. */
import type { Task } from '../types'

export type Repeat = 'daily' | 'weekdays' | 'weekly' | 'monthly'
export const REPEAT_LABEL: Record<Repeat, string> = {
  daily: 'Каждый день',
  weekdays: 'По будням',
  weekly: 'Каждую неделю',
  monthly: 'Каждый месяц',
}

const parse = (s: string) => {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
const fmt = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** Следующая дата повтора. Отсчёт от базовой даты, но не раньше, чем «сегодня» (иначе после долгого простоя
 *  задача появилась бы уже просроченной). Месяц: 31 января → 28/29 февраля, а не 3 марта. */
export function nextDate(base: string, repeat: Repeat, today: string): string {
  const b = parse(base)
  const t = parse(today)
  let d = new Date(b)
  const step = () => {
    if (repeat === 'daily') d.setDate(d.getDate() + 1)
    else if (repeat === 'weekly') d.setDate(d.getDate() + 7)
    else if (repeat === 'weekdays') {
      do d.setDate(d.getDate() + 1)
      while (d.getDay() === 0 || d.getDay() === 6)
    } else {
      const day = b.getDate()
      const n = new Date(d.getFullYear(), d.getMonth() + 1, 1)
      n.setDate(Math.min(day, new Date(n.getFullYear(), n.getMonth() + 1, 0).getDate()))
      d = n
    }
  }
  step()
  let guard = 0
  while (d < t && guard++ < 1000) step()
  return fmt(d)
}

/** Заготовка следующей копии повторяющейся задачи (без id/key/createdAt) */
export function spawnNext(t: Task, today: string): Partial<Task> | null {
  if (!t.repeat) return null
  const base = t.due || t.start || today
  const due = t.due ? nextDate(t.due, t.repeat, today) : undefined
  let start = t.start
  if (t.start) {
    if (t.due) {
      const shift = Math.round((parse(due!).getTime() - parse(t.due).getTime()) / 86400000)
      const s = parse(t.start)
      s.setDate(s.getDate() + shift)
      start = fmt(s)
    } else start = nextDate(t.start, t.repeat, today)
  }
  void base
  return {
    title: t.title,
    desc: t.desc,
    status: 'backlog',
    assignee: t.assignee,
    priority: t.priority,
    labels: t.labels,
    repeat: t.repeat,
    subtasks: t.subtasks?.map((s) => ({ ...s, done: false })),
    start,
    due,
  }
}

/** Незавершённые задачи, которые блокируют эту */
export const openBlockers = (t: Task, all: Task[]) =>
  (t.blockedBy || [])
    .map((id) => all.find((x) => x.id === id))
    .filter((x): x is Task => !!x && x.status !== 'done')

/** Можно ли сделать `blocker` блокирующей для `id` без цикла (A ждёт B, B ждёт A) */
export function canBlock(all: Task[], id: string, blocker: string): boolean {
  if (id === blocker) return false
  const seen = new Set<string>()
  const stack = [blocker]
  while (stack.length) {
    const cur = stack.pop()!
    if (cur === id) return false
    if (seen.has(cur)) continue
    seen.add(cur)
    for (const b of all.find((x) => x.id === cur)?.blockedBy || []) stack.push(b)
  }
  return true
}
