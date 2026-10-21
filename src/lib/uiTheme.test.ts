import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ActionButton } from '../components/ui/ActionButton'
import { GradientRibbon } from '../components/ui/GradientRibbon'

const css = readFileSync(new URL('../styles/app.css', import.meta.url), 'utf8')
const source = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8')
const block = (selector: string, last = false) => {
  const i = last ? css.lastIndexOf(selector) : css.indexOf(selector)
  assert.ok(i >= 0, selector)
  return css.slice(i, css.indexOf('}', i))
}
const token = (b: string, name: string) => {
  const match = new RegExp(`--${name}:\\s*(#[a-f0-9]{6})`, 'i').exec(b)
  assert.ok(match, name)
  return match[1]
}
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
const lum = (values: number[]) => {
  const c = values.map((v) => {
    const x = v / 255
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}
const ratio = (a: number[], b: number[]) => {
  const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m)
  return (x + 0.05) / (y + 0.05)
}

for (const [name, selector] of [
  ['dark', 'html {'],
  ['light', 'html.light {'],
] as const) {
  test(`gradient button text has AA contrast across both interpolated segments: ${name}`, () => {
    const b = block(selector, true)
    const stops = ['ui-mist', 'ui-lilac', 'ui-violet'].map((t) => rgb(token(b, t)))
    const ink = rgb(token(b, 'ui-ink'))
    for (let segment = 0; segment < 2; segment++)
      for (let step = 0; step <= 100; step++) {
        const color = stops[segment].map((v, i) => v + ((stops[segment + 1][i] - v) * step) / 100)
        assert.ok(ratio(ink, color) >= 4.5, `${name}: segment ${segment}, step ${step}`)
      }
  })
}

test('shared action button preserves disabled, type, label and dangerous tone', () => {
  const html = renderToStaticMarkup(
    createElement(ActionButton, {
      variant: 'danger',
      size: 'small',
      disabled: true,
      'aria-label': 'Остановить',
      children: 'Стоп',
    }),
  )
  assert.match(html, /type="button"/)
  assert.match(html, /class="btn danger sm"/)
  assert.match(html, /disabled=""/)
  assert.match(html, /aria-label="Остановить"/)
  assert.doesNotMatch(html, /\bpri\b/)
  const submit = renderToStaticMarkup(
    createElement(ActionButton, { type: 'submit', variant: 'primary', children: 'Далее' }),
  )
  assert.match(submit, /type="submit"/)
  assert.match(submit, /class="btn pri"/)
})

test('ambient preserves the original decorative image without pointer listeners or particles', () => {
  const src = source('../components/Ambient.tsx')
  assert.match(src, /import bg from '\.\.\/assets\/bg\.jpg'/)
  assert.match(src, /<img src=\{bg\} alt="" draggable=\{false\}/)
  assert.match(src, /aria-hidden="true"/)
  assert.doesNotMatch(src, /addEventListener|requestAnimationFrame|setInterval|bg-sparks/)
  assert.match(block('html .bg-img img {', true), /saturate\(0\.3\)/)
})

test('motion uses OS preference unless the user explicitly requests reduced motion', () => {
  const app = source('../App.tsx')
  assert.match(app, /reducedMotion=\{settings\.reducedMotion \? 'always' : 'user'\}/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(css, /html\.reduced :is\(/)
  assert.match(block('html .comp-box::before {', true), /display: none/)
})

test('calm, accent-free and ambient-off modes remain independently available', () => {
  assert.match(block('html #bg,\nhtml.light #bg {'), /background: var\(--bg\)/)
  assert.match(block('html.no-accents {', true), /--ui-mist: var\(--t2\)/)
  assert.match(block('html.no-accents #bg {', true), /background: var\(--bg\)/)
  assert.match(block('html.no-ambient #bg {', true), /display: none/)
})

test('decorative ribbon has no progress semantics and honours motion and visibility settings', () => {
  const html = renderToStaticMarkup(createElement(GradientRibbon))
  assert.match(html, /aria-hidden="true"/)
  assert.doesNotMatch(html, /role=|aria-valuenow|progress/)
  const src = source('../components/ui/GradientRibbon.tsx')
  assert.match(src, /document.hidden/)
  assert.match(src, /removeEventListener/)
  assert.doesNotMatch(src, /requestAnimationFrame|setInterval|setTimeout/)
  assert.match(css, /ribbon-flow 12s linear infinite/)
  assert.match(css, /background-size: 50% 100%/)
  assert.match(block('html.reduced .ui-ribbon i {'), /animation: none !important/)
  assert.match(block('html.no-accents .ui-ribbon {'), /display: none/)
})

test('code pane toggle exposes its current action rather than a stale generated label', () => {
  const src = source('../workspace/ChatView.tsx')
  assert.match(src, /aria-label=\{rightOpen \? 'Скрыть панель кода' : 'Показать панель кода'\}/)
  assert.match(src, /aria-expanded=\{rightOpen\}/)
})

test('generated project mark is bundled and preserves non-default project icons', () => {
  const manifest = JSON.parse(source('../../binary-assets/manifest.json')) as Record<string, string>
  assert.equal(manifest['src/assets/project-mark.png'], 'project-mark.png')
  const bytes = Buffer.from(source('../../binary-assets/project-mark.png.b64').replace(/\s/g, ''), 'base64')
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG')
  assert.equal(bytes.readUInt32BE(16), 128)
  assert.equal(bytes.readUInt32BE(20), 128)
  const src = source('../components/ui/ProjectIcon.tsx')
  assert.match(src, /name === 'sparkle'/)
  assert.match(src, /<Icon name=\{name\} size=\{size\}/)
  assert.match(src, /alt=""/)
})
