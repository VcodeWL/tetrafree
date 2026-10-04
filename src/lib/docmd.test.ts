import test from 'node:test'
import assert from 'node:assert/strict'
import { blockMd, blocksMd, blockText, newTable, tableMd } from './docmd'
import { parseMd } from './mdimport'
import type { Block } from '../types'

const b = (type: Block['type'], text = '', extra: Partial<Block> = {}): Block => ({
  id: 'x',
  type,
  text,
  ...extra,
})

test('таблица в Markdown: разделитель после заголовка, | экранируется', () => {
  assert.equal(
    tableMd([
      ['A', 'B'],
      ['1', 'x|y'],
    ]),
    '| A | B |\n| --- | --- |\n| 1 | x\\|y |',
  )
  assert.equal(tableMd([]), '')
})
test('newTable прямоугольная', () => {
  const t = newTable(2, 4)
  assert.equal(t.length, 4)
  assert.ok(t.every((r) => r.length === 2))
})
test('пункты списка идут подряд, остальные блоки через пустую строку', () => {
  const md = blocksMd([b('p', 'a'), b('li', 'x'), b('li', 'y', { indent: 1 }), b('p', 'z')])
  assert.equal(md, 'a\n\n- x\n  - y\n\nz')
})
test('круг: Markdown → блоки → Markdown сохраняет таблицу и вложенность', () => {
  const src = '- a\n  - b\n\n| H1 | H2 |\n| --- | --- |\n| 1 | 2 |'
  const blocks = parseMd(src, 'f').blocks
  assert.equal(blocksMd(blocks), src)
})
test('картинка: подпись без скобок, без src — пусто', () => {
  assert.equal(
    blockMd(b('image', 'a[b]', { src: 'data:image/png;base64,AA' })),
    '![ab](data:image/png;base64,AA)',
  )
  assert.equal(blockMd(b('image', 'a')), '')
})
test('blockText собирает ячейки таблицы', () => {
  assert.equal(
    blockText(
      b('table', '', {
        rows: [
          ['a', 'b'],
          ['c', 'd'],
        ],
      }),
    ),
    'a b\nc d',
  )
})
