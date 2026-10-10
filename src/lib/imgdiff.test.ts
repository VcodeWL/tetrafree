import { test } from 'node:test'
import assert from 'node:assert/strict'
import { diffRasters, pct, type Raster } from './imgdiff'

const solid = (w: number, h: number, c: [number, number, number]): Raster => {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) data.set([c[0], c[1], c[2], 255], i * 4)
  return { w, h, data }
}
const paint = (r: Raster, x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) => {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) r.data.set([c[0], c[1], c[2], 255], (y * r.w + x) * 4)
}

test('одинаковые картинки: 100%, различий нет', () => {
  const a = solid(30, 50, [10, 20, 30])
  const d = diffRasters(a, solid(30, 50, [10, 20, 30]))
  assert.equal(d.score, 1)
  assert.equal(d.regions.length, 0)
})

test('мелкий шум не считается отличием', () => {
  assert.equal(diffRasters(solid(10, 10, [100, 100, 100]), solid(10, 10, [110, 105, 100])).score, 1)
})

test('закрашенный квадрат: доля и область найдены', () => {
  const a = solid(30, 50, [255, 255, 255])
  const b = solid(30, 50, [255, 255, 255])
  paint(b, 0, 0, 10, 10, [0, 0, 0]) /* верхний левый угол: 100 из 1500 px */
  const d = diffRasters(a, b)
  assert.ok(Math.abs(d.score - (1 - 100 / 1500)) < 1e-9)
  assert.equal(d.regions[0].name, 'самый верх, слева')
  assert.equal(d.regions[0].diff, 1)
  assert.equal(d.heat[0], 255) /* красный в отличающемся пикселе */
})

test('разные размеры и формат процентов', () => {
  assert.throws(() => diffRasters(solid(2, 2, [0, 0, 0]), solid(3, 2, [0, 0, 0])))
  assert.equal(pct(0.9734), '97,3%')
  assert.equal(pct(1), '100%')
})
