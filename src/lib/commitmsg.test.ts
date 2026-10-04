import { test } from 'node:test'
import assert from 'node:assert/strict'
import { suggestMessage } from './commitmsg'

test('suggestMessage: один файл по типу', () => {
  assert.equal(suggestMessage([{ path: 'src/a.ts', kind: 'mod' }]), 'Изменён a.ts')
  assert.equal(suggestMessage([{ path: 'b.md', kind: 'new' }]), 'Добавлен b.md')
  assert.equal(suggestMessage([{ path: 'c.md', kind: 'del' }]), 'Удалён c.md')
  assert.equal(
    suggestMessage([{ path: 'n/x.ts', kind: 'ren', from: 'o/x.ts' }]),
    'Переименован o/x.ts → n/x.ts',
  )
})
test('suggestMessage: несколько файлов группируются и обрезаются', () => {
  const m = suggestMessage([
    { path: 'a', kind: 'new' },
    { path: 'd/b', kind: 'mod' },
    { path: 'c', kind: 'mod' },
    { path: 'e', kind: 'mod' },
    { path: 'f', kind: 'mod' },
    { path: 'g', kind: 'del' },
  ])
  assert.equal(m, 'Добавлено: a; изменено: b, c, e и ещё 1; удалено: g')
})
test('suggestMessage: пусто', () => assert.equal(suggestMessage([]), ''))
