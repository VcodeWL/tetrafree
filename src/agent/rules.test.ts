import { test } from 'node:test'
import assert from 'node:assert/strict'
import { projectRules } from './rules'

test('нет файлов — пусто', () => {
  assert.equal(projectRules({}), '')
  assert.equal(projectRules({ 'AGENTS.md': '  ' }), '')
})
test('правила TetraFree и AGENTS.md подписываются именами файлов', () => {
  const r = projectRules({ '.tetra/rules.md': 'не трогай db', 'AGENTS.md': 'стек: react' })
  assert.match(r, /--- \.tetra\/rules\.md ---\nне трогай db/)
  assert.match(r, /--- AGENTS\.md ---\nстек: react/)
})
test('CLAUDE.md из одной ссылки на AGENTS.md не дублируется', () => {
  const r = projectRules({ 'AGENTS.md': 'A', 'CLAUDE.md': '@AGENTS.md' })
  assert.doesNotMatch(r, /CLAUDE\.md/)
})
test('CLAUDE.md сам по себе читается', () => {
  assert.match(projectRules({ 'CLAUDE.md': 'правила' }), /--- CLAUDE\.md ---\nправила/)
})
test('длинное обрезается с пометкой', () => {
  const r = projectRules({ 'AGENTS.md': 'x'.repeat(9000) })
  assert.match(r, /…\(обрезано\)/)
  assert.ok(r.length < 6200)
})
