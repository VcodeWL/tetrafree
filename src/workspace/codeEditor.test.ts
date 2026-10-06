import test from 'node:test'
import assert from 'node:assert/strict'
import { toggleComment } from './CodeEditor'

test('toggleComment: css и html — блочные комментарии, туда и обратно', () => {
  const css = ['a { color: red }', '', 'b {}']
  const on = toggleComment(css, 'css')!
  assert.deepEqual(on, ['/* a { color: red } */', '', '/* b {} */'])
  assert.deepEqual(toggleComment(on, 'css'), css)
  assert.deepEqual(toggleComment(['<p>x</p>'], 'html'), ['<!-- <p>x</p> -->'])
  assert.deepEqual(toggleComment(['<!-- <p>x</p> -->'], 'md'), ['<p>x</p>'])
})
test('toggleComment: js строчные, json без комментариев', () => {
  assert.deepEqual(toggleComment(['let a'], 'ts'), ['// let a'])
  assert.deepEqual(toggleComment(['// let a'], 'ts'), ['let a'])
  assert.equal(toggleComment(['{}'], 'json'), null)
})

test('раскомментирование снимает только ведущий маркер', () => {
  assert.deepEqual(toggleComment(['//x // y', '// z'], 'ts'), ['x // y', 'z'])
})
