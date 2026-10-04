/* Календарная сетка для выбора даты: недели с понедельника, дни в формате YYYY-MM-DD (локальные). */
export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']
export const MONTHS = [
  'Январь',
  'Февраль',
  'Март',
  'Апрель',
  'Май',
  'Июнь',
  'Июль',
  'Август',
  'Сентябрь',
  'Октябрь',
  'Ноябрь',
  'Декабрь',
]

const p2 = (n: number) => String(n).padStart(2, '0')
export const iso = (y: number, m: number, d: number) => `${y}-${p2(m + 1)}-${p2(d)}`
export function parseIso(s: string): { y: number; m: number; d: number } | null {
  const r = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!r) return null
  const y = +r[1],
    m = +r[2] - 1,
    d = +r[3]
  const t = new Date(y, m, d)
  return t.getFullYear() === y && t.getMonth() === m && t.getDate() === d ? { y, m, d } : null
}

/** 6 недель × 7 дней, включая хвосты соседних месяцев */
export function grid(y: number, m: number): { iso: string; day: number; out: boolean }[] {
  const first = new Date(y, m, 1)
  const lead = (first.getDay() + 6) % 7
  return Array.from({ length: 42 }, (_, i) => {
    const t = new Date(y, m, 1 - lead + i)
    return { iso: iso(t.getFullYear(), t.getMonth(), t.getDate()), day: t.getDate(), out: t.getMonth() !== m }
  })
}
export const shiftMonth = (y: number, m: number, by: number) => {
  const t = new Date(y, m + by, 1)
  return { y: t.getFullYear(), m: t.getMonth() }
}

/** ввод руками: «31.12.2025», «31.12.25», «2025-12-31» */
export function parseTyped(s: string): string | null {
  const t = s.trim()
  const a = parseIso(t)
  if (a) return t
  const r = /^(\d{1,2})[./](\d{1,2})[./](\d{2}|\d{4})$/.exec(t)
  if (!r) return null
  const y = r[3].length === 2 ? 2000 + +r[3] : +r[3]
  const v = iso(y, +r[2] - 1, +r[1])
  return parseIso(v) ? v : null
}
export const fmtRu = (s: string) => {
  const d = parseIso(s)
  return d ? `${p2(d.d)}.${p2(d.m + 1)}.${d.y}` : ''
}
