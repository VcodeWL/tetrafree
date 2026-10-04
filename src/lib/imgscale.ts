/* Картинки в документах хранятся прямо в данных (data: URL), поэтому перед вставкой их уменьшаем. */
export const MAX_SIDE = 1400
export const MAX_BYTES = 600_000 // размер итоговой строки data: URL
export const MAX_SOURCE = 25 * 1024 * 1024

export function fitSize(w: number, h: number, max = MAX_SIDE): { w: number; h: number } {
  if (w <= 0 || h <= 0) return { w: 1, h: 1 }
  const k = Math.min(1, max / Math.max(w, h))
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

export const isImageFile = (f: { type: string }) => /^image\/(png|jpe?g|webp|gif|bmp|avif)$/.test(f.type)

/** Уменьшает картинку до MAX_SIDE и ужимает до MAX_BYTES. Бросает Error с понятным текстом. */
export async function shrinkImage(file: Blob): Promise<string> {
  if (!isImageFile(file)) throw new Error('Это не картинка')
  if (file.size > MAX_SOURCE) throw new Error('Файл больше 25 МБ')
  let bmp: ImageBitmap
  try {
    bmp = await createImageBitmap(file)
  } catch {
    throw new Error('Не удалось прочитать картинку')
  }
  try {
    let side = MAX_SIDE
    for (let attempt = 0; attempt < 5; attempt++) {
      const { w, h } = fitSize(bmp.width, bmp.height, side)
      const cv = document.createElement('canvas')
      cv.width = w
      cv.height = h
      const g = cv.getContext('2d')
      if (!g) throw new Error('Не удалось обработать картинку')
      g.drawImage(bmp, 0, 0, w, h)
      // png сохраняет прозрачность — пробуем его первым, если выходит слишком тяжело, переходим на jpeg
      if (file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/gif') {
        const png = cv.toDataURL('image/png')
        if (png.length <= MAX_BYTES) return png
      }
      const flat = document.createElement('canvas')
      flat.width = w
      flat.height = h
      const f = flat.getContext('2d')!
      f.fillStyle = '#fff'
      f.fillRect(0, 0, w, h)
      f.drawImage(cv, 0, 0)
      const jpg = flat.toDataURL('image/jpeg', attempt < 2 ? 0.85 : 0.7)
      if (jpg.length <= MAX_BYTES) return jpg
      side = Math.round(side * 0.75)
    }
    throw new Error('Картинка слишком тяжёлая даже после сжатия')
  } finally {
    bmp.close()
  }
}
