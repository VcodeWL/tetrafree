import { test } from 'node:test'
import assert from 'node:assert/strict'
import { matchesTrigger, pipelinesFor } from './triggers'

test('matchesTrigger: свои события и push', () => {
  assert.equal(matchesTrigger(['version'], 'version'), true)
  assert.equal(matchesTrigger(['version'], 'commit'), false)
  assert.equal(matchesTrigger(['push'], 'commit'), true)
  assert.equal(matchesTrigger(['push'], 'version'), true)
})
test('matchesTrigger: manual и tag сами не запускаются', () => {
  assert.equal(matchesTrigger(['manual', 'tag'], 'version'), false)
  assert.equal(matchesTrigger([], 'commit'), false)
})
test('pipelinesFor: пустые пайплайны пропускаются, порядок сохраняется', () => {
  const defs = [
    { n: 'a', trigger: ['push'], steps: [1] },
    { n: 'b', trigger: ['push'], steps: [] },
    { n: 'c', trigger: ['manual'], steps: [1] },
    { n: 'd', trigger: ['commit'], steps: [1] },
  ]
  assert.deepEqual(
    pipelinesFor(defs, 'commit').map((d) => d.n),
    ['a', 'd'],
  )
  assert.deepEqual(
    pipelinesFor(defs, 'version').map((d) => d.n),
    ['a'],
  )
})

import { parseSchedule, scheduleDue, describeSchedule } from './triggers'

test('parseSchedule: every и daily, мусор и слишком частое отклоняются', () => {
  assert.deepEqual(parseSchedule('every 30m'), { kind: 'every', ms: 30 * 60e3 })
  assert.deepEqual(parseSchedule('Every 2 h'), { kind: 'every', ms: 2 * 3600e3 })
  assert.deepEqual(parseSchedule('daily 9:05'), { kind: 'daily', h: 9, m: 5 })
  for (const bad of [
    'every 1m',
    'every 0h',
    'daily 25:00',
    'daily 10:61',
    'weekly',
    '',
    undefined,
    'every 99999h',
  ])
    assert.equal(parseSchedule(bad as string), null, String(bad))
})

test('scheduleDue: every — по интервалу, первый раз только запоминаем', () => {
  const s = parseSchedule('every 30m')!
  assert.equal(scheduleDue(s, 0, 1e12), false)
  assert.equal(scheduleDue(s, 1e12, 1e12 + 29 * 60e3), false)
  assert.equal(scheduleDue(s, 1e12, 1e12 + 30 * 60e3), true)
})

test('scheduleDue: daily — раз в сутки после назначенного времени, без запуска задним числом', () => {
  const s = parseSchedule('daily 09:00')!
  const at = (d: number, h: number, m = 0) => new Date(2025, 0, d, h, m).getTime()
  assert.equal(scheduleDue(s, at(1, 10), at(1, 23)), false, 'сегодня 9:00 уже прошло до запоминания')
  assert.equal(scheduleDue(s, at(1, 10), at(2, 8, 59)), false)
  assert.equal(scheduleDue(s, at(1, 10), at(2, 9, 0)), true)
  assert.equal(scheduleDue(s, at(2, 9, 1), at(2, 15)), false, 'уже запускали сегодня')
  assert.equal(scheduleDue(s, at(1, 10), at(5, 12)), true, 'компьютер спал несколько дней — один запуск')
})

test('describeSchedule', () => {
  assert.equal(describeSchedule(parseSchedule('every 90m')!), 'каждые 90 мин')
  assert.equal(describeSchedule(parseSchedule('every 2h')!), 'каждые 2 ч')
  assert.equal(describeSchedule(parseSchedule('daily 9:05')!), 'каждый день в 09:05')
})
