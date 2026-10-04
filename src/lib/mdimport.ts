/* Markdown → блоки документа. Поддерживается то, что умеют блоки: абзац, заголовок, задача, код, цитата, выноска,
   маркированный список с вложенностью, таблица, картинка (только data:image). */
import type { Block, BlockType } from '../types'
import { MAX_INDENT, isSepRow, splitRow } from './docmd'

let n = 0
const bid = () => 'b' + Date.now().toString(36) + (n++).toString(36)
const mk = (type: BlockType, text: string, checked?: boolean): Block =>
  type === 'todo' ? { id: bid(), type, text, checked: !!checked } : { id: bid(), type, text }

export function parseMd(src: string, fallbackTitle: string): { title: string; blocks: Block[] } {
  const lines = src
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
  /* front matter */
  if (lines[0] === '---') {
    const e = lines.indexOf('---', 1)
    if (e > 0) lines.splice(0, e + 1)
  }
  let title = ''
  const blocks: Block[] = []
  let para: string[] = []
  let stack: number[] = [] // ширины отступов открытых уровней списка
  const flush = () => {
    if (para.length) {
      blocks.push(mk('p', para.join(' ').trim()))
      para = []
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    const fence = /^\s*(```|~~~)/.exec(l)
    if (fence) {
      flush()
      const body: string[] = []
      for (i++; i < lines.length && !lines[i].trim().startsWith(fence[1]); i++) body.push(lines[i])
      blocks.push(mk('code', body.join('\n')))
      continue
    }
    if (!l.trim()) {
      flush()
      stack = []
      continue
    }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l)
    if (h) {
      flush()
      if (h[1].length === 1 && !title && !blocks.length) title = h[2]
      else blocks.push(mk('h2', h[2]))
      continue
    }
    const td = /^\s*[-*+]\s+\[([ xX])\]\s+(.*)$/.exec(l)
    if (td) {
      flush()
      blocks.push(mk('todo', td[2].trim(), td[1] !== ' '))
      continue
    }
    const co = /^>\s*\[!\w+\]\s*(.*)$/.exec(l)
    if (co) {
      flush()
      blocks.push(mk('callout', co[1]))
      continue
    }
    const q = /^>\s?(.*)$/.exec(l)
    if (q) {
      flush()
      const t = [q[1]]
      while (i + 1 < lines.length && /^>\s?/.test(lines[i + 1]) && !/^>\s*\[!/.test(lines[i + 1]))
        t.push(lines[++i].replace(/^>\s?/, ''))
      blocks.push(mk('quote', t.join(' ').trim()))
      continue
    }
    const head = splitRow(l)
    if (head && i + 1 < lines.length && isSepRow(splitRow(lines[i + 1]))) {
      flush()
      const rows = [head]
      for (i += 2; i < lines.length; i++) {
        const r = splitRow(lines[i])
        if (!r) break
        rows.push(r)
      }
      i--
      const w = Math.max(...rows.map((r) => r.length))
      blocks.push({
        id: bid(),
        type: 'table',
        text: '',
        rows: rows.map((r) => Array.from({ length: w }, (_, k) => r[k] || '')),
      })
      continue
    }
    const img = /^!\[([^\]]*)\]\((data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+)\)\s*$/.exec(l.trim())
    if (img) {
      flush()
      blocks.push({ id: bid(), type: 'image', text: img[1], src: img[2] })
      continue
    }
    const bl = /^(\s*)[-*+]\s+(.*)$/.exec(l)
    if (bl) {
      flush()
      const w = bl[1].replace(/\t/g, '  ').length
      while (stack.length && stack[stack.length - 1] > w) stack.pop()
      if (!stack.length || stack[stack.length - 1] < w) stack.push(w)
      blocks.push({
        id: bid(),
        type: 'li',
        text: bl[2].trim(),
        indent: Math.min(stack.length - 1, MAX_INDENT),
      })
      continue
    }
    if (/^\s*\d+[.)]\s+/.test(l)) {
      flush()
      blocks.push(mk('p', l.trim()))
      continue
    }
    stack = []
    para.push(l.trim())
  }
  flush()
  if (!blocks.length) blocks.push(mk('p', ''))
  return { title: (title || fallbackTitle).trim() || 'Без названия', blocks }
}
