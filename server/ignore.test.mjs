import test from 'node:test'
import assert from 'node:assert/strict'
import { makeIgnore } from './ignore.mjs'

const ig = makeIgnore('# c\nbuild/\n*.log\n/secret.txt\ndocs/tmp\n!keep.log\n\nout-*\n')
test('папки, маски, якорь и вложенные пути', () => {
  assert.equal(ig('build', true), true)
  assert.equal(ig('build', false), false) // «build/» — только папка
  assert.equal(ig('src/build/a.js', false), true) // файл внутри игнорируемой папки
  assert.equal(ig('a/b/x.log', false), true)
  assert.equal(ig('secret.txt', false), true)
  assert.equal(ig('sub/secret.txt', false), false) // якорь «/»
  assert.equal(ig('docs/tmp/a.md', false), true)
  assert.equal(ig('docs/other.md', false), false)
  assert.equal(ig('out-1/x', false), true)
})
test('пустой и странный текст не ломает', () => {
  assert.equal(makeIgnore('')('a', false), false)
  assert.equal(makeIgnore('***\n/\n')('a', false), true)
})
