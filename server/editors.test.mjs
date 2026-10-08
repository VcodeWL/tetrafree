import test from 'node:test'
import assert from 'node:assert/strict'
import { EDITORS, findEditor, detectEditors, editorArgs } from './editors.mjs'

const ed = (id) => EDITORS.find((e) => e.id === id)

test('Windows: редактор находится по известным путям установки, нет переменной — нет и пути', () => {
  const env = { LOCALAPPDATA: 'C:\\Users\\Я\\AppData\\Local', ProgramFiles: 'C:\\Program Files' }
  const have = new Set(['C:\\Users\\Я\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe'])
  const o = { platform: 'win32', env, exists: (p) => have.has(p) }
  assert.equal(
    findEditor(ed('vscode'), o),
    'C:\\Users\\Я\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe',
  )
  assert.equal(findEditor(ed('cursor'), o), null)
  assert.equal(findEditor(ed('vscode'), { ...o, env: {} }), null, 'без LOCALAPPDATA путь не собирается')
  assert.deepEqual(
    detectEditors(o).map((e) => e.id),
    ['vscode'],
  )
})

test('Linux/macOS: ищем по PATH', () => {
  const o = { platform: 'linux', env: { PATH: '/usr/bin:/opt/x' }, exists: (p) => p === '/opt/x/zed' }
  assert.equal(findEditor(ed('zed'), o), '/opt/x/zed')
  assert.equal(findEditor(ed('vscode'), o), null)
})

test('аргументы: VS Code-семейство — --goto, Zed и Sublime — путь:строка, строка зажимается', () => {
  assert.deepEqual(editorArgs(ed('vscode'), '/p', null, 5), ['/p'])
  assert.deepEqual(editorArgs(ed('vscode'), '/p', '/p/a.ts', 12), ['/p', '--goto', '/p/a.ts:12'])
  assert.deepEqual(editorArgs(ed('zed'), '/p', '/p/a.ts', 3), ['/p', '/p/a.ts:3'])
  assert.deepEqual(editorArgs(ed('zed'), '/p', '/p/a.ts', -4), ['/p', '/p/a.ts:1'])
  assert.deepEqual(editorArgs(ed('zed'), '/p', '/p/a.ts', 'x'), ['/p', '/p/a.ts:1'])
})

import { customEditor, terminalLaunch } from './editors.mjs'

test('свой редактор: нужен абсолютный путь к существующему файлу, стиль аргументов по имени', () => {
  const yes = { exists: () => true, isFile: () => true }
  assert.equal(customEditor('relative/code', yes), null)
  assert.equal(customEditor('', yes), null)
  assert.equal(customEditor('C:\\Tools\\Code\\Code.exe', { exists: () => false, isFile: () => true }), null)
  assert.equal(customEditor('"C:\\Tools\\Cursor\\Cursor.exe"', yes).style, 'code')
  assert.equal(customEditor('D:\\Zed\\zed.exe', yes).style, 'colon')
  assert.equal(customEditor('D:\\Zed\\zed.exe', yes).name, 'zed')
  assert.equal(customEditor('/etc', { exists: () => true, isFile: () => false }), null, 'папка — не редактор')
})

test('внешний терминал: Windows Terminal, иначе PowerShell; путь не попадает в командную строку оболочки', () => {
  const dir = "C:\\Мои проекты\\it's"
  const wt = 'C:\\Users\\Я\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe'
  const a = terminalLaunch(dir, {
    platform: 'win32',
    env: { LOCALAPPDATA: 'C:\\Users\\Я\\AppData\\Local' },
    exists: (p) => p === wt,
  })
  assert.deepEqual([a.cmd, a.args], [wt, ['-d', dir]])
  const b = terminalLaunch(dir, { platform: 'win32', env: {}, exists: () => false })
  assert.equal(b.cmd, 'cmd.exe')
  assert.ok(!b.args.join(' ').includes(dir), 'папка передаётся рабочей директорией')
  assert.equal(b.cwd, dir)
  const l = terminalLaunch('/p', {
    platform: 'linux',
    env: { PATH: '/usr/bin' },
    exists: (p) => p === '/usr/bin/konsole',
  })
  assert.deepEqual([l.cmd, l.args], ['konsole', ['--workdir', '/p']])
  assert.equal(
    terminalLaunch('/p', { platform: 'linux', env: { PATH: '/usr/bin' }, exists: () => false }),
    null,
  )
})
