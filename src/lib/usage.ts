/* Учёт расходов на модели. Токены — оценка по длине текста (точные цифры знает только провайдер),
   цены — справочные за 1 млн токенов в USD; любую цену можно переопределить в Настройках → Расходы. */
import type { Project } from '../types'

export interface Price {
  inp: number
  out: number
}
export interface Usage {
  inTok: number
  outTok: number
  steps: number
  mid?: string
  free?: boolean
}

const TABLE: [RegExp, Price][] = [
  [/opus/i, { inp: 15, out: 75 }],
  [/sonnet/i, { inp: 3, out: 15 }],
  [/haiku/i, { inp: 0.8, out: 4 }],
  [/gpt-4o-mini|gpt-4\.1-mini/i, { inp: 0.15, out: 0.6 }],
  [/gpt-4\.1-nano/i, { inp: 0.1, out: 0.4 }],
  [/gpt-4o|gpt-4\.1/i, { inp: 2.5, out: 10 }],
  [/gpt-5-mini/i, { inp: 0.25, out: 2 }],
  [/gpt-5/i, { inp: 1.25, out: 10 }],
]

export function priceFor(mid: string | undefined, custom: Record<string, Price> = {}): Price | null {
  if (!mid) return null
  if (custom[mid]) return custom[mid]
  for (const [re, p] of TABLE) if (re.test(mid)) return p
  return null
}
/** Стоимость хода в USD; null — цена модели неизвестна (в сумму не входит, но считается отдельно) */
export function costOf(u: Usage, custom: Record<string, Price> = {}): number | null {
  if (u.free) return 0
  const p = priceFor(u.mid, custom)
  if (!p) return null
  return (u.inTok * p.inp + u.outTok * p.out) / 1e6
}
export const fmtUsd = (v: number) =>
  v === 0 ? '$0' : v < 0.01 ? '<$0.01' : v < 10 ? '$' + v.toFixed(2) : '$' + v.toFixed(v < 100 ? 1 : 0)
export const monthKey = (t: number) => {
  const d = new Date(t)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
}

export interface Sum {
  cost: number
  inTok: number
  outTok: number
  turns: number
  unknown: number
}
const zero = (): Sum => ({ cost: 0, inTok: 0, outTok: 0, turns: 0, unknown: 0 })
const add = (s: Sum, u: Usage, custom: Record<string, Price>) => {
  const c = costOf(u, custom)
  s.turns++
  s.inTok += u.inTok
  s.outTok += u.outTok
  if (c === null) s.unknown++
  else s.cost += c
}

export interface Report {
  month: Sum
  byProject: { id: string; name: string; month: Sum; all: Sum }[]
  byChat: { id: string; title: string; month: Sum; all: Sum }[] // для projectId
  models: Record<string, { month: Sum; known: boolean }>
}
export function report(
  projects: Project[],
  custom: Record<string, Price>,
  now = Date.now(),
  projectId?: string,
): Report {
  const mk = monthKey(now)
  const r: Report = { month: zero(), byProject: [], byChat: [], models: {} }
  for (const p of projects) {
    const pm = zero(),
      pa = zero()
    for (const c of p.chats) {
      const cm = zero(),
        ca = zero()
      for (const m of c.messages) {
        if (m.kind !== 'agent' || !m.usage) continue
        const u = m.usage as Usage
        add(ca, u, custom)
        add(pa, u, custom)
        if (monthKey(m.at) === mk) {
          add(cm, u, custom)
          add(pm, u, custom)
          add(r.month, u, custom)
          const k = u.mid || '?'
          const e = (r.models[k] ||= { month: zero(), known: u.free || !!priceFor(u.mid, custom) })
          add(e.month, u, custom)
        }
      }
      if (p.id === projectId && ca.turns) r.byChat.push({ id: c.id, title: c.title, month: cm, all: ca })
    }
    if (pa.turns) r.byProject.push({ id: p.id, name: p.name, month: pm, all: pa })
  }
  r.byChat.sort((a, b) => b.all.cost - a.all.cost)
  r.byProject.sort((a, b) => b.all.cost - a.all.cost)
  return r
}
