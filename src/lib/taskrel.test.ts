import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextDate, spawnNext, canBlock, openBlockers } from './taskrel'
import type { Task } from '../types'

const T = (o: Partial<Task>): Task =>
  ({
    id: 'a',
    key: 1,
    title: 't',
    desc: '',
    status: 'todo',
    assignee: null,
    priority: 'med',
    createdAt: 0,
    ...o,
  }) as Task

test('nextDate: день, неделя, будни', () => {
  assert.equal(nextDate('2025-10-10', 'daily', '2025-10-01'), '2025-10-11')
  assert.equal(nextDate('2025-10-10', 'weekly', '2025-10-01'), '2025-10-17')
  assert.equal(nextDate('2025-10-10', 'weekdays', '2025-10-01'), '2025-10-13') // пятница → понедельник
})
test('nextDate: конец месяца не перескакивает', () => {
  assert.equal(nextDate('2025-01-31', 'monthly', '2025-01-01'), '2025-02-28')
  assert.equal(nextDate('2024-01-31', 'monthly', '2024-01-01'), '2024-02-29')
  assert.equal(nextDate('2025-12-15', 'monthly', '2025-12-01'), '2026-01-15')
})
test('nextDate: после простоя не раньше сегодня', () => {
  assert.equal(nextDate('2025-01-01', 'weekly', '2025-03-01'), '2025-03-05')
})
test('spawnNext: копия без прогресса, сдвиг начала вместе со сроком', () => {
  const n = spawnNext(
    T({
      repeat: 'weekly',
      start: '2025-10-06',
      due: '2025-10-10',
      subtasks: [{ id: 's', text: 'x', done: true }],
    }),
    '2025-10-01',
  )!
  assert.equal(n.due, '2025-10-17')
  assert.equal(n.start, '2025-10-13')
  assert.equal(n.status, 'backlog')
  assert.equal(n.subtasks![0].done, false)
  assert.equal(spawnNext(T({}), '2025-10-01'), null)
})
test('зависимости: цикл запрещён, готовые не блокируют', () => {
  const a = T({ id: 'a', blockedBy: ['b'] }),
    b = T({ id: 'b', blockedBy: ['c'] }),
    c = T({ id: 'c', status: 'done' })
  assert.equal(canBlock([a, b, c], 'b', 'a'), false) // b ждёт a, а a уже ждёт b
  assert.equal(canBlock([a, b, c], 'c', 'a'), false) // транзитивно
  assert.equal(canBlock([a, b, c], 'a', 'a'), false)
  assert.equal(canBlock([a, b, c], 'a', 'c'), true)
  assert.deepEqual(
    openBlockers(a, [a, b, c]).map((x) => x.id),
    ['b'],
  )
  assert.deepEqual(openBlockers(b, [a, b, c]), [])
})
