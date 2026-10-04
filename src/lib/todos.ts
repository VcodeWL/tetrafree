/* Поиск TODO/FIXME в комментариях кода. Только однострочные комментарии и начало блочных. */
export interface Todo {
  file: string
  line: number
  kind: 'TODO' | 'FIXME'
  text: string
}
const RE = /(?:\/\/|#|\/\*+|<!--|--|;)\s*(TODO|FIXME)\b\s*(?:\([^)]*\))?\s*[:\-–]?\s*(.*)$/
const SKIP =
  /\.(png|jpe?g|gif|webp|ico|woff2?|zip|lock|svg|map|min\.js)$|(^|\/)(node_modules|dist|\.tetrafree|\.git)\//i

export function scanTodos(files: Record<string, string>, limit = 200): Todo[] {
  const out: Todo[] = []
  for (const file of Object.keys(files).sort()) {
    if (SKIP.test(file) || file.endsWith('.md')) continue
    const src = files[file]
    if (src.length > 400_000 || (!src.includes('TODO') && !src.includes('FIXME'))) continue
    const lines = src.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const m = RE.exec(lines[i])
      if (!m) continue
      const text = m[2].replace(/\s*(\*\/|-->)\s*$/, '').trim()
      out.push({ file, line: i + 1, kind: m[1] as Todo['kind'], text: text || '(без описания)' })
      if (out.length >= limit) return out
    }
  }
  return out
}
export const todoMark = (t: Pick<Todo, 'file' | 'line'>) => `Из кода: ${t.file}:${t.line}`
