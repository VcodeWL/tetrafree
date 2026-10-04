/* Проверка пути, который пользователь выбрал для проекта. */
import os from 'node:os'
import path from 'node:path'

export const bad = (message) => Object.assign(new Error(message), { status: 400 })

/** Возвращает нормализованный абсолютный путь или бросает понятную ошибку. */
export function checkFolder(raw, home = os.homedir()) {
  const p = String(raw || '').trim()
  if (!p || !path.isAbsolute(p))
    throw bad('Нужен абсолютный путь к папке (например ' + path.join(home, 'projects', 'app') + ')')
  if (p.includes('\0')) throw bad('В пути есть недопустимые символы')
  const abs = path.resolve(p)
  if (abs === path.parse(abs).root) throw bad('Нельзя использовать корень диска как папку проекта')
  if (abs === path.resolve(home)) throw bad('Выбери подпапку: домашняя папка целиком не подходит для проекта')
  return abs
}

/** Диски Windows для выбора папки: только существующие, без дублей (exists — проверка наличия пути) */
export const winDrives = (exists) =>
  [...'CDEFGHIJKLMNOPQRSTUVWXYZ']
    .filter((L) => exists(L + ':\\'))
    .map((L) => ({ name: L + ':', path: L + ':\\' }))
