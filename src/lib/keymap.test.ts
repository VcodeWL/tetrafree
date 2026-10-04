import test from 'node:test'
import assert from 'node:assert/strict'
import { comboOf, actionFor, effective, check, keyOf, parts } from './keymap'

const ev = (
  code: string,
  o: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {},
) => ({ code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...o })

test('сочетание берётся из e.code (не зависит от раскладки)', () => {
  assert.equal(comboOf(ev('KeyK', { ctrlKey: true })), 'Mod+K')
  assert.equal(comboOf(ev('KeyY', { metaKey: true, shiftKey: true })), 'Mod+Shift+Y')
  assert.equal(comboOf(ev('Backquote', { ctrlKey: true })), 'Mod+`')
  assert.equal(comboOf(ev('ControlLeft', { ctrlKey: true })), null)
  assert.equal(keyOf('Digit5'), '5')
})
test('действие по умолчанию и по переназначению', () => {
  assert.equal(actionFor(ev('KeyK', { ctrlKey: true }), effective())?.id, 'palette')
  const m = effective({ today: 'Mod+Alt+T' })
  assert.equal(actionFor(ev('KeyT', { ctrlKey: true, altKey: true }), m)?.id, 'today')
  assert.equal(actionFor(ev('KeyY', { ctrlKey: true, shiftKey: true }), m), null)
})
test('проверка назначения', () => {
  const m = effective()
  assert.match(check(m, 'today', 'Mod+K')!, /Палитра/)
  assert.match(check(m, 'today', 'Mod+C')!, /занято/)
  assert.match(check(m, 'today', 'Shift+Q')!, /Ctrl/)
  assert.equal(check(m, 'today', 'Mod+Shift+Y'), null)
  assert.equal(check(m, 'today', 'Mod+Alt+Y'), null)
})
test('parts', () => assert.deepEqual(parts('Mod+Shift+Y', 'Ctrl'), ['Ctrl', 'Shift', 'Y']))
