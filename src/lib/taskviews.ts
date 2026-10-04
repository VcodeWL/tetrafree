/* Сохранённые виды задач: набор фильтров под именем. */
export interface TaskFilter {
  who: 'all' | 'me' | 'agents'
  q: string
  label: string | null
  late: boolean
}
export interface TaskViewDef {
  id: string
  name: string
  f: TaskFilter
}

export const EMPTY: TaskFilter = { who: 'all', q: '', label: null, late: false }
export const isEmpty = (f: TaskFilter) => f.who === 'all' && !f.q.trim() && !f.label && !f.late
export const same = (a: TaskFilter, b: TaskFilter) =>
  a.who === b.who && a.q.trim() === b.q.trim() && a.label === b.label && a.late === b.late

export function describe(f: TaskFilter): string {
  const parts = [
    f.who === 'me' ? 'мои' : f.who === 'agents' ? 'агенты' : '',
    f.late ? 'просроченные' : '',
    f.label ? 'метка «' + f.label + '»' : '',
    f.q.trim() ? '«' + f.q.trim() + '»' : '',
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : 'все задачи'
}

/** добавить вид; одноимённый заменяется (без учёта регистра); не больше 12 */
export function upsert(list: TaskViewDef[], name: string, f: TaskFilter, id: string): TaskViewDef[] {
  const n = name.trim().slice(0, 40)
  const rest = list.filter((v) => v.name.toLowerCase() !== n.toLowerCase())
  return [
    ...rest,
    {
      id: list.find((v) => v.name.toLowerCase() === n.toLowerCase())?.id ?? id,
      name: n,
      f: { ...f, q: f.q.trim() },
    },
  ].slice(-12)
}
