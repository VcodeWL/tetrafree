import test from 'node:test'
import assert from 'node:assert/strict'
import { MAX_TABS, addTab, closeTab, initialTabs, pickTab, sanitize, sessionKey } from './termtabs'

test('новая вкладка становится активной, номера не повторяются после закрытия', () => {
  let s = addTab(initialTabs())
  assert.equal(s.active, 't2')
  s = closeTab(s, 't2')!
  s = addTab(s)
  assert.equal(s.active, 't3')
  assert.deepEqual(
    s.tabs.map((t) => t.n),
    [1, 3],
  )
})
test('лимит вкладок', () => {
  let s = initialTabs()
  for (let i = 0; i < 10; i++) s = addTab(s)
  assert.equal(s.tabs.length, MAX_TABS)
})
test('закрытие активной выбирает соседнюю; последнюю закрыть нельзя', () => {
  let s = addTab(addTab(initialTabs()))
  s = pickTab(s, 't2')
  const c = closeTab(s, 't2')!
  assert.equal(c.active, 't3')
  assert.equal(closeTab(initialTabs(), 't1'), null)
})
test('pickTab игнорирует чужой id', () => {
  const s = initialTabs()
  assert.equal(pickTab(s, 'zzz'), s)
})
test('ключ сеанса первой вкладки совместим со старым (id проекта)', () => {
  assert.equal(sessionKey('p1', 't1'), 'p1')
  assert.equal(sessionKey('p1', 't4'), 'p1#t4')
})
test('sanitize чинит мусор из localStorage', () => {
  assert.equal(sanitize(null).tabs.length, 1)
  assert.equal(sanitize({ tabs: [{ id: '<script>', n: 1 }] }).tabs[0].id, 't1')
  const s = sanitize({ tabs: [{ id: 't2', n: 2 }], active: 'нет', seq: 0 })
  assert.equal(s.active, 't2')
  assert.equal(s.seq, 2)
})
