/* Корзина проекта: удалённые файлы живут 30 дней, потом исчезают сами. */
export interface TrashItem {
  path: string
  content: string
  at: number
}
export const TRASH_DAYS = 30
export const TRASH_MAX = 200 // файлов
export const FILE_MAX = 400_000 // символов в одном файле; бóльшие в корзину не кладём

export const purge = (t: TrashItem[], now = Date.now()) => t.filter((x) => now - x.at < TRASH_DAYS * 864e5)

/** положить файлы в корзину: свежая копия того же пути заменяет старую, лишнее старьё отбрасывается */
export function put(t: TrashItem[], files: Record<string, string>, now = Date.now()): TrashItem[] {
  const add = Object.entries(files)
    .filter(([, c]) => c.length <= FILE_MAX)
    .map(([path, content]) => ({ path, content, at: now }))
  const keep = purge(t, now).filter((x) => !add.some((a) => a.path === x.path))
  return [...add, ...keep].slice(0, TRASH_MAX)
}

/** свободное имя для восстановления: если путь занят — «имя (восстановлено).ext» */
export function freePath(exists: (p: string) => boolean, path: string): string {
  if (!exists(path)) return path
  const i = path.lastIndexOf('/'),
    dir = path.slice(0, i + 1),
    base = path.slice(i + 1)
  const d = base.lastIndexOf('.'),
    name = d > 0 ? base.slice(0, d) : base,
    ext = d > 0 ? base.slice(d) : ''
  for (let n = 1; ; n++) {
    const c = `${dir}${name} (восстановлено${n > 1 ? ' ' + n : ''})${ext}`
    if (!exists(c)) return c
  }
}

/** сколько дней осталось */
export const daysLeft = (at: number, now = Date.now()) =>
  Math.max(0, Math.ceil(TRASH_DAYS - (now - at) / 864e5))
