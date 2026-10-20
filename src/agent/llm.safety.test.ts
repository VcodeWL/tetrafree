import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { tokenLimit } from './tokenLimit'
import type { Provider } from '../types'
function fixture(blocked = false) {
  const requests: Record<string, unknown>[] = []
  const source = fs.readFileSync(new URL('./llm.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const mod = { exports: {} }
  const require = (id: string) =>
    id === './tokenLimit'
      ? { tokenLimit }
      : id === '../lib/vault'
        ? { vaultStartupBlocked: () => blocked }
        : {
            backendFetch: async (_url: string, init: RequestInit) => {
              requests.push(JSON.parse(String(init.body || '{}')))
              return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
                headers: { 'content-type': 'application/json' },
              })
            },
          }
  new Function('require', 'module', 'exports', js)(require, mod, mod.exports)
  return { ...(mod.exports as typeof import('./llm')), requests }
}
const provider: Provider = {
  id: 'p',
  kind: 'openai',
  name: 'Synthetic',
  baseUrl: 'https://invalid.example/v1',
  apiKey: 'synthetic',
  models: [],
  on: true,
}
const options = {
  provider,
  model: 'gpt-5',
  system: '',
  messages: [],
  signal: new AbortController().signal,
  onDelta: () => {},
  maxTokens: 16000,
}
test('blocked vault prevents chat and model listing before credentials leave process', async () => {
  const f = fixture(true)
  await assert.rejects(f.streamChat(options), /хранилищ/)
  await assert.rejects(f.listModels(provider), /хранилищ/)
  assert.equal(f.requests.length, 0)
})
test('compatible request uses actual output cap, including official reasoning naming', async () => {
  const f = fixture()
  await f.streamChat(options)
  assert.equal(f.requests[0].max_completion_tokens, 16000)
  assert.equal(f.requests[0].max_tokens, undefined)
  await f.streamChat({ ...options, provider: { ...provider, kind: 'custom' } })
  assert.equal(f.requests[1].max_tokens, 16000)
})
test('invalid cap rejects before provider dispatch', async () => {
  const f = fixture()
  await assert.rejects(f.streamChat({ ...options, maxTokens: NaN }))
  assert.equal(f.requests.length, 0)
})
