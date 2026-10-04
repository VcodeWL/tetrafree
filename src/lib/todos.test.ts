import { test } from 'node:test'
import assert from 'node:assert/strict'
import { scanTodos } from './todos'

test('scanTodos: разные стили комментариев', () => {
  const r = scanTodos({
    'a.ts':
      'const x = 1 // TODO: сделать кэш\n/* FIXME (bob) - упадёт на пустом */\nconst s = "TODO не комментарий"',
    'b.py': '# todo нет\n# TODO вернуть ошибку',
    'c.html': '<!-- TODO поправить вёрстку -->',
    'd.md': '// TODO в документации игнорируется',
    'node_modules/x.js': '// TODO чужое',
  })
  assert.deepEqual(
    r.map((t) => `${t.file}:${t.line}:${t.kind}:${t.text}`),
    [
      'a.ts:1:TODO:сделать кэш',
      'a.ts:2:FIXME:упадёт на пустом */'.replace(' */', ''),
      'b.py:2:TODO:вернуть ошибку',
      'c.html:1:TODO:поправить вёрстку',
    ],
  )
})
test('scanTodos: лимит', () => {
  const src = Array.from({ length: 10 }, () => '// TODO x').join('\n')
  assert.equal(scanTodos({ 'a.js': src }, 3).length, 3)
})
