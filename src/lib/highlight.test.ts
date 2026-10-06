import test from 'node:test'
import assert from 'node:assert/strict'
import { tokenize } from './highlight'

test('строки с CRLF не роняют подсветку (раньше markdown-список с \\r падал)', () => {
  for (const lang of ['md', 'ts', 'css', 'json', 'py', 'html', 'sql', 'yaml']) {
    for (const line of ['- пункт\r', '* пункт\r', '# заголовок\r', 'const a = 1 // c\r', '\r', '']) {
      const t = tokenize(line, lang)
      assert.equal(t.map((x) => x.t).join(''), line, lang + ': ' + JSON.stringify(line))
    }
  }
})

test('комментарий в строке с CRLF подсвечивается как комментарий', () => {
  const t = tokenize('x = 1 # note\r', 'py')
  assert.ok(t.some((x) => x.c === 'c' && x.t === '# note'))
})
