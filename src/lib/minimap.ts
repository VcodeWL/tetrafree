/* Мини-карта кода: чистая геометрия и разметка строк (рисует компонент Minimap) */
export const ROW = 2 // высота строки на карте, px
export const MAX_COLS = 70 // ширина карты в «символах»

export interface MmRow {
  indent: number
  len: number
  /** c — комментарий, t — код, e — пустая строка */
  k: 'c' | 't' | 'e'
}
const COMMENT = /^(\/\/|#|\/\*|\*|--|<!--)/

/** Строки карты: только видимые (не свёрнутые) строки файла */
export function mmRows(lines: string[], hidden: ReadonlySet<number>): MmRow[] {
  const out: MmRow[] = []
  lines.forEach((l, i) => {
    if (hidden.has(i)) return
    const t = l.trimStart()
    if (!t) return void out.push({ indent: 0, len: 0, k: 'e' })
    const indent = Math.min(20, l.length - t.length)
    out.push({ indent, len: Math.min(MAX_COLS - indent, t.trimEnd().length), k: COMMENT.test(t) ? 'c' : 't' })
  })
  return out
}
/** Высота содержимого карты: ROW на строку, но не больше высоты области */
export const contentH = (rows: number, areaH: number) => Math.max(0, Math.min(areaH, rows * ROW))

/** Прямоугольник видимой области на карте */
export function viewRect(scrollTop: number, clientH: number, scrollH: number, ch: number) {
  if (scrollH <= 0 || ch <= 0) return { top: 0, h: 0 }
  const h = Math.min(ch, Math.max(8, (clientH / scrollH) * ch))
  const top = Math.min(ch - h, Math.max(0, (scrollTop / scrollH) * ch))
  return { top, h }
}
/** Клик по карте → scrollTop, чтобы точка клика оказалась по центру окна */
export function scrollForY(y: number, ch: number, scrollH: number, clientH: number) {
  if (ch <= 0) return 0
  const target = (Math.min(ch, Math.max(0, y)) / ch) * scrollH - clientH / 2
  return Math.max(0, Math.min(scrollH - clientH, target))
}
