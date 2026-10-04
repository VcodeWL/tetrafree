import test from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { checkFolder, winDrives } from './folders.mjs'

const home = path.resolve('/home/u')
test('относительный и пустой путь отклоняются', () => {
  assert.throws(() => checkFolder('', home), /абсолютный/)
  assert.throws(() => checkFolder('app', home), /абсолютный/)
  assert.throws(() => checkFolder('~/app', home), /абсолютный/)
})
test('корень диска и домашняя папка целиком не подходят', () => {
  assert.throws(() => checkFolder(path.parse(home).root, home), /корень/)
  assert.throws(() => checkFolder(home, home), /домашняя/)
  assert.throws(() => checkFolder(home + '/', home), /домашняя/)
})
test('обычный абсолютный путь нормализуется', () => {
  assert.equal(checkFolder(home + '/work/../app/', home), path.join(home, 'app'))
  assert.equal(checkFolder('  ' + home + '/a  ', home), path.join(home, 'a'))
})

test('winDrives: только существующие диски, без фантомных записей', () => {
  const have = new Set(['C:\\', 'D:\\'])
  assert.deepEqual(
    winDrives((p) => have.has(p)),
    [
      { name: 'C:', path: 'C:\\' },
      { name: 'D:', path: 'D:\\' },
    ],
  )
  assert.deepEqual(
    winDrives(() => false),
    [],
  )
})
