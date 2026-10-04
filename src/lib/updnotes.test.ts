import test from 'node:test'
import assert from 'node:assert/strict'
import { notesLines } from './updnotes'

test('notesLines: убирает заголовки и маркеры', () => {
  const r = notesLines('## 2.6.0\n\n- **Новое:** `лог` сервера\n* [ссылка](http://x)\n---\n1. третий')
  assert.deepEqual(r, ['Новое: лог сервера', 'ссылка', 'третий'])
})
test('notesLines: лимит и пустой ввод', () => {
  assert.deepEqual(notesLines(null), [])
  assert.deepEqual(notesLines('a\nb\nc\nd\ne'), ['a', 'b', 'c', 'd'])
  assert.equal(notesLines('x'.repeat(300))[0].length, 138)
})
