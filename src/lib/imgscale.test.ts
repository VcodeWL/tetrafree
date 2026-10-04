import test from 'node:test'
import assert from 'node:assert/strict'
import { fitSize, isImageFile } from './imgscale'

test('fitSize: большая сжимается пропорционально, маленькая не растёт', () => {
  assert.deepEqual(fitSize(2800, 1400), { w: 1400, h: 700 })
  assert.deepEqual(fitSize(700, 3500, 1000), { w: 200, h: 1000 })
  assert.deepEqual(fitSize(300, 200), { w: 300, h: 200 })
  assert.deepEqual(fitSize(0, 0), { w: 1, h: 1 })
})
test('isImageFile: svg и не-картинки отсекаются (svg может нести скрипты)', () => {
  assert.ok(isImageFile({ type: 'image/png' }) && isImageFile({ type: 'image/jpeg' }))
  assert.ok(!isImageFile({ type: 'image/svg+xml' }) && !isImageFile({ type: 'text/plain' }))
})
