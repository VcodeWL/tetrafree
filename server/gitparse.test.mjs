import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseStatus, parseLog, kindOf } from './gitparse.mjs'

test('parseStatus: ветка, ahead/behind и файлы', () => {
  const s = parseStatus(
    '## main...origin/main [ahead 2, behind 1]\0 M src/a.ts\0?? new file.txt\0R  b.ts\0a.ts\0D  gone.ts\0',
  )
  assert.equal(s.branch, 'main')
  assert.equal(s.upstream, 'origin/main')
  assert.equal(s.ahead, 2)
  assert.equal(s.behind, 1)
  assert.deepEqual(
    s.files.map((f) => f.path),
    ['src/a.ts', 'new file.txt', 'b.ts', 'gone.ts'],
  )
  assert.equal(s.files[2].from, 'a.ts')
})
test('parseStatus: репозиторий без коммитов', () => {
  const s = parseStatus('## No commits yet on main\0?? a.txt\0')
  assert.equal(s.branch, 'main')
  assert.equal(s.files.length, 1)
})
test('kindOf', () => {
  assert.equal(kindOf({ x: '?', y: '?' }), 'new')
  assert.equal(kindOf({ x: ' ', y: 'M' }), 'mod')
  assert.equal(kindOf({ x: 'D', y: ' ' }), 'del')
  assert.equal(kindOf({ x: 'U', y: 'U' }), 'conflict')
  assert.equal(kindOf({ x: 'R', y: ' ' }), 'ren')
})
test('parseLog', () => {
  const l = parseLog(
    'aaa\x1fa1\x1fПервый коммит\x1fАлиса\x1f1700000000\x1ebbb\x1fb2\x1fВторой\x1fБоб\x1f1700000100\x1e',
  )
  assert.equal(l.length, 2)
  assert.equal(l[0].subject, 'Первый коммит')
  assert.equal(l[1].at, 1700000100000)
})

import { parseBlame } from './gitparse.mjs'
test('parseBlame', () => {
  const H1 = 'a'.repeat(40),
    H2 = '0'.repeat(40)
  const out = `${H1} 1 1 2\nauthor Алиса\nauthor-mail <a@x>\nauthor-time 1700000000\nsummary Первый\nfilename f.ts\n\tconst a = 1\n${H1} 2 2\nauthor Алиса\nauthor-time 1700000000\nsummary Первый\nfilename f.ts\n\tconst b = 2\n${H2} 3 3 1\nauthor Not Committed Yet\nauthor-time 1800000000\nsummary Version of f.ts from f.ts\nfilename f.ts\n\tlet c\n`
  const r = parseBlame(out)
  assert.equal(r.length, 3)
  assert.deepEqual(
    r.map((x) => [x.line, x.text, x.author]),
    [
      [1, 'const a = 1', 'Алиса'],
      [2, 'const b = 2', 'Алиса'],
      [3, 'let c', 'Not Committed Yet'],
    ],
  )
  assert.equal(r[0].summary, 'Первый')
  assert.equal(r[2].hash, H2)
})

import { splitHunks, pickHunks } from './gitparse.mjs'
const D =
  'diff --git a/f.txt b/f.txt\nindex 1..2 100644\n--- a/f.txt\n+++ b/f.txt\n@@ -1,2 +1,2 @@\n a\n-b\n+B\n@@ -10,2 +10,3 @@\n x\n y\n+z\n'
test('splitHunks: заголовок и два блока', () => {
  const r = splitHunks(D)
  assert.equal(r.hunks.length, 2)
  assert.ok(r.header.endsWith('+++ b/f.txt\n'))
  assert.ok(r.hunks[1].startsWith('@@ -10,2'))
})
test('pickHunks: только выбранные, лишние и повторные номера отбрасываются', () => {
  const p = pickHunks(D, [1, 1, 7, -1])
  assert.ok(p.includes('+z') && !p.includes('+B'))
  assert.ok(p.startsWith('diff --git'))
  assert.equal(pickHunks(D, []), '')
  assert.equal(pickHunks('нет блоков', [0]), '')
})
