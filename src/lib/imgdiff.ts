/* Сравнение двух картинок для /match: сколько пикселей совпало, где различия и карта различий для модели. */
export interface Raster {
  w: number
  h: number
  data: Uint8ClampedArray
}
export interface Region {
  name: string
  /** доля несовпавших пикселей в области, 0..1 */
  diff: number
}
export interface Diff {
  /** доля совпавших пикселей, 0..1 */
  score: number
  regions: Region[]
  /** RGBA карта различий того же размера: бледный эталон, красным — отличия */
  heat: Uint8ClampedArray
}

/** Порог «пиксель отличается»: сглаживание шрифтов и сжатие не считаются */
export const TOL = 0.09
const ROWS = ['самый верх', 'верхняя часть', 'середина', 'нижняя часть', 'самый низ']
const COLS = ['слева', 'по центру', 'справа']

/** Оба растра одного размера. Чистая функция. */
export function diffRasters(a: Raster, b: Raster): Diff {
  if (a.w !== b.w || a.h !== b.h) throw new Error('Размеры растров не совпадают')
  const { w, h } = a
  const heat = new Uint8ClampedArray(w * h * 4)
  const bad = new Array<number>(ROWS.length * COLS.length).fill(0)
  const tot = new Array<number>(ROWS.length * COLS.length).fill(0)
  let ok = 0
  for (let y = 0; y < h; y++) {
    const ry = Math.min(ROWS.length - 1, Math.floor((y / h) * ROWS.length))
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4
      const d =
        (Math.abs(a.data[i] - b.data[i]) +
          Math.abs(a.data[i + 1] - b.data[i + 1]) +
          Math.abs(a.data[i + 2] - b.data[i + 2])) /
        765
      const cell = ry * COLS.length + Math.min(COLS.length - 1, Math.floor((x / w) * COLS.length))
      tot[cell]++
      const g = Math.round((a.data[i] + a.data[i + 1] + a.data[i + 2]) / 3)
      if (d <= TOL) {
        ok++
        heat[i] = heat[i + 1] = heat[i + 2] = Math.round(g * 0.35 + 150 * 0.65)
      } else {
        bad[cell]++
        heat[i] = 255
        heat[i + 1] = Math.round(g * 0.2)
        heat[i + 2] = Math.round(g * 0.2)
      }
      heat[i + 3] = 255
    }
  }
  const regions = bad
    .map((n, c) => ({
      name: `${ROWS[Math.floor(c / COLS.length)]}, ${COLS[c % COLS.length]}`,
      diff: tot[c] ? n / tot[c] : 0,
    }))
    .filter((r) => r.diff >= 0.05)
    .sort((x, y) => y.diff - x.diff)
    .slice(0, 4)
  return { score: w * h ? ok / (w * h) : 1, regions, heat }
}

export const pct = (v: number) => (Math.round(v * 1000) / 10).toString().replace('.', ',') + '%'

/* ------------------------------------------------------------------ браузерная часть */

async function bitmap(url: string) {
  const blob = await (await fetch(url)).blob()
  return createImageBitmap(blob)
}
function raster(bmp: ImageBitmap, w: number, h: number): Raster {
  const cv = document.createElement('canvas')
  cv.width = w
  cv.height = h
  const cx = cv.getContext('2d', { willReadFrequently: true })!
  cx.fillStyle = '#fff'
  cx.fillRect(0, 0, w, h)
  cx.drawImage(bmp, 0, 0, w, h)
  return { w, h, data: cx.getImageData(0, 0, w, h).data }
}

export interface Compared {
  score: number
  regions: Region[]
  /** карта различий (png data URL) */
  heat: string
  /** размеры оригиналов: если высота страницы сильно другая — это тоже различие */
  ref: { w: number; h: number }
  cur: { w: number; h: number }
}

/** Сравнение на сетке размера эталона (не шире 640 px — быстро и устойчиво к мелкому шуму) */
export async function compareImages(refUrl: string, curUrl: string): Promise<Compared> {
  const [r, c] = await Promise.all([bitmap(refUrl), bitmap(curUrl)])
  try {
    const k = Math.min(1, 640 / r.width)
    const w = Math.max(8, Math.round(r.width * k)),
      h = Math.max(8, Math.round(r.height * k))
    const d = diffRasters(raster(r, w, h), raster(c, w, h))
    const cv = document.createElement('canvas')
    cv.width = w
    cv.height = h
    cv.getContext('2d')!.putImageData(
      new ImageData(d.heat as unknown as Uint8ClampedArray<ArrayBuffer>, w, h),
      0,
      0,
    )
    return {
      score: d.score,
      regions: d.regions,
      heat: cv.toDataURL('image/png'),
      ref: { w: r.width, h: r.height },
      cur: { w: c.width, h: c.height },
    }
  } finally {
    r.close()
    c.close()
  }
}

/** Уменьшает картинку для модели: меньше токенов, та же суть */
export async function shrinkForModel(url: string, max = 1280, q = 0.85): Promise<string> {
  const b = await bitmap(url)
  try {
    const k = Math.min(1, max / Math.max(b.width, b.height))
    const cv = document.createElement('canvas')
    cv.width = Math.max(1, Math.round(b.width * k))
    cv.height = Math.max(1, Math.round(b.height * k))
    cv.getContext('2d')!.drawImage(b, 0, 0, cv.width, cv.height)
    return cv.toDataURL('image/jpeg', q)
  } finally {
    b.close()
  }
}
