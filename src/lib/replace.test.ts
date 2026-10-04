import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findHits, replaceIn, compile } from './replace'

const plain = { regex: false, caseSensitive: false }
test('простой поиск: спецсимволы не регулярка, регистр', () => {
  const f = { 'a.ts': 'foo(1)\nFoo(2)\n', 'b.ts': 'none' }
  assert.deepEqual(
    findHits(f, 'foo(', plain).map((h) => [h.path, h.count, h.line]),
    [['a.ts', 2, 1]],
  )
  assert.equal(findHits(f, 'foo(', { ...plain, caseSensitive: true })[0].count, 1)
})
test('замена: $ в обычном режиме буквальный, в regex — группы', () => {
  assert.equal(replaceIn('price', 'price', '$&$1', plain), '$&$1')
  assert.equal(replaceIn('a-1 b-2', '(\\w)-(\\d)', '$2$1', { regex: true, caseSensitive: true }), '1a 2b')
})
test('ошибки: пусто, битая регулярка, пустое совпадение', () => {
  assert.throws(() => compile('', plain))
  assert.throws(() => compile('(', { regex: true, caseSensitive: false }), /Некорректное/)
  assert.throws(() => compile('a*', { regex: true, caseSensitive: false }), /пустой/)
})
test('пропуск файлов и номер строки', () => {
  const f = { 'x/a.ts': 'q\nneedle here', 'env/e.yaml': 'needle' }
  const h = findHits(f, 'needle', plain, (p) => p.startsWith('env/'))
  assert.equal(h.length, 1)
  assert.equal(h[0].line, 2)
  assert.equal(h[0].text, 'needle here')
})
