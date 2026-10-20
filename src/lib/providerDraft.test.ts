import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProviderDraft } from './providerDraft'
import type { Provider } from '../types'
const p: Provider = {
  id: 'p',
  name: 'Fixture',
  kind: 'custom',
  baseUrl: 'https://invalid.example',
  apiKey: 'synthetic-old',
  models: [],
  on: true,
}
test('unchanged provider or fresh creation allowed', () => {
  assert.doesNotThrow(() => assertProviderDraft({ ...p }, p))
  assert.doesNotThrow(() => assertProviderDraft(undefined, null))
})
test('clear, replacement, deletion or ID collision cannot be undone by stale modal', () => {
  for (const next of [{ ...p, apiKey: '' }, { ...p, apiKey: 'synthetic-new' }, undefined])
    assert.throws(() => assertProviderDraft(next, p))
  assert.throws(() => assertProviderDraft(p, null))
})
