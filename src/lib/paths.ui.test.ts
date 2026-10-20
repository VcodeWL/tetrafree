import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkPath } from './paths'

test('UI05: file ancestors are case-insensitive', () => {
  for (const path of ['foo/bar.txt', 'FOO/bar.txt', 'foo/BAR/x'])
    assert.match(checkPath({ files: { Foo: 'file' }, dirs: [] }, path) || '', /файл/)
})
test('UI05: implicit folders cannot be replaced by differently-cased files', () => {
  assert.ok(checkPath({ files: { 'Foo/bar.txt': 'file' }, dirs: [] }, 'foo'))
  assert.ok(checkPath({ files: {}, dirs: ['Foo/bar'] }, 'foo'))
})
test('UI05: case-only file/folder rename is allowed without a false self-clash', () => {
  assert.equal(checkPath({ files: { Foo: 'file' }, dirs: [] }, 'foo', 'Foo'), null)
  assert.equal(checkPath({ files: { 'Foo/bar.txt': '' }, dirs: ['Foo'] }, 'foo', 'Foo'), null)
  assert.ok(checkPath({ files: { 'Foo/bar.txt': '' }, dirs: ['Foo'] }, 'fOO/child', 'Foo'))
})
