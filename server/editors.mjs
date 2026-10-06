/* Внешние редакторы кода: поиск установленных и аргументы запуска «открыть проект / файл на строке».
   Запускаем сам исполняемый файл без оболочки (никакой подстановки в командную строку), поэтому пути из проекта не могут выполнить лишнего. */
import fs from 'node:fs'
import path from 'node:path'

/** win — шаблоны путей установки (%X% подставляется из окружения); bin — имена на PATH */
export const EDITORS = [
  {
    id: 'vscode',
    name: 'VS Code',
    style: 'code',
    win: [
      '%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe',
      '%ProgramFiles%\\Microsoft VS Code\\Code.exe',
    ],
    bin: ['code'],
  },
  {
    id: 'cursor',
    name: 'Cursor',
    style: 'code',
    win: ['%LOCALAPPDATA%\\Programs\\cursor\\Cursor.exe', '%LOCALAPPDATA%\\Programs\\Cursor\\Cursor.exe'],
    bin: ['cursor'],
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    style: 'code',
    win: ['%LOCALAPPDATA%\\Programs\\Windsurf\\Windsurf.exe'],
    bin: ['windsurf'],
  },
  {
    id: 'vscodium',
    name: 'VSCodium',
    style: 'code',
    win: ['%LOCALAPPDATA%\\Programs\\VSCodium\\VSCodium.exe', '%ProgramFiles%\\VSCodium\\VSCodium.exe'],
    bin: ['codium'],
  },
  {
    id: 'zed',
    name: 'Zed',
    style: 'colon',
    win: ['%LOCALAPPDATA%\\Programs\\Zed\\zed.exe', '%LOCALAPPDATA%\\Zed\\zed.exe'],
    bin: ['zed'],
  },
  {
    id: 'sublime',
    name: 'Sublime Text',
    style: 'colon',
    win: [
      '%ProgramFiles%\\Sublime Text\\sublime_text.exe',
      '%ProgramFiles%\\Sublime Text 3\\sublime_text.exe',
    ],
    bin: ['subl'],
  },
]

const expand = (tpl, env) => tpl.replace(/%([A-Za-z0-9_()]+)%/g, (_, k) => env[k] ?? '\0')
const isExe = (p, exists) => !p.includes('\0') && exists(p)

/** Полный путь к исполняемому файлу редактора или null. exists/platform/env подменяются в тестах. */
export function findEditor(
  ed,
  { platform = process.platform, env = process.env, exists = (p) => fs.existsSync(p) } = {},
) {
  if (platform === 'win32') {
    for (const t of ed.win) {
      const p = expand(t, env)
      if (isExe(p, exists)) return p
    }
    return null
  }
  const dirs = String(env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
  for (const b of ed.bin) for (const d of dirs) if (exists(path.join(d, b))) return path.join(d, b)
  if (platform === 'darwin' && ed.id === 'vscode') {
    const app = '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code'
    if (exists(app)) return app
  }
  return null
}

export function detectEditors(opts) {
  return EDITORS.map((e) => ({ id: e.id, name: e.name, exe: findEditor(e, opts) })).filter((e) => e.exe)
}

/** Аргументы: папка проекта, а если указан файл — ещё и он на нужной строке. */
export function editorArgs(ed, dir, abs, line) {
  const ln = Math.max(1, Math.min(1e7, Math.floor(Number(line)) || 1))
  if (!abs) return [dir]
  return ed.style === 'code' ? [dir, '--goto', `${abs}:${ln}`] : [dir, `${abs}:${ln}`]
}
