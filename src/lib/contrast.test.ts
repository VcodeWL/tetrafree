/* Контраст текстовых токенов темы (WCAG AA, 4.5:1) считается прямо по app.css — случайно «посерить» текст не выйдет */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8')
const block = (start: string) => {
  const i = css.indexOf(start)
  return css.slice(i, css.indexOf('}', i))
}
const tok = (b: string, name: string) => new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, 'i').exec(b)![1]
const lum = (hex: string) => {
  const c = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

for (const [name, start] of [
  ['тёмная', ':root {'],
  ['светлая', 'html.light {'],
] as const) {
  test(`контраст текста t1–t4 на фоне и поверхности: ${name} тема ≥ 4.5`, () => {
    const b = block(start)
    for (const t of ['t1', 't2', 't3', 't4'])
      for (const bg of ['bg', 'surface']) {
        const r = ratio(tok(b, t), tok(b, bg))
        assert.ok(r >= 4.5, `--${t} на --${bg}: ${r.toFixed(2)}`)
      }
  })
}
