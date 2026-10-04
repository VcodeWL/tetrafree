/* Сворачивание блоков кода по отступам. Работает для любого языка: блок — строка и всё, что глубже её отступом. */
const indentOf = (l: string) => {
  let n = 0
  for (const ch of l) {
    if (ch === ' ') n++
    else if (ch === '\t') n += 2
    else break
  }
  return n
}

/** start → end (последняя скрываемая строка, включительно). Скрывается минимум одна строка. */
export function foldRanges(lines: string[]): Map<number, number> {
  const out = new Map<number, number>()
  const blank = (i: number) => !lines[i].trim()
  for (let i = 0; i < lines.length - 1; i++) {
    if (blank(i)) continue
    let j = i + 1
    while (j < lines.length && blank(j)) j++
    if (j >= lines.length || indentOf(lines[j]) <= indentOf(lines[i])) continue
    const base = indentOf(lines[i])
    let end = j
    for (let k = j; k < lines.length; k++) {
      if (blank(k)) continue
      if (indentOf(lines[k]) <= base) break
      end = k
    }
    out.set(i, end)
  }
  return out
}

/** Множество скрытых строк при данных свёрнутых началах; несуществующие начала игнорируются */
export function hiddenLines(ranges: Map<number, number>, folded: Set<number>): Set<number> {
  const h = new Set<number>()
  for (const s of folded) {
    const e = ranges.get(s)
    if (e === undefined) continue
    for (let i = s + 1; i <= e; i++) h.add(i)
  }
  return h
}

/** Номер строки на экране для каждой строки текста (скрытые не считаются) */
export function visibleIndex(total: number, hidden: Set<number>): number[] {
  const out: number[] = []
  let v = 0
  for (let i = 0; i < total; i++) {
    out.push(v)
    if (!hidden.has(i)) v++
  }
  return out
}

/** Развернуть всё, что скрывает строку `line` */
export function unfoldAt(ranges: Map<number, number>, folded: Set<number>, line: number): Set<number> {
  const n = new Set(folded)
  for (const s of folded) {
    const e = ranges.get(s)
    if (e !== undefined && line > s && line <= e) n.delete(s)
  }
  return n
}
