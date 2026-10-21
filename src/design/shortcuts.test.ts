import { test } from 'node:test'
import assert from 'node:assert/strict'
import { designShortcutAllowed } from './shortcuts'

const target = { closest: () => null } as unknown as HTMLElement
const scope = { contains: (node: Node | null) => node === target }
const event = { target, defaultPrevented: false, isComposing: false }

test('design shortcuts are allowed only within their own active surface', () => {
  assert.equal(designShortcutAllowed(event, scope, false), true)
  assert.equal(designShortcutAllowed(event, null, false), false)
  assert.equal(designShortcutAllowed(event, { contains: () => false }, false), false)
})
test('modal, palette, menu, consumed events and IME always block design mutations', () => {
  assert.equal(designShortcutAllowed(event, scope, true), false)
  assert.equal(designShortcutAllowed({ ...event, defaultPrevented: true }, scope, false), false)
  assert.equal(designShortcutAllowed({ ...event, isComposing: true }, scope, false), false)
})
test('inputs and controls are not interpreted as canvas edit shortcuts', () => {
  let selector = ''
  const control = {
    closest: (s: string) => {
      selector = s
      return {}
    },
  } as unknown as HTMLElement
  assert.equal(designShortcutAllowed({ ...event, target: control }, { contains: () => true }, false), false)
  for (const part of ['input', 'textarea', 'select', 'contenteditable', 'button', 'menuitem', 'tab'])
    assert.ok(selector.includes(part))
})
