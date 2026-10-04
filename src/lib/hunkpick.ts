/* Выборочное применение правок агента: дифф делится на блоки изменений, каждый можно принять или оставить как было */
import type { DiffLine } from './diff'

export interface Change {
  id: number
  /** границы блока в массиве строк диффа: [from, to) */
  from: number
  to: number
  add: number
  del: number
}

/** Блок — подряд идущие строки '+' и '-' */
export function changeBlocks(lines: DiffLine[]): Change[] {
  const out: Change[] = []
  let cur: Change | null = null
  lines.forEach((l, i) => {
    if (l.t === ' ') {
      cur = null
      return
    }
    if (!cur) {
      cur = { id: out.length, from: i, to: i, add: 0, del: 0 }
      out.push(cur)
    }
    cur.to = i + 1
    if (l.t === '+') cur.add++
    else cur.del++
  })
  return out
}

/** Текст, в котором принятые блоки заменены на новые строки, а остальные остались прежними */
export function applyPicked(lines: DiffLine[], picked: ReadonlySet<number>): string {
  const blocks = changeBlocks(lines)
  const byLine = new Map<number, Change>()
  for (const b of blocks) for (let i = b.from; i < b.to; i++) byLine.set(i, b)
  const out: string[] = []
  lines.forEach((l, i) => {
    const b = byLine.get(i)
    if (!b || l.t === ' ') return void out.push(l.s)
    const take = picked.has(b.id)
    if (l.t === '+' && take) out.push(l.s)
    if (l.t === '-' && !take) out.push(l.s)
  })
  return out.join('\n')
}
