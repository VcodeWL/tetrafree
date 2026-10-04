/* Блоки документа ⇄ Markdown. Единое место для экспорта (DocView, projectIO) и проверок. */
import type { Block, Doc } from '../types'

export const MAX_INDENT = 3
const esc = (c: string) => c.replace(/\|/g, '\\|').replace(/\n/g, ' ')

/** Пустая таблица: заголовок + строки; всегда прямоугольная */
export const newTable = (cols = 3, rows = 3): string[][] =>
  Array.from({ length: rows }, () => Array.from({ length: cols }, () => ''))

export function tableMd(rows: string[][]): string {
  if (!rows.length) return ''
  const w = Math.max(...rows.map((r) => r.length), 1)
  const line = (r: string[]) => '| ' + Array.from({ length: w }, (_, i) => esc(r[i] || '')).join(' | ') + ' |'
  return [
    line(rows[0]),
    '| ' + Array.from({ length: w }, () => '---').join(' | ') + ' |',
    ...rows.slice(1).map(line),
  ].join('\n')
}

export function blockMd(b: Block): string {
  switch (b.type) {
    case 'h2':
      return '## ' + b.text
    case 'todo':
      return `- [${b.checked ? 'x' : ' '}] ${b.text}`
    case 'code':
      return '```\n' + b.text + '\n```'
    case 'quote':
      return '> ' + b.text
    case 'callout':
      return '> [!note] ' + b.text
    case 'li':
      return '  '.repeat(Math.min(b.indent || 0, MAX_INDENT)) + '- ' + b.text
    case 'table':
      return tableMd(b.rows || [])
    case 'image':
      return b.src ? `![${b.text.replace(/[[\]]/g, '')}](${b.src})` : ''
    default:
      return b.text
  }
}

/** Соседние пункты списка склеиваем одной переносной строкой, остальные блоки — пустой строкой */
export function blocksMd(blocks: Block[]): string {
  let out = ''
  blocks.forEach((b, i) => {
    const prev = blocks[i - 1]
    if (i) out += prev && prev.type === 'li' && b.type === 'li' ? '\n' : '\n\n'
    out += blockMd(b)
  })
  return out
}

export const docMd = (d: Pick<Doc, 'title' | 'blocks'>) => `# ${d.title}\n\n${blocksMd(d.blocks)}\n`

/** Весь видимый текст блока (поиск, подсчёт слов, бэклинки) */
export const blockText = (b: Block): string =>
  b.type === 'table' ? (b.rows || []).map((r) => r.join(' ')).join('\n') : b.text

/** Разбор строки таблицы `| a | b |` → ячейки; null — не строка таблицы */
export function splitRow(l: string): string[] | null {
  const t = l.trim()
  if (!t.startsWith('|') || t.length < 2) return null
  const body = t.endsWith('|') && !t.endsWith('\\|') ? t.slice(1, -1) : t.slice(1)
  const cells: string[] = []
  let cur = ''
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '\\' && body[i + 1] === '|') {
      cur += '|'
      i++
    } else if (body[i] === '|') {
      cells.push(cur.trim())
      cur = ''
    } else cur += body[i]
  }
  cells.push(cur.trim())
  return cells
}
export const isSepRow = (cells: string[] | null) =>
  !!cells && cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c.replace(/\s/g, '')))
