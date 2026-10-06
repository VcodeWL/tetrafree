import type { Project } from '../types'

export const PROTECTED: string[] = []
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i

/** Проверка имени нового пути в проекте. Возвращает текст ошибки или null. `self` — путь, который переименовываем (его можно «занять» заново). */
export function checkPath(p: Pick<Project, 'files' | 'dirs'>, path: string, self?: string): string | null {
  if (!path) return 'Введи имя'
  if (path.length > 200) return 'Слишком длинный путь'
  if (/[\\\u0000-\u001f<>:"|?*]/.test(path)) return 'В имени нельзя: \\ < > : " | ? * и управляющие символы'
  if (path.startsWith('/') || path.endsWith('/')) return 'Путь не должен начинаться или заканчиваться на «/»'
  const parts = path.split('/')
  if (parts.some((x) => !x.trim())) return 'Пустая часть пути («//»)'
  if (parts.some((x) => x === '.' || x === '..')) return 'Точки «.» и «..» не поддерживаются'
  if (parts.some((x) => x !== x.trim() || x.endsWith('.')))
    return 'Имя не должно кончаться точкой или пробелом'
  /* имена устройств Windows (CON, NUL, COM1…, с любым расширением) — файловая система их не создаёт */
  const dev = parts.find((x) => RESERVED.test(x))
  if (dev) return `«${dev}» — зарезервированное имя Windows (CON, PRN, AUX, NUL, COM1–9, LPT1–9)`
  const lower = path.toLowerCase()
  const clash = (x: string) => x !== self && !(self && x.startsWith(self + '/')) && x.toLowerCase() === lower
  if (Object.keys(p.files).some(clash) || p.dirs.some(clash)) return 'Такое имя уже занято'
  // нельзя сделать папкой путь, где уже лежит файл, и наоборот
  for (let i = 1; i < parts.length; i++) {
    const pre = parts.slice(0, i).join('/')
    if (pre in p.files && pre !== self) return `«${pre}» — это файл, а не папка`
  }
  if (self && (path === self || path.startsWith(self + '/')))
    return 'Нельзя переместить папку внутрь самой себя'
  return null
}

/** Путь, который предлагает агент (или внешний источник): только относительный, внутри проекта, не в служебных папках */
export function agentPathError(path: string): string | null {
  const e = checkPath({ files: {}, dirs: [] }, path)
  if (e) return 'Недопустимый путь «' + path + '»: ' + e
  if (/^[a-zA-Z]:/.test(path) || path.startsWith('~'))
    return 'Недопустимый путь «' + path + '»: нужен путь внутри проекта'
  const top = path.split('/')[0].toLowerCase()
  if (top === '.git' || top === '.tetrafree') return 'Недопустимый путь «' + path + '»: служебная папка'
  return null
}

/** Абсолютный путь ОС: C:\\dir, \\\\server\\share или /dir */
export const isAbsPath = (p?: string) =>
  !!p && (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('/') || p.startsWith('\\\\'))

/** Путь к файлу проекта в записи, родной для ОС (разделитель берём из пути проекта) */
export const joinPath = (dir: string, rel: string) => {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  return dir.replace(/[\\/]+$/, '') + sep + (sep === '\\' ? rel.replace(/\//g, '\\') : rel)
}

/** Папка пуста, хотя раньше в ней были файлы (удалена, не подключён диск, всё стёрто снаружи). Синхронизацию не продолжаем — иначе пустая папка «удалила» бы проект. */
export const folderLost = (diskCount: number, baseCount: number) => diskCount === 0 && baseCount > 0

/** Базовый адрес API без хвоста: люди часто вставляют полный адрес эндпоинта (…/chat/completions) */
export const cleanApiBase = (u: string) =>
  u
    .trim()
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '')
    .replace(/\/(chat\/completions|completions|messages|models)$/, '')
    .replace(/\/+$/, '')

/** Имя проекта из адреса репозитория: …/team/app.git → app */
export const repoName = (u: string) =>
  (u.trim().replace(/\/+$/, '').split(/[/:]/).pop() || '').replace(/\.git$/i, '')
