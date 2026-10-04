/** Разбор вывода git для панели «Git». Чистые функции — их можно тестировать без репозитория. */

/** `git status --porcelain=v1 -z -b` → { branch, upstream, ahead, behind, files:[{path, x, y, from?}] } */
export function parseStatus(out) {
  const parts = out.split('\0')
  let branch = '',
    upstream = '',
    ahead = 0,
    behind = 0
  const files = []
  for (let i = 0; i < parts.length; i++) {
    const rec = parts[i]
    if (!rec) continue
    if (rec.startsWith('## ')) {
      const h = rec.slice(3)
      const m = /^(?:No commits yet on |Initial commit on )?(.+?)(?:\.\.\.(\S+))?(?: \[(.+)\])?$/.exec(h)
      if (m) {
        branch = m[1]
        upstream = m[2] || ''
        const a = /ahead (\d+)/.exec(m[3] || ''),
          b = /behind (\d+)/.exec(m[3] || '')
        ahead = a ? +a[1] : 0
        behind = b ? +b[1] : 0
      }
      continue
    }
    const x = rec[0],
      y = rec[1],
      path = rec.slice(3)
    const f = { path, x, y }
    if (x === 'R' || x === 'C') f.from = parts[++i] || ''
    files.push(f)
  }
  return { branch, upstream, ahead, behind, files }
}

/** Человеческая категория для строки статуса: new | mod | del | ren | conflict */
export function kindOf(f) {
  const { x, y } = f
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'conflict'
  if (x === '?' && y === '?') return 'new'
  if (x === 'A' || y === 'A') return 'new'
  if (x === 'D' || y === 'D') return 'del'
  if (x === 'R' || x === 'C') return 'ren'
  return 'mod'
}

/** `git log --pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%at%x1e` */
export function parseLog(out) {
  return out
    .split('\x1e')
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => {
      const [hash, short, subject, author, at] = r.split('\x1f')
      return { hash, short, subject, author, at: (+at || 0) * 1000 }
    })
}

/** `git blame --line-porcelain` → [{ hash, author, at, summary, line, text, final }]; незакоммиченные строки — hash из нулей */
export function parseBlame(out) {
  const rows = []
  const lines = out.split('\n')
  let cur = null
  for (const l of lines) {
    const h = /^([0-9a-f]{40}) \d+ (\d+)(?: \d+)?$/.exec(l)
    if (h) {
      cur = { hash: h[1], line: +h[2], author: '', at: 0, summary: '' }
      continue
    }
    if (!cur) continue
    if (l.startsWith('\t')) {
      rows.push({ ...cur, text: l.slice(1) })
      cur = null
      continue
    }
    if (l.startsWith('author ')) cur.author = l.slice(7)
    else if (l.startsWith('author-time ')) cur.at = +l.slice(12)
    else if (l.startsWith('summary ')) cur.summary = l.slice(8)
  }
  return rows
}

/** Делит unified diff одного файла на заголовок и блоки (hunks) — для выборочного коммита. */
export function splitHunks(diff) {
  const lines = String(diff).split('\n')
  const first = lines.findIndex((l) => l.startsWith('@@ '))
  if (first < 0) return { header: String(diff), hunks: [] }
  const header = lines.slice(0, first).join('\n') + '\n'
  const hunks = []
  let cur = null
  for (let i = first; i < lines.length; i++) {
    if (lines[i].startsWith('@@ ')) {
      if (cur) hunks.push(cur.join('\n') + '\n')
      cur = [lines[i]]
    } else if (cur) cur.push(lines[i])
  }
  if (cur) {
    while (cur.length && cur[cur.length - 1] === '') cur.pop() // хвост от split
    hunks.push(cur.join('\n') + '\n')
  }
  return { header, hunks }
}

/** Патч только из выбранных блоков; пусто, если ничего не выбрано или номера не подходят. */
export function pickHunks(diff, idxs) {
  const { header, hunks } = splitHunks(diff)
  const want = [...new Set(idxs)]
    .filter((i) => Number.isInteger(i) && i >= 0 && i < hunks.length)
    .sort((a, b) => a - b)
  return want.length ? header + want.map((i) => hunks[i]).join('') : ''
}
