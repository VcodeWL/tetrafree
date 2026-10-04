/* Построчное трёхстороннее слияние (diff3) — как в git merge. base — последняя общая версия, ours — моя, theirs — чужая.
   Непересекающиеся правки сливаются сами; на пересечении ставятся маркеры <<<<<<< / ======= / >>>>>>>. */

/** пары совпавших индексов (LCS) двух массивов строк; null, если задача слишком велика */
function lcs(a: string[], b: string[]): [number, number][] | null {
  let s = 0
  while (s < a.length && s < b.length && a[s] === b[s]) s++
  let ea = a.length,
    eb = b.length
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) {
    ea--
    eb--
  }
  const n = ea - s,
    m = eb - s
  const pairs: [number, number][] = []
  for (let i = 0; i < s; i++) pairs.push([i, i])
  if (n > 0 && m > 0) {
    if (n * m > 6e6) return null
    const w = m + 1
    const t = new Uint16Array((n + 1) * w) // длина LCS суффиксов; строки > 65k совпадений в одной хунке не ожидаются
    if (Math.min(n, m) > 65000) return null
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        t[i * w + j] =
          a[s + i] === b[s + j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1])
    let i = 0,
      j = 0
    while (i < n && j < m) {
      if (a[s + i] === b[s + j]) {
        pairs.push([s + i, s + j])
        i++
        j++
      } else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) i++
      else j++
    }
  }
  for (let k = 0; k < a.length - ea; k++) pairs.push([ea + k, eb + k])
  return pairs
}

const eq = (x: string[], y: string[]) => x.length === y.length && x.every((v, i) => v === y[i])

export interface Merge3 {
  text: string
  conflict: boolean
  conflicts: number
}

/** null — слишком большие файлы, слияние не пытаемся (вызывающий сохранит обе версии) */
export function merge3(
  base: string,
  ours: string,
  theirs: string,
  labels: { ours?: string; theirs?: string } = {},
): Merge3 | null {
  if (ours === theirs) return { text: ours, conflict: false, conflicts: 0 }
  if (ours === base) return { text: theirs, conflict: false, conflicts: 0 }
  if (theirs === base) return { text: ours, conflict: false, conflicts: 0 }
  const B = base.split('\n'),
    O = ours.split('\n'),
    T = theirs.split('\n')
  const po = lcs(B, O),
    pt = lcs(B, T)
  if (!po || !pt) return null
  const mo = new Map(po),
    mt = new Map(pt)
  const out: string[] = []
  let bi = 0,
    oi = 0,
    ti = 0,
    conflicts = 0
  const chunk = (b: number, o: number, t: number) => {
    const cb = B.slice(bi, b),
      co = O.slice(oi, o),
      ct = T.slice(ti, t)
    if (eq(co, ct)) out.push(...co)
    else if (eq(cb, co)) out.push(...ct)
    else if (eq(cb, ct)) out.push(...co)
    else {
      conflicts++
      out.push(
        `<<<<<<< ${labels.ours || 'мои правки'}`,
        ...co,
        '=======',
        ...ct,
        `>>>>>>> ${labels.theirs || 'чужие правки'}`,
      )
    }
  }
  for (let i = 0; i < B.length; i++) {
    const o = mo.get(i),
      t = mt.get(i)
    if (o === undefined || t === undefined) continue
    chunk(i, o, t)
    out.push(B[i])
    bi = i + 1
    oi = o + 1
    ti = t + 1
  }
  chunk(B.length, O.length, T.length)
  return { text: out.join('\n'), conflict: conflicts > 0, conflicts }
}

export const hasMarkers = (t: string) =>
  /^<<<<<<< .*$/m.test(t) && /^=======$/m.test(t) && /^>>>>>>> .*$/m.test(t)

/** куда сдвинуть курсор, когда текст заменили снаружи (общий префикс/суффикс определяют зону правки) */
export function mapCaret(oldT: string, newT: string, pos: number): number {
  if (oldT === newT) return pos
  let s = 0
  const max = Math.min(oldT.length, newT.length)
  while (s < max && oldT[s] === newT[s]) s++
  let eo = oldT.length,
    en = newT.length
  while (eo > s && en > s && oldT[eo - 1] === newT[en - 1]) {
    eo--
    en--
  }
  if (pos <= s) return pos
  if (pos >= eo) return pos + (en - eo)
  return Math.min(en, s) // курсор внутри заменённого куска — ставим в его начало
}

/** снять маркеры конфликта: мои / чужие / обе версии подряд */
export function resolveMarkers(text: string, mode: 'ours' | 'theirs' | 'both'): string {
  return text.replace(
    /^<<<<<<< .*\n([\s\S]*?)^=======\n([\s\S]*?)^>>>>>>> .*(?:\n|$)/gm,
    (_m, a: string, b: string) => (mode === 'ours' ? a : mode === 'theirs' ? b : a + b),
  )
}
