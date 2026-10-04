import test from 'node:test'
import assert from 'node:assert/strict'
import { merge3, mapCaret, hasMarkers, resolveMarkers } from './merge3.ts'

const L = (...a: string[]) => a.join('\n')
test('правки в разных местах сливаются', () => {
  const base = L('a', 'b', 'c', 'd', 'e', 'f')
  const r = merge3(base, L('a', 'B', 'c', 'd', 'e', 'f'), L('a', 'b', 'c', 'd', 'e', 'F'))!
  assert.equal(r.text, L('a', 'B', 'c', 'd', 'e', 'F'))
  assert.equal(r.conflict, false)
})
test('вставки с разных сторон', () => {
  const r = merge3(L('x', 'y'), L('top', 'x', 'y'), L('x', 'y', 'bottom'))!
  assert.equal(r.text, L('top', 'x', 'y', 'bottom'))
})
test('одинаковые правки не дублируются', () => {
  const r = merge3(L('a', 'b', 'c'), L('a', 'X', 'c'), L('a', 'X', 'c'))!
  assert.equal(r.text, L('a', 'X', 'c'))
  assert.equal(r.conflict, false)
})
test('правка одной строки с двух сторон — маркеры конфликта', () => {
  const r = merge3(L('a', 'b', 'c'), L('a', 'mine', 'c'), L('a', 'theirs', 'c'), {
    ours: 'я',
    theirs: 'Мила',
  })!
  assert.equal(r.conflict, true)
  assert.equal(r.conflicts, 1)
  assert.equal(r.text, L('a', '<<<<<<< я', 'mine', '=======', 'theirs', '>>>>>>> Мила', 'c'))
  assert.ok(hasMarkers(r.text))
})
test('удаление против правки в другом месте', () => {
  const r = merge3(L('a', 'b', 'c', 'd'), L('a', 'c', 'd'), L('a', 'b', 'c', 'D'))!
  assert.equal(r.text, L('a', 'c', 'D'))
  assert.equal(r.conflict, false)
})
test('пустые файлы и переводы строк', () => {
  assert.equal(merge3('', 'x\n', '')!.text, 'x\n')
  assert.equal(merge3('a\n', 'a\nb\n', 'z\na\n')!.text, 'z\na\nb\n')
})
test('огромные несовместимые файлы — null, а не зависание', () => {
  const big = (k: number) => Array.from({ length: 4000 }, (_, i) => `${k}-${i}`).join('\n')
  assert.equal(merge3(big(1), big(2), big(3)), null)
})
test('курсор переезжает вместе с текстом', () => {
  assert.equal(mapCaret('hello world', 'XX hello world', 8), 11)
  assert.equal(mapCaret('hello world', 'hello world!', 3), 3)
  assert.equal(mapCaret('abcdef', 'abXYZef', 3), 2)
})
test('снятие маркеров конфликта', () => {
  const r = merge3(L('a', 'b', 'c'), L('a', 'mine', 'c'), L('a', 'theirs', 'c'))!.text
  assert.equal(resolveMarkers(r, 'ours'), L('a', 'mine', 'c'))
  assert.equal(resolveMarkers(r, 'theirs'), L('a', 'theirs', 'c'))
  assert.equal(resolveMarkers(r, 'both'), L('a', 'mine', 'theirs', 'c'))
  assert.equal(hasMarkers(resolveMarkers(r, 'both')), false)
})
