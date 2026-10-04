import test from 'node:test'
import assert from 'node:assert/strict'
import { qrMatrix } from './qr.ts'

test('QR: размер растёт с длиной, результат детерминирован', () => {
  assert.equal(qrMatrix('Hello').length, 21)
  assert.equal(qrMatrix('x'.repeat(95)).length, 41)
  assert.deepEqual(qrMatrix('abc'), qrMatrix('abc'))
})
test('QR: служебные паттерны на месте (угловые finder-ы, таймлайн)', () => {
  const m = qrMatrix('otpauth://totp/x')
  const n = m.length
  assert.ok(m[0][0] && m[0][6] && m[6][0] && m[6][6] && !m[1][1] && m[2][2])
  assert.ok(m[0][n - 1] && m[n - 1][0])
  for (let i = 8; i < n - 8; i++) assert.equal(m[6][i], i % 2 === 0)
})
test('QR: слишком длинный текст — понятная ошибка', () => {
  assert.throws(() => qrMatrix('x'.repeat(400)), /слишком длинный/i)
})
