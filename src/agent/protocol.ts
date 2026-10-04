/* Потоковый протокол действий агента.
   Модель пишет обычный текст, а действия — тегами, которые мы разбираем прямо во время стрима:
     <write path="site/index.html">…полное содержимое…</write>
     <edit path="src/a.ts"><find>старое</find><replace>новое</replace></edit>
     <delete path="site/old.css" />        (путь-папка удаляет всё внутри)
     <rename from="a.ts" to="b.ts" />
     <read path="src/a.ts" />               (прочитать файл целиком → следующий шаг)
     <run>npm test</run>                    (выполнить команду → вывод придёт следующим шагом)
   Запасной вариант: блок ```lang путь/к/файлу … ``` считается <write>. */

export type OpKind = 'write' | 'edit' | 'delete' | 'rename' | 'run' | 'read'
export type Seg =
  | { t: 'text'; s: string }
  | { t: 'op'; kind: OpKind; attrs: Record<string, string>; body: string; closed: boolean }

const KINDS: OpKind[] = ['write', 'edit', 'delete', 'rename', 'run', 'read']
const OPEN = /<(write|edit|delete|rename|run|read)\b((?:\s+[\w-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/)?>/g
const FENCE = /```([\w+#.-]*)[ \t]+((?:\.?[\w@-]+\/)*\.?[\w@-]+\.[\w]+)[ \t]*\n/g

function attrsOf(s: string) {
  const out: Record<string, string> = {}
  s.replace(/([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g, (_, k, a, b) => {
    out[k] = a ?? b
    return ''
  })
  return out
}

/** Разбирает накопленный текст. streaming=true прячет недописанный хвост тега, чтобы он не мигал в чате. */
export function parseStream(src: string, streaming: boolean): Seg[] {
  const segs: Seg[] = []
  let i = 0
  const pushText = (s: string) => {
    if (!s) return
    const l = segs[segs.length - 1]
    if (l && l.t === 'text') l.s += s
    else segs.push({ t: 'text', s })
  }
  while (i < src.length) {
    OPEN.lastIndex = i
    FENCE.lastIndex = i
    const a = OPEN.exec(src),
      b = FENCE.exec(src)
    const useFence = b && (!a || b.index < a.index)
    const m = useFence ? b : a
    if (!m) {
      pushText(src.slice(i))
      i = src.length
      break
    }
    pushText(src.slice(i, m.index))
    const start = m.index + m[0].length
    if (useFence) {
      const end = src.indexOf('\n```', start)
      const closed = end >= 0
      segs.push({
        t: 'op',
        kind: 'write',
        attrs: { path: m[2] },
        body: src.slice(start, closed ? end : src.length),
        closed,
      })
      i = closed ? end + 4 : src.length
      continue
    }
    const kind = m[1] as OpKind
    const attrs = attrsOf(m[2] || '')
    if (
      m[3] ||
      kind === 'delete' ||
      kind === 'rename' ||
      (kind === 'read' &&
        !/^\s*[^<\s]/.test(src.slice(start, start + 2)) &&
        !src.slice(start).includes('</read>'))
    ) {
      segs.push({ t: 'op', kind, attrs, body: '', closed: true })
      i = start
      /* на случай <delete path="x"></delete> */
      const tail = src.slice(i).match(new RegExp(`^\\s*</${kind}>`))
      if (tail) i += tail[0].length
      continue
    }
    const endTag = `</${kind}>`
    const end = src.indexOf(endTag, start)
    const closed = end >= 0
    let body = src.slice(start, closed ? end : src.length)
    if (!closed && streaming) body = body.replace(/<\/[a-z]*$/, '')
    if (kind === 'read' && !attrs.path) attrs.path = body.trim()
    segs.push({ t: 'op', kind, attrs, body, closed })
    i = closed ? end + endTag.length : src.length
  }
  if (streaming) {
    const l = segs[segs.length - 1]
    if (l && l.t === 'text') {
      const tail = l.s.match(/<([a-z]*)(\s[^<>]*)?$/)
      if (tail && KINDS.some((k) => k.startsWith(tail[1]) || tail[1].startsWith(k)))
        l.s = l.s.slice(0, tail.index)
      l.s = l.s.replace(/`{1,3}[\w+#.-]*(?:[ \t]+[\w./@-]*)?$/, (x) => (x.startsWith('```') ? '' : x))
      if (!l.s) segs.pop()
    }
  }
  return segs
}

/** Тело <write>: убираем обрамляющие переносы и случайный ```-блок внутри тега */
export function cleanBody(body: string) {
  let s = body.replace(/^\r?\n/, '')
  const fence = s.match(/^```[\w+#.-]*[^\n]*\n([\s\S]*?)(?:\n```\s*)?$/)
  if (fence) s = fence[1]
  return s.replace(/\r?\n$/, '')
}

export interface Pair {
  find: string
  replace: string
  complete: boolean
}
export function parsePairs(body: string): Pair[] {
  const out: Pair[] = []
  const re = /<find>\r?\n?([\s\S]*?)\r?\n?<\/find>\s*<replace>\r?\n?([\s\S]*?)(\r?\n?<\/replace>|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(body)))
    out.push({ find: m[1], replace: m[2].replace(/<\/?r?e?p?l?a?c?e?$/, ''), complete: !!m[3] })
  const re2 = /<{7}\s*SEARCH\r?\n([\s\S]*?)\r?\n={7}\r?\n([\s\S]*?)(\r?\n>{7}\s*REPLACE|$)/g
  while ((m = re2.exec(body))) out.push({ find: m[1], replace: m[2], complete: !!m[3] })
  return out
}

/** Применяет пары find/replace: точное совпадение, затем без учёта отступов и хвостовых пробелов */
export function applyPairs(content: string, pairs: Pair[]): { out: string; failed: number[] } {
  let out = content
  const failed: number[] = []
  pairs.forEach((p, i) => {
    if (!p.find.trim()) {
      out = out + (out && !out.endsWith('\n') ? '\n' : '') + p.replace
      return
    }
    if (out.includes(p.find)) {
      out = out.replace(p.find, () => p.replace)
      return
    }
    const L = out.split('\n'),
      F = p.find.split('\n').map((x) => x.trim())
    while (F.length && !F[F.length - 1]) F.pop()
    while (F.length && !F[0]) F.shift()
    for (let s = 0; s + F.length <= L.length; s++) {
      let ok = true
      for (let j = 0; j < F.length; j++)
        if (L[s + j].trim() !== F[j]) {
          ok = false
          break
        }
      if (ok) {
        const indent = L[s].match(/^\s*/)![0]
        const firstIndent =
          p.replace
            .split('\n')
            .find((x) => x.trim())
            ?.match(/^\s*/)?.[0] ?? ''
        const rep = p.replace
          .split('\n')
          .map((x) => (firstIndent === '' && indent && x.trim() ? indent + x : x))
        L.splice(s, F.length, ...rep)
        out = L.join('\n')
        return
      }
    }
    failed.push(i)
  })
  return { out, failed }
}

/** Краткое описание действий для истории диалога — без тел файлов, чтобы не жечь контекст */
export function summarizeForHistory(src: string) {
  return parseStream(src, false)
    .map((s) => {
      if (s.t === 'text') return s.s
      if (s.kind === 'write')
        return `<write path="${s.attrs.path}">…${cleanBody(s.body).split('\n').length} строк…</write>`
      if (s.kind === 'edit') return `<edit path="${s.attrs.path}">…${parsePairs(s.body).length} замен…</edit>`
      if (s.kind === 'run') return `<run>${s.body.trim()}</run>`
      if (s.kind === 'rename') return `<rename from="${s.attrs.from}" to="${s.attrs.to}" />`
      return `<${s.kind} path="${s.attrs.path}" />`
    })
    .join('')
}
