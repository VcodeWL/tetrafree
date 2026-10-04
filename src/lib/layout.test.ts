import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseLayout, dockMax, SIDE, DOCK } from './layout'

test('parseLayout: пусто и мусор → значения по умолчанию', () => {
  assert.deepEqual(parseLayout(null), { sideW: SIDE.def, dockH: DOCK.def, minimap: true })
  assert.deepEqual(parseLayout('{не json'), { sideW: SIDE.def, dockH: DOCK.def, minimap: true })
  assert.deepEqual(parseLayout('{"sideW":"x","dockH":null}'), {
    sideW: SIDE.def,
    dockH: DOCK.def,
    minimap: true,
  })
})
test('parseLayout: значения приводятся к границам', () => {
  assert.deepEqual(parseLayout('{"sideW":9999,"dockH":1}'), {
    sideW: SIDE.max,
    dockH: DOCK.min,
    minimap: true,
  })
  assert.deepEqual(parseLayout('{"sideW":300.4,"dockH":300}'), { sideW: 300, dockH: 300, minimap: true })
})
test('dockMax: 70% окна, но в пределах', () => {
  assert.equal(dockMax(1000), 640)
  assert.equal(dockMax(600), 420)
  assert.equal(dockMax(100), DOCK.min)
})
test('parseLayout: мини-карту можно выключить', () => {
  assert.equal(parseLayout('{"minimap":false}').minimap, false)
})
