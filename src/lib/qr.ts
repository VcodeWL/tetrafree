/* Генератор QR-кода (режим «байты», уровень коррекции M, версии 1–10 — до ~210 байт). Без зависимостей.
   Нужен для 2FA: приложение-аутентификатор сканирует otpauth://-ссылку. */

const EC_M: [number, number, number, number, number][] = [
  // версия 1..10: [ec на блок, блоков(1), data(1), блоков(2), data(2)]
  [10, 1, 16, 0, 0],
  [16, 1, 28, 0, 0],
  [26, 1, 44, 0, 0],
  [18, 2, 32, 0, 0],
  [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0],
  [18, 4, 31, 0, 0],
  [22, 2, 38, 2, 39],
  [22, 3, 36, 2, 37],
  [26, 4, 43, 1, 44],
]
const ALIGN: number[][] = [
  [],
  [6, 18],
  [6, 22],
  [6, 26],
  [6, 30],
  [6, 34],
  [6, 22, 38],
  [6, 24, 42],
  [6, 26, 46],
  [6, 28, 50],
]

/* GF(256), полином 0x11D */
const EXP = new Uint8Array(512),
  LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
}
const mul = (a: number, b: number) => (a && b ? EXP[LOG[a] + LOG[b]] : 0)

function rsRemainder(data: number[], degree: number): number[] {
  let gen = [1]
  for (let i = 0; i < degree; i++) {
    const next = new Array(gen.length + 1).fill(0)
    for (let j = 0; j < gen.length; j++) {
      next[j] ^= gen[j]
      next[j + 1] ^= mul(gen[j], EXP[i])
    }
    gen = next
  }
  const res = new Array(degree).fill(0)
  for (const b of data) {
    const f = b ^ res.shift()!
    res.push(0)
    for (let i = 0; i < degree; i++) res[i] ^= mul(gen[i + 1], f)
  }
  return res
}

const bit = (v: number, i: number) => ((v >>> i) & 1) === 1

export function qrMatrix(text: string): boolean[][] {
  const bytes = Array.from(new TextEncoder().encode(text))
  let ver = 0
  for (let v = 1; v <= 10; v++) {
    const [, b1, d1, b2, d2] = EC_M[v - 1]
    const cap = b1 * d1 + b2 * d2
    if (bytes.length + (v < 10 ? 2 : 3) <= cap) {
      ver = v
      break
    }
  }
  if (!ver) throw new Error('Текст слишком длинный для QR-кода')
  const [ecLen, n1, d1, n2, d2] = EC_M[ver - 1]
  const dataCap = n1 * d1 + n2 * d2

  /* поток битов */
  const bits: number[] = []
  const put = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1)
  }
  put(0b0100, 4)
  put(bytes.length, ver < 10 ? 8 : 16)
  bytes.forEach((b) => put(b, 8))
  put(0, Math.min(4, dataCap * 8 - bits.length))
  while (bits.length % 8) bits.push(0)
  const cw: number[] = []
  for (let i = 0; i < bits.length; i += 8) cw.push(parseInt(bits.slice(i, i + 8).join(''), 2))
  for (let pad = 0xec; cw.length < dataCap; pad ^= 0xec ^ 0x11) cw.push(pad)

  /* блоки + коррекция ошибок + чередование */
  const blocks: number[][] = []
  let pos = 0
  for (let i = 0; i < n1 + n2; i++) {
    const len = i < n1 ? d1 : d2
    blocks.push(cw.slice(pos, pos + len))
    pos += len
  }
  const ecs = blocks.map((b) => rsRemainder(b, ecLen))
  const all: number[] = []
  for (let i = 0; i < Math.max(d1, d2); i++) for (const b of blocks) if (i < b.length) all.push(b[i])
  for (let i = 0; i < ecLen; i++) for (const e of ecs) all.push(e[i])

  /* матрица */
  const size = 17 + 4 * ver
  const m: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false))
  const fn: boolean[][] = Array.from({ length: size }, () => new Array(size).fill(false))
  const set = (x: number, y: number, v: boolean) => {
    if (x >= 0 && y >= 0 && x < size && y < size) {
      m[y][x] = v
      fn[y][x] = true
    }
  }
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        set(cx + dx, cy + dy, d !== 2 && d !== 4)
      }
  }
  finder(3, 3)
  finder(size - 4, 3)
  finder(3, size - 4)
  const ap = ALIGN[ver - 1]
  for (let i = 0; i < ap.length; i++)
    for (let j = 0; j < ap.length; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === ap.length - 1) || (i === ap.length - 1 && j === 0))
        continue
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          set(ap[i] + dx, ap[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  const drawFormat = (mask: number) => {
    const data = (0 << 3) | mask /* уровень M = 00 */
    let rem = data
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const bits15 = ((data << 10) | rem) ^ 0x5412
    for (let i = 0; i <= 5; i++) set(8, i, bit(bits15, i))
    set(8, 7, bit(bits15, 6))
    set(8, 8, bit(bits15, 7))
    set(7, 8, bit(bits15, 8))
    for (let i = 9; i < 15; i++) set(14 - i, 8, bit(bits15, i))
    for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(bits15, i))
    for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(bits15, i))
    set(8, size - 8, true)
  }
  drawFormat(0)
  if (ver >= 7) {
    let rem = ver
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const vb = (ver << 12) | rem
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3),
        b = Math.floor(i / 3)
      set(a, b, bit(vb, i))
      set(b, a, bit(vb, i))
    }
  }

  /* данные зигзагом */
  let k = 0
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const up = ((right + 1) & 2) === 0
        const y = up ? size - 1 - vert : vert
        if (!fn[y][x] && k < all.length * 8) {
          m[y][x] = bit(all[k >>> 3], 7 - (k & 7))
          k++
        }
      }
  }

  /* маска с минимальным штрафом */
  const MASKS = [
    (x: number, y: number) => (x + y) % 2 === 0,
    (_x: number, y: number) => y % 2 === 0,
    (x: number) => x % 3 === 0,
    (x: number, y: number) => (x + y) % 3 === 0,
    (x: number, y: number) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
    (x: number, y: number) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x: number, y: number) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x: number, y: number) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
  ]
  const applyMask = (mask: number) => {
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) if (!fn[y][x] && MASKS[mask](x, y)) m[y][x] = !m[y][x]
  }
  const penalty = () => {
    let p = 0
    const line = (get: (i: number) => boolean) => {
      let run = 1
      for (let i = 1; i < size; i++) {
        if (get(i) === get(i - 1)) {
          run++
          if (run === 5) p += 3
          else if (run > 5) p++
        } else run = 1
      }
      for (let i = 0; i + 11 <= size; i++) {
        const w = Array.from({ length: 11 }, (_, j) => get(i + j))
        const a = [true, false, true, true, true, false, true, false, false, false, false],
          b = [false, false, false, false, true, false, true, true, true, false, true]
        if (w.every((v, j) => v === a[j])) p += 40
        if (w.every((v, j) => v === b[j])) p += 40
      }
    }
    for (let y = 0; y < size; y++) line((i) => m[y][i])
    for (let x = 0; x < size; x++) line((i) => m[i][x])
    for (let y = 0; y < size - 1; y++)
      for (let x = 0; x < size - 1; x++)
        if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) p += 3
    const dark = m.flat().filter(Boolean).length
    p += Math.floor(Math.abs(dark * 20 - size * size * 10) / (size * size)) * 10
    return p
  }
  let best = 0,
    bestP = Infinity
  for (let mask = 0; mask < 8; mask++) {
    applyMask(mask)
    drawFormat(mask)
    const p = penalty()
    if (p < bestP) {
      bestP = p
      best = mask
    }
    applyMask(mask)
  }
  applyMask(best)
  drawFormat(best)
  return m
}

/** SVG-строка: чёрные модули на белом, поле по 4 модуля */
export function qrSvg(text: string, px = 180): string {
  const m = qrMatrix(text)
  const n = m.length + 8
  let d = ''
  m.forEach((row, y) => {
    let x = 0
    while (x < row.length) {
      if (row[x]) {
        let w = 1
        while (row[x + w]) w++
        d += `M${x + 4} ${y + 4}h${w}v1h-${w}z`
        x += w
      } else x++
    }
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${px}" height="${px}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`
}
