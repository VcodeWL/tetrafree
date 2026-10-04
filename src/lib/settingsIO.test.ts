import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitize, parse, build } from './settingsIO'
import type { Settings } from '../types'

test('sanitize отбрасывает чужое и неверное', () => {
  const r = sanitize({
    theme: 'light',
    density: 'huge',
    codeSize: 14,
    backendUrl: 'http://evil',
    apiKey: 'sk-1',
    accents: 'yes',
    ambient: false,
    uiFont: 'arial',
    codeFont: 'nope',
    budget: -5,
  })
  assert.deepEqual(r, { theme: 'light', codeSize: 14, ambient: false, uiFont: 'arial' })
})
test('горячие клавиши проверяются', () => {
  const r = sanitize({
    keys: { today: 'Mod+Alt+T', palette: 'Mod+C', fake: 'Mod+Alt+Q', files: 'Mod+K', git: 'Shift+Q' },
  })
  assert.deepEqual(r.keys, { today: 'Mod+Alt+T' })
})
test('цены', () =>
  assert.deepEqual(
    sanitize({ priceCustom: { m1: { inp: 1, out: 2 }, bad: { inp: 'x', out: 1 } } }).priceCustom,
    { m1: { inp: 1, out: 2 } },
  ))
test('build не содержит ключей и адреса сервера', () => {
  const j = build({
    theme: 'dark',
    backendUrl: 'http://127.0.0.1:3001',
    seenVersion: '1.0.0',
    accents: true,
  } as Settings)
  assert.equal(j.app, 'tetrafree-settings')
  assert.deepEqual(Object.keys(j.settings).sort(), ['accents', 'theme'])
})
test('parse: ошибки', () => {
  assert.throws(() => parse('{'), /JSON/)
  assert.throws(() => parse('{"app":"x"}'), /не файл настроек/)
  assert.throws(() => parse('{"app":"tetrafree-settings","settings":{"zzz":1}}'), /нет подходящих/)
  assert.equal(parse('{"app":"tetrafree-settings","settings":{"theme":"dark"}}').theme, 'dark')
})
