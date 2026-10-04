import test from 'node:test'
import assert from 'node:assert/strict'
import { grid, parseTyped, parseIso, shiftMonth, fmtRu } from './cal'

test('сетка начинается с понедельника и имеет 42 дня', () => {
  const g = grid(2025, 9) // октябрь 2025: 1-е — среда
  assert.equal(g.length, 42)
  assert.equal(g[0].iso, '2025-09-29')
  assert.equal(g[2].iso, '2025-10-01')
  assert.equal(g[2].out, false)
  assert.equal(g[0].out, true)
})
test('сетка для месяца, начинающегося с понедельника', () => assert.equal(grid(2025, 8)[0].iso, '2025-09-01')) // сентябрь 2025
test('разбор ввода', () => {
  assert.equal(parseTyped('31.12.2025'), '2025-12-31')
  assert.equal(parseTyped('5.3.26'), '2026-03-05')
  assert.equal(parseTyped('2025-02-30'), null)
  assert.equal(parseTyped('31.02.2025'), null)
  assert.equal(parseTyped('abc'), null)
  assert.equal(parseIso('2024-02-29')?.d, 29)
})
test('сдвиг месяцев и формат', () => {
  assert.deepEqual(shiftMonth(2025, 11, 1), { y: 2026, m: 0 })
  assert.deepEqual(shiftMonth(2025, 0, -1), { y: 2024, m: 11 })
  assert.equal(fmtRu('2025-03-07'), '07.03.2025')
})
