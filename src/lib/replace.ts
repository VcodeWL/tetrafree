/* Поиск и замена по файлам проекта. Чистые функции. */
export interface Opts {
  regex: boolean
  caseSensitive: boolean
}
export interface Hit {
  path: string
  count: number
  line: number
  text: string
}

export function compile(q: string, o: Opts): RegExp {
  if (!q) throw new Error('Введи, что искать')
  const src = o.regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  let re: RegExp
  try {
    re = new RegExp(src, o.caseSensitive ? 'gm' : 'gim')
  } catch (e) {
    throw new Error(
      'Некорректное выражение: ' + (e as Error).message.replace(/^Invalid regular expression: /, ''),
    )
  }
  if (re.test('')) throw new Error('Выражение совпадает с пустой строкой — заменять нечего')
  re.lastIndex = 0
  return re
}

export function findHits(
  files: Record<string, string>,
  q: string,
  o: Opts,
  skip: (p: string) => boolean = () => false,
  max = 500,
): Hit[] {
  const re = compile(q, o)
  const out: Hit[] = []
  for (const path of Object.keys(files).sort()) {
    if (skip(path)) continue
    const src = files[path]
    if (src.length > 1_000_000) continue
    re.lastIndex = 0
    let count = 0
    let first = -1
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      if (first < 0) first = m.index
      count++
      if (m[0] === '') re.lastIndex++
    }
    if (!count) continue
    const line = src.slice(0, first).split('\n').length
    out.push({ path, count, line, text: src.split('\n')[line - 1].trim().slice(0, 140) })
    if (out.length >= max) break
  }
  return out
}

export function replaceIn(src: string, q: string, repl: string, o: Opts): string {
  const re = compile(q, o)
  return o.regex ? src.replace(re, repl) : src.replace(re, () => repl)
}

export interface ReplaceRequest {
  files: Record<string, string>
  q: string
  opts: Opts
  replacement?: string
}
export type ReplaceReply =
  { ok: true; hits: Hit[]; files: Record<string, string> } | { ok: false; error: string }

/** Executed only in the UI's disposable worker, including compilation and substitution. */
export function executeReplace(request: ReplaceRequest): ReplaceReply {
  try {
    const hits = findHits(request.files, request.q, request.opts)
    const files: Record<string, string> = Object.create(null)
    if (request.replacement !== undefined) {
      for (const hit of hits)
        files[hit.path] = replaceIn(request.files[hit.path], request.q, request.replacement, request.opts)
    }
    return { ok: true, hits, files }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
