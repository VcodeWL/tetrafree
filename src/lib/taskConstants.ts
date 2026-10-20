import type { Task, TaskStatus } from '../types'
/** Shared vocabulary must not pull a whole task board into a form/palette chunk. */
export const COLS: { k: TaskStatus; t: string; c: string }[] = [
  { k: 'backlog', t: 'Бэклог', c: '#6a6a74' },
  { k: 'doing', t: 'В работе', c: '#8fa6ff' },
  { k: 'review', t: 'Ревью', c: '#b78fff' },
  { k: 'done', t: 'Готово', c: '#8fe6c0' },
]
export const PRIO: Record<Task['priority'], string> = { low: 'низкий', med: 'средний', high: 'высокий' }
