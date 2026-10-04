import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildReplay, delayFor, fmtOffset, FALLBACK_MS, MAX_MS, MIN_MS } from './replay'
import type { Part } from '../types'

const st = (id: string, at?: number): Part => ({ k: 'step', id, text: id, at })

test('buildReplay: пустой текст отбрасывается, смещения считаются от первого события', () => {
  const ev = buildReplay([st('a', 1000), { k: 'text', id: 't', text: '  ' }, st('b', 3500)])
  assert.equal(ev.length, 2)
  assert.deepEqual(
    ev.map((e) => e.at),
    [0, 2500],
  )
})
test('buildReplay: у старых сообщений времени нет', () => {
  assert.deepEqual(
    buildReplay([st('a'), st('b')]).map((e) => e.at),
    [null, null],
  )
})
test('delayFor: ужимает паузы и делит на скорость', () => {
  const ev = buildReplay([st('a', 1000), st('b', 1100), st('c', 61000), st('d')])
  assert.equal(delayFor(ev, 1, 1), MIN_MS)
  assert.equal(delayFor(ev, 2, 1), MAX_MS)
  assert.equal(delayFor(ev, 2, 2), MAX_MS / 2)
  assert.equal(delayFor(ev, 3, 1), FALLBACK_MS)
  assert.equal(delayFor(ev, 0, 4), Math.round(FALLBACK_MS / 4))
})
test('fmtOffset', () => {
  assert.equal(fmtOffset(null), '')
  assert.equal(fmtOffset(2500), '+2.5 c')
  assert.equal(fmtOffset(75000), '+1:15')
})
