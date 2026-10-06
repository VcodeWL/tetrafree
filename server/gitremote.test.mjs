import test from 'node:test'
import assert from 'node:assert/strict'
import { checkRemoteUrl, redactUrl } from './gitremote.mjs'

test('нормальные адреса проходят', () => {
  for (const u of [
    'https://github.com/VcodeWL/tetrafree.git',
    'https://gitlab.example.com:8443/team/app',
    'ssh://git@github.com/team/app.git',
    'git@github.com:team/app.git',
  ])
    assert.equal(checkRemoteUrl(u).ok, true, u)
})
test('пробелы по краям срезаются', () => {
  assert.equal(checkRemoteUrl('  https://github.com/a/b.git \n').url, 'https://github.com/a/b.git')
})
test('опасное и ненужное отклоняется', () => {
  for (const u of [
    '',
    '-oProxyCommand=calc',
    '--upload-pack=x',
    'ext::sh -c calc',
    'file:///C:/repo',
    'C:\\repo',
    '/tmp/repo',
    'http://github.com/a/b.git',
    'https://github.com',
    'https://github.com/a/../b',
    'https://github.com/a b',
    'git@github.com:/abs/path',
    'ssh://host',
    'https://host/a;rm -rf',
    'https://host/' + 'a'.repeat(400),
  ])
    assert.equal(checkRemoteUrl(u).ok, false, JSON.stringify(u))
})
test('токен в адресе не принимаем и не показываем', () => {
  const r = checkRemoteUrl('https://user:ghp_secret@github.com/a/b.git')
  assert.equal(r.ok, false)
  assert.ok(!r.reason.includes('ghp_secret'))
  assert.equal(redactUrl('https://user:tok@github.com/a/b.git'), 'https://github.com/a/b.git')
  assert.equal(redactUrl('git@github.com:a/b.git'), 'git@github.com:a/b.git')
})
