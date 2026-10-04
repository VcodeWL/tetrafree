import { test } from 'node:test'
import assert from 'node:assert/strict'
import { costOf, priceFor, fmtUsd, report, monthKey } from './usage'
import type { Project } from '../types'

test('цена по имени модели и переопределение', () => {
  assert.deepEqual(priceFor('claude-sonnet-4-5'), { inp: 3, out: 15 })
  assert.equal(priceFor('llama3'), null)
  assert.deepEqual(priceFor('llama3', { llama3: { inp: 1, out: 2 } }), { inp: 1, out: 2 })
  assert.ok(priceFor('gpt-4o-mini')!.inp < priceFor('gpt-4o')!.inp)
})
test('costOf: расчёт, бесплатные и неизвестные', () => {
  assert.equal(costOf({ inTok: 1_000_000, outTok: 1_000_000, steps: 1, mid: 'claude-sonnet-4' }), 18)
  assert.equal(costOf({ inTok: 5000, outTok: 5000, steps: 1, mid: 'x', free: true }), 0)
  assert.equal(costOf({ inTok: 5000, outTok: 5000, steps: 1, mid: 'неизвестная' }), null)
})
test('fmtUsd', () => {
  assert.equal(fmtUsd(0), '$0')
  assert.equal(fmtUsd(0.004), '<$0.01')
  assert.equal(fmtUsd(1.234), '$1.23')
  assert.equal(fmtUsd(12.34), '$12.3')
})
test('report: месяц отделён от всего времени, неизвестные считаются отдельно', () => {
  const now = new Date(2025, 9, 15).getTime(),
    old = new Date(2025, 7, 1).getTime()
  const msg = (at: number, mid: string) => ({
    id: String(at) + mid,
    kind: 'agent',
    at,
    usage: { inTok: 1_000_000, outTok: 0, steps: 1, mid },
  })
  const p = {
    id: 'p',
    name: 'P',
    chats: [{ id: 'c', title: 'C', messages: [msg(now, 'opus'), msg(old, 'opus'), msg(now, 'zzz')] }],
  } as unknown as Project
  const r = report([p], {}, now, 'p')
  assert.equal(r.month.cost, 15)
  assert.equal(r.month.unknown, 1)
  assert.equal(r.month.turns, 2)
  assert.equal(r.byProject[0].all.cost, 30)
  assert.equal(r.byChat[0].all.turns, 3)
  assert.equal(r.models['zzz'].known, false)
  assert.equal(monthKey(now), '2025-10')
})
