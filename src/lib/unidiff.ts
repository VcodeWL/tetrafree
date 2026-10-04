/** Разбор unified diff в строки для отрисовки */
export type DLine = { t: 'add' | 'del' | 'ctx' | 'hunk' | 'meta'; text: string; a?: number; b?: number }
export function parseDiff(diff: string): DLine[] {
  const out: DLine[] = []
  let a = 0,
    b = 0,
    inHunk = false
  for (const raw of diff.split('\n')) {
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw)
    if (m) {
      a = +m[1]
      b = +m[2]
      inHunk = true
      out.push({ t: 'hunk', text: raw })
      continue
    }
    if (!inHunk) {
      if (raw) out.push({ t: 'meta', text: raw })
      continue
    }
    if (raw.startsWith('+')) out.push({ t: 'add', text: raw.slice(1), b: b++ })
    else if (raw.startsWith('-')) out.push({ t: 'del', text: raw.slice(1), a: a++ })
    else if (raw.startsWith('\\')) out.push({ t: 'meta', text: raw })
    else if (raw.startsWith(' ')) out.push({ t: 'ctx', text: raw.slice(1), a: a++, b: b++ })
    else if (raw === '') {
      /* хвост */
    } else {
      inHunk = false
      out.push({ t: 'meta', text: raw })
    }
  }
  return out
}
