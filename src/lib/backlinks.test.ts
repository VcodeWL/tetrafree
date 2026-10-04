import test from 'node:test'
import assert from 'node:assert/strict'
import { backlinks } from './backlinks'
import type { Doc, Task } from '../types'

const d = (id: string, title: string, ...texts: string[]): Doc => ({
  id,
  title,
  createdBy: 'u',
  updatedAt: 0,
  blocks: texts.map((t, i) => ({ id: id + i, type: 'p', text: t })),
})
const t = (id: string, title: string, desc = ''): Task => ({
  id,
  key: 1,
  title,
  desc,
  status: 'backlog',
  assignee: null,
  priority: 'med',
  createdAt: 0,
})

test('явная ссылка и упоминание', () => {
  const a = d('a', 'Архитектура')
  const r = backlinks(
    a,
    [
      a,
      d('b', 'План', 'см. [[архитектура]] ниже'),
      d('c', 'Заметки', 'Про Архитектура тоже'),
      d('e', 'Другое', 'ничего'),
    ],
    [t('t1', 'Обновить', 'по документу «Архитектура»')],
  )
  assert.deepEqual(
    r.map((x) => x.id),
    ['b', 'c', 't1'],
  )
  assert.equal(r[0].explicit, true)
  assert.equal(r[1].explicit, false)
})
test('короткие названия — только явно', () => {
  const a = d('a', 'API')
  const r = backlinks(a, [a, d('b', 'X', 'тут api упомянут'), d('c', 'Y', 'тут [[API]] явно')], [])
  assert.deepEqual(
    r.map((x) => x.id),
    ['c'],
  )
})
