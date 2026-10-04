import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMd } from './mdimport'

test('заголовок, абзацы, задачи, код', () => {
  const r = parseMd(
    '---\ntag: x\n---\n# План\n\nПервая\nстрока\n\n## Шаги\n- [ ] один\n- [x] два\n\n```ts\nconst a = 1\n\nb()\n```\n> цитата\n> ещё\n\n> [!note] важно\n- пункт\n1. нумер',
    'файл',
  )
  assert.equal(r.title, 'План')
  assert.deepEqual(
    r.blocks.map((b) => [b.type, b.text, b.checked]),
    [
      ['p', 'Первая строка', undefined],
      ['h2', 'Шаги', undefined],
      ['todo', 'один', false],
      ['todo', 'два', true],
      ['code', 'const a = 1\n\nb()', undefined],
      ['quote', 'цитата ещё', undefined],
      ['callout', 'важно', undefined],
      ['li', 'пункт', undefined],
      ['p', '1. нумер', undefined],
    ],
  )
})
test('без заголовка берётся имя файла; пустой файл — один пустой абзац', () => {
  assert.equal(parseMd('просто текст', 'заметки').title, 'заметки')
  assert.equal(parseMd('', 'x').blocks.length, 1)
})
test('второй # внутри — обычный заголовок блока', () =>
  assert.deepEqual(
    parseMd('# A\n# B', 'f').blocks.map((b) => b.text),
    ['B'],
  ))

test('вложенные списки: уровни по отступам, в том числе с 4 пробелами', () => {
  const r = parseMd('- a\n    - b\n        - c\n- d\n\n- e\n  - f', 'f')
  assert.deepEqual(
    r.blocks.map((b) => [b.type, b.text, b.indent]),
    [
      ['li', 'a', 0],
      ['li', 'b', 1],
      ['li', 'c', 2],
      ['li', 'd', 0],
      ['li', 'e', 0],
      ['li', 'f', 1],
    ],
  )
})
test('таблица: заголовок, выравнивание ширины, экранированный |', () => {
  const r = parseMd('до\n\n| Имя | Роль |\n|---|:--:|\n| Аня | a\\|b |\n| Боб |\n\nпосле', 'f')
  assert.deepEqual(
    r.blocks.map((b) => b.type),
    ['p', 'table', 'p'],
  )
  assert.deepEqual(r.blocks[1].rows, [
    ['Имя', 'Роль'],
    ['Аня', 'a|b'],
    ['Боб', ''],
  ])
})
test('картинка data: превращается в блок, внешняя ссылка — остаётся текстом', () => {
  const r = parseMd('![лого](data:image/png;base64,AAAA)\n\n![x](https://e.com/a.png)', 'f')
  assert.equal(r.blocks[0].type, 'image')
  assert.equal(r.blocks[0].text, 'лого')
  assert.equal(r.blocks[1].type, 'p')
})
