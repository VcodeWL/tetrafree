/* Построчный дифф (LCS) — достаточно для файлов проекта в сотни строк. */
export interface DiffLine {
  t: '+' | '-' | ' '
  s: string
}
export interface FileDiff {
  path: string
  add: number
  del: number
  lines: DiffLine[]
  status: 'added' | 'removed' | 'modified'
}

export function diffLines(a: string, b: string): DiffLine[] {
  const A0 = a ? a.split('\n') : [],
    B0 = b ? b.split('\n') : []
  /* общий префикс и суффикс — снимаем сразу, LCS считаем только для середины */
  let pre = 0
  while (pre < A0.length && pre < B0.length && A0[pre] === B0[pre]) pre++
  let suf = 0
  while (
    suf < A0.length - pre &&
    suf < B0.length - pre &&
    A0[A0.length - 1 - suf] === B0[B0.length - 1 - suf]
  )
    suf++
  const head: DiffLine[] = A0.slice(0, pre).map((s) => ({ t: ' ', s }))
  const tail: DiffLine[] = A0.slice(A0.length - suf).map((s) => ({ t: ' ', s }))
  const A = A0.slice(pre, A0.length - suf),
    B = B0.slice(pre, B0.length - suf)
  const n = A.length,
    m = B.length
  const out: DiffLine[] = []
  if (n * m > 4_000_000) {
    /* слишком большая середина — честный блочный дифф без LCS */
    A.forEach((s) => out.push({ t: '-', s }))
    B.forEach((s) => out.push({ t: '+', s }))
    return [...head, ...out, ...tail]
  }
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
  let i = 0,
    j = 0
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      out.push({ t: ' ', s: A[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ t: '-', s: A[i++] })
    else out.push({ t: '+', s: B[j++] })
  }
  while (i < n) out.push({ t: '-', s: A[i++] })
  while (j < m) out.push({ t: '+', s: B[j++] })
  return [...head, ...out, ...tail]
}

export function diffStat(a: string | null | undefined, b: string | null | undefined) {
  const l = diffLines(a ?? '', b ?? '')
  let add = 0,
    del = 0
  for (const x of l) {
    if (x.t === '+') add++
    else if (x.t === '-') del++
  }
  return { add, del, lines: l }
}

/** оставляет только изменения и `ctx` строк контекста вокруг них */
export function compact(lines: DiffLine[], ctx = 2): (DiffLine | { t: 'gap'; s: string })[] {
  const keep = new Array(lines.length).fill(false)
  lines.forEach((l, i) => {
    if (l.t !== ' ')
      for (let k = Math.max(0, i - ctx); k <= Math.min(lines.length - 1, i + ctx); k++) keep[k] = true
  })
  const out: (DiffLine | { t: 'gap'; s: string })[] = []
  let skipped = 0
  lines.forEach((l, i) => {
    if (keep[i]) {
      if (skipped) out.push({ t: 'gap', s: `… ${skipped} без изменений` })
      skipped = 0
      out.push(l)
    } else skipped++
  })
  if (skipped && out.length) out.push({ t: 'gap', s: `… ${skipped} без изменений` })
  return out
}

export function diffSnapshots(prev: Record<string, string>, next: Record<string, string>): FileDiff[] {
  const paths = Array.from(new Set([...Object.keys(prev), ...Object.keys(next)])).sort()
  const res: FileDiff[] = []
  for (const p of paths) {
    const a = prev[p],
      b = next[p]
    if (a === b) continue
    const lines = diffLines(a ?? '', b ?? '')
    res.push({
      path: p,
      add: lines.filter((l) => l.t === '+').length,
      del: lines.filter((l) => l.t === '-').length,
      lines,
      status: a === undefined ? 'added' : b === undefined ? 'removed' : 'modified',
    })
  }
  return res
}
