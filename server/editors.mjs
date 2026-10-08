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

/** Свой редактор по полному пути (портативная установка, нестандартная папка): нужен существующий файл. */
export function customEditor(
  exe,
  { exists = (p) => fs.existsSync(p), isFile = (p) => fs.statSync(p).isFile() } = {},
) {
  const p = String(exe || '')
    .trim()
    .replace(/^"(.*)"$/, '$1')
  if (!p || p.length > 500 || p.includes('\0') || !(path.isAbsolute(p) || /^[A-Za-z]:[\\/]/.test(p)))
    return null
  try {
    if (!exists(p) || !isFile(p)) return null
  } catch {
    return null
  }
  const base = p
    .split(/[\\/]/)
    .pop()
    .replace(/\.[a-z]+$/i, '')
  /* семейство VS Code понимает --goto, остальные — путь:строка */
  const style = /code|cursor|windsurf|codium/i.test(base) ? 'code' : 'colon'
  return { id: 'custom', name: base || 'Свой редактор', style, exe: p }
}

/** Аргументы: папка проекта, а если указан файл — ещё и он на нужной строке. */
export function editorArgs(ed, dir, abs, line) {
  const ln = Math.max(1, Math.min(1e7, Math.floor(Number(line)) || 1))
  if (!abs) return [dir]
  return ed.style === 'code' ? [dir, '--goto', `${abs}:${ln}`] : [dir, `${abs}:${ln}`]
}

/** Как открыть отдельное окно терминала в папке проекта. Папка передаётся рабочей директорией или отдельным аргументом без оболочки. */
export function terminalLaunch(
  dir,
  { platform = process.platform, env = process.env, exists = (p) => fs.existsSync(p) } = {},
) {
  if (platform === 'win32') {
    const wt = env.LOCALAPPDATA ? path.win32.join(env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'wt.exe') : ''
    if (wt && exists(wt)) return { cmd: wt, args: ['-d', dir], cwd: dir }
    return { cmd: 'cmd.exe', args: ['/c', 'start', '', 'powershell.exe', '-NoExit'], cwd: dir }
  }
  if (platform === 'darwin') return { cmd: 'open', args: ['-a', 'Terminal', dir], cwd: dir }
  const dirs = String(env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean)
  const on = (b) => dirs.some((d) => exists(path.join(d, b)))
  const list = [
    ['x-terminal-emulator', []],
    ['gnome-terminal', ['--working-directory=' + dir]],
    ['konsole', ['--workdir', dir]],
    ['xfce4-terminal', ['--working-directory=' + dir]],
    ['xterm', []],
  ]
  const hit = list.find(([b]) => on(b))
  return hit ? { cmd: hit[0], args: hit[1], cwd: dir } : null
}
