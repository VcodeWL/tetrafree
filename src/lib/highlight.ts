/* Однопроходная подсветка синтаксиса: без вложенных span-ов и без HTML-инъекций. */
export interface Tok {
  t: string
  c?: 'k' | 's' | 'c' | 'n' | 'f' | 'h' | 'p'
}

const KW: Record<string, string[]> = {
  rust: [
    'fn',
    'pub',
    'let',
    'mut',
    'use',
    'return',
    'impl',
    'struct',
    'enum',
    'for',
    'in',
    'if',
    'else',
    'match',
    'mod',
    'crate',
    'self',
    'move',
    'async',
    'await',
    'where',
    'loop',
    'while',
    'const',
    'static',
    'trait',
    'type',
    'as',
    'ref',
  ],
  ts: [
    'export',
    'function',
    'const',
    'let',
    'var',
    'import',
    'from',
    'for',
    'of',
    'in',
    'new',
    'return',
    'if',
    'else',
    'async',
    'await',
    'type',
    'interface',
    'class',
    'extends',
    'default',
    'true',
    'false',
    'null',
    'undefined',
    'this',
    'while',
    'switch',
    'case',
  ],
  py: [
    'def',
    'class',
    'import',
    'from',
    'return',
    'if',
    'elif',
    'else',
    'for',
    'in',
    'while',
    'with',
    'as',
    'try',
    'except',
    'raise',
    'None',
    'True',
    'False',
    'async',
    'await',
    'lambda',
    'yield',
  ],
  css: ['@media', '@keyframes', 'important'],
  html: [],
  yaml: ['true', 'false', 'null'],
  sql: [
    'select',
    'from',
    'where',
    'create',
    'table',
    'insert',
    'into',
    'values',
    'primary',
    'key',
    'references',
    'not',
    'null',
    'alter',
    'add',
    'index',
    'on',
  ],
}

/** Строки файлов с Windows-переводами строк (CRLF) приходят с хвостовым \r: он не должен ломать разбор и подсветку */
export function tokenize(line: string, lang: string): Tok[] {
  if (line.endsWith('\r')) return [...tokenizeLine(line.slice(0, -1), lang), { t: '\r' }]
  return tokenizeLine(line, lang)
}
function tokenizeLine(line: string, lang: string): Tok[] {
  if (lang === 'md') {
    if (/^\s*#/.test(line)) return [{ t: line, c: 'h' }]
    if (/^\s*[-*] /.test(line)) {
      const m = line.match(/^(\s*[-*] )([\s\S]*)$/)!
      return [{ t: m[1], c: 'k' }, ...inlineMd(m[2])]
    }
    return inlineMd(line)
  }
  const kws = KW[lang] || KW.ts
  const commentRe =
    lang === 'yaml' || lang === 'py'
      ? '#.*$'
      : lang === 'html'
        ? '<!--.*?-->'
        : lang === 'sql'
          ? '--.*$'
          : '\\/\\/.*$|\\/\\*.*?\\*\\/'
  const tagRe = lang === 'html' ? '|<\\/?[a-zA-Z][\\w-]*|\\/?>' : ''
  const keyRe = lang === 'yaml' ? '|^\\s*[\\w.-]+(?=:)' : ''
  const re = new RegExp(
    `(${commentRe})|("(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*'|\`[^\`]*\`)|(\\b\\d+(?:\\.\\d+)?\\b)${tagRe}${keyRe}|(\\b[A-Za-z_@][\\w]*\\b)`,
    'g',
  )
  const out: Tok[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    if (m.index > last) out.push({ t: line.slice(last, m.index) })
    const s = m[0]
    if (m[1]) out.push({ t: s, c: 'c' })
    else if (m[2]) out.push({ t: s, c: 's' })
    else if (m[3]) out.push({ t: s, c: 'n' })
    else if (m[4] !== undefined) {
      const low = lang === 'sql' ? s.toLowerCase() : s
      if (kws.includes(low)) out.push({ t: s, c: 'k' })
      else if (/^[A-Z]/.test(s) && lang !== 'yaml') out.push({ t: s, c: 'f' })
      else if (line[m.index + s.length] === '(') out.push({ t: s, c: 'p' })
      else out.push({ t: s })
    } else {
      // html tag or yaml key
      out.push({ t: s, c: lang === 'html' ? 'k' : 'p' })
    }
    last = m.index + s.length
    if (s.length === 0) re.lastIndex++
  }
  if (last < line.length) out.push({ t: line.slice(last) })
  return out
}

function inlineMd(s: string): Tok[] {
  const out: Tok[] = []
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)/g
  let last = 0,
    m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ t: s.slice(last, m.index) })
    out.push({ t: m[0], c: m[1] ? 's' : 'f' })
    last = m.index + m[0].length
  }
  if (last < s.length) out.push({ t: s.slice(last) })
  return out
}
