import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { KeyboardEvent as ReactKey } from 'react'
import { MenuItem } from './Menu'

test('menu items activate with Enter and Space and consume the key', () => {
  let calls = 0
  const item = MenuItem({ label: 'Открыть', onClick: () => calls++ })
  for (const key of ['Enter', ' ']) {
    let prevented = false,
      stopped = false
    item.props.onKeyDown({
      key,
      preventDefault: () => {
        prevented = true
      },
      stopPropagation: () => {
        stopped = true
      },
    } as unknown as ReactKey<HTMLDivElement>)
    assert.equal(prevented, true)
    assert.equal(stopped, true)
  }
  assert.equal(calls, 2)
})

test('disabled menu items never activate with mouse, Enter or Space', () => {
  let calls = 0
  const item = MenuItem({ label: 'Недоступно', disabled: true, onClick: () => calls++ })
  item.props.onClick()
  for (const key of ['Enter', ' '])
    item.props.onKeyDown({
      key,
      preventDefault() {},
      stopPropagation() {},
    } as unknown as ReactKey<HTMLDivElement>)
  assert.equal(calls, 0)
  assert.equal(item.props['aria-disabled'], true)
})
