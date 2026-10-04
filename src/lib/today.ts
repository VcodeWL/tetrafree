/* Сводка «Сегодня»: что ждёт решения, что горит, что в работе. Чистая функция по данным проекта. */
import type { Project, Task } from '../types'
import { openBlockers } from './taskrel'

export interface DigestChat {
  id: string
  title: string
  why: string
}
export interface Digest {
  needYou: DigestChat[]
  running: DigestChat[]
  fire: { task: Task; why: 'late' | 'today' | 'high' }[]
  doing: Task[]
  blocked: { task: Task; by: Task[] }[]
}
const rank = { high: 0, med: 1, low: 2 } as const

export function digest(p: Project, today: string, me: string): Digest {
  const open = p.tasks.filter((t) => t.status !== 'done')
  const mine = (t: Task) => !t.assignee || (t.assignee.kind === 'human' && t.assignee.id === me)
  const needYou: DigestChat[] = []
  const running: DigestChat[] = []
  for (const c of p.chats) {
    const last = [...c.messages].reverse().find((m) => m.kind === 'agent')
    const review =
      last &&
      last.kind === 'agent' &&
      last.turn &&
      (last.turn.state === 'proposed' || last.turn.state === 'partial')
    if (review) needYou.push({ id: c.id, title: c.title, why: 'правки ждут решения' })
    if (c.running)
      running.push({
        id: c.id,
        title: c.title,
        why: c.agents[0]?.name ? c.agents[0].name + ' работает' : 'агент работает',
      })
  }
  const fire: Digest['fire'] = []
  for (const t of open) {
    if (t.due && t.due < today) fire.push({ task: t, why: 'late' })
    else if (t.due === today) fire.push({ task: t, why: 'today' })
    else if (t.priority === 'high' && mine(t) && t.status !== 'backlog') fire.push({ task: t, why: 'high' })
  }
  const order = { late: 0, today: 1, high: 2 } as const
  fire.sort(
    (a, b) =>
      order[a.why] - order[b.why] ||
      rank[a.task.priority] - rank[b.task.priority] ||
      (a.task.due || '').localeCompare(b.task.due || ''),
  )
  const fireIds = new Set(fire.map((f) => f.task.id))
  const doing = open.filter((t) => (t.status === 'doing' || t.status === 'review') && !fireIds.has(t.id))
  const blocked = open.map((t) => ({ task: t, by: openBlockers(t, p.tasks) })).filter((x) => x.by.length)
  return { needYou, running, fire, doing, blocked }
}
