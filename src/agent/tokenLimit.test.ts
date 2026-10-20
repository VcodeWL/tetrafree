import test from 'node:test'
import assert from 'node:assert/strict'
import { tokenLimit } from './tokenLimit'
test('automatic output cap is serialized for Anthropic and compatible endpoints', () => {
  for (const kind of ['anthropic', 'custom', 'ollama', 'openai'] as const)
    assert.deepEqual(tokenLimit(kind, 'standard', 16000), { max_tokens: 16000 })
})
test('OpenAI reasoning family uses completion cap, generic custom provider keeps compatible field', () => {
  for (const model of ['o1', 'o3-mini', 'o4-mini', 'gpt-5', 'gpt-5.1', 'gpt-5-mini'])
    assert.deepEqual(tokenLimit('openai', model, 16000), { max_completion_tokens: 16000 })
  assert.deepEqual(tokenLimit('custom', 'gpt-5', 1200), { max_tokens: 1200 })
  assert.deepEqual(tokenLimit('openai', 'gpt-4o', 1200), { max_tokens: 1200 })
})
test('undefined retains existing defaults; invalid budget caps fail before dispatch', () => {
  assert.deepEqual(tokenLimit('anthropic', 'claude'), { max_tokens: 16000 })
  assert.deepEqual(tokenLimit('openai', 'gpt-4o'), {})
  for (const n of [0, -1, 1.5, NaN, Infinity, 1_000_001])
    assert.throws(() => tokenLimit('custom', 'x', n), /лимит/)
})
