import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkPath, isAbsPath, joinPath, folderLost, cleanApiBase } from './paths'

const p = { files: { 'a/b.ts': '', 'README.md': '' } as Record<string, string>, dirs: ['a', 'empty'] }
test('checkPath: валидные пути', () => {
  assert.equal(checkPath(p, 'a/c.ts'), null)
  assert.equal(checkPath(p, 'new/deep/x.md'), null)
})
test('checkPath: запреты', () => {
  assert.ok(checkPath(p, ''))
  assert.ok(checkPath(p, '/abs'))
  assert.ok(checkPath(p, 'a//b'))
  assert.ok(checkPath(p, '../x'))
  assert.ok(checkPath(p, 'a\\b'))
  assert.ok(checkPath(p, 'x.'))
  assert.ok(checkPath(p, 'a/b.ts'))
  assert.ok(checkPath(p, 'readme.md'), 'регистр не должен давать дубль')
  assert.ok(checkPath(p, 'empty'))
  assert.ok(checkPath(p, 'README.md/x'), 'нельзя класть внутрь файла')
})
test('checkPath: переименование', () => {
  assert.equal(checkPath(p, 'a/B.ts', 'a/b.ts'), null, 'смена регистра самого себя разрешена')
  assert.ok(checkPath(p, 'a/x', 'a'), 'папку нельзя в саму себя')
})

test('isAbsPath: Windows, UNC и POSIX — абсолютные, «~» и относительные — нет', () => {
  for (const p of ['C:\\work\\app', 'd:/x', '\\\\srv\\share\\a', '/home/u/app'])
    assert.equal(isAbsPath(p), true, p)
  for (const p of ['~/dev/app', 'app', '', undefined]) assert.equal(isAbsPath(p), false, String(p))
})

test('joinPath держит разделитель пути проекта', () => {
  assert.equal(joinPath('C:\\work\\app', 'src/a.ts'), 'C:\\work\\app\\src\\a.ts')
  assert.equal(joinPath('C:\\work\\app\\', 'a.ts'), 'C:\\work\\app\\a.ts')
  assert.equal(joinPath('/home/u/app/', 'src/a.ts'), '/home/u/app/src/a.ts')
})

test('folderLost: пустой диск при непустой базе — папка потеряна; новый проект — нет', () => {
  assert.equal(folderLost(0, 5), true)
  assert.equal(folderLost(0, 0), false)
  assert.equal(folderLost(3, 5), false)
})

test('cleanApiBase срезает эндпоинт и слэши', () => {
  assert.equal(cleanApiBase('https://api.openai.com/v1/chat/completions'), 'https://api.openai.com/v1')
  assert.equal(cleanApiBase(' https://api.anthropic.com/v1/messages/ '), 'https://api.anthropic.com/v1')
  assert.equal(cleanApiBase('http://localhost:11434/v1/'), 'http://localhost:11434/v1')
  assert.equal(cleanApiBase('https://x.dev/v1/models?x=1'), 'https://x.dev/v1')
})

test('checkPath: зарезервированные имена Windows', () => {
  for (const n of ['con', 'NUL.txt', 'src/aux.json', 'com1', 'lpt9.md'])
    assert.match(checkPath(p, n) || '', /зарезервированное/, n)
  assert.equal(checkPath(p, 'console.txt'), null)
  assert.equal(checkPath(p, 'src/connect.ts'), null)
})

test('имя проекта из адреса репозитория', async () => {
  const { repoName } = await import('./paths')
  assert.equal(repoName('https://github.com/VcodeWL/tetrafree.git'), 'tetrafree')
  assert.equal(repoName('git@github.com:team/app.git'), 'app')
  assert.equal(repoName('https://host/team/app/'), 'app')
  assert.equal(repoName('https://host/a/b.GIT'), 'b')
  assert.equal(repoName(''), '')
})

test('пути от агента: только внутри проекта и не в служебных папках', async () => {
  const { agentPathError } = await import('./paths')
  for (const ok of ['a.ts', 'src/a/b.ts', '.github/workflows/x.yml', 'docs/Идея.md'])
    assert.equal(agentPathError(ok), null, ok)
  for (const bad of [
    '',
    '../x',
    'a/../../x',
    '/etc/passwd',
    'C:/x',
    'C:\\x',
    '~/x',
    '.git/hooks/pre-commit',
    '.GIT/config',
    '.tetrafree/id',
    'a\\b',
    'a//b',
    'con.txt',
    'x/NUL',
  ])
    assert.ok(agentPathError(bad), bad)
})
