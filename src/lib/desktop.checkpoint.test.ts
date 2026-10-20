import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

function fixture(flush: () => Promise<void>) {
  const events: string[] = []
  const imports: Record<string, unknown> = {
    '../store/persistence': { flushPersistence: flush },
    '../store': { useStore: { getState: () => ({ toast: () => events.push('warning') }) } },
    '@tauri-apps/api/window': { getCurrentWindow: () => ({ close: () => events.push('close') }) },
    '@tauri-apps/api/core': { invoke: async (name: string) => events.push(name) },
  }
  const source = readFileSync(new URL('./desktop.ts', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const mod = { exports: {} as { winClose: () => Promise<void>; updInstall: () => Promise<void> } }
  new Function('require', 'module', 'exports', 'window', code)(
    (name: string) => {
      assert.ok(name in imports, name)
      return imports[name]
    },
    mod,
    mod.exports,
    { __TAURI_INTERNALS__: {} },
  )
  return { ...mod.exports, events }
}

test('explicit desktop close waits for checkpoint before requesting native close', async () => {
  let done!: () => void
  const f = fixture(
    () =>
      new Promise<void>((r) => {
        done = r
      }),
  )
  const closing = f.winClose()
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(f.events, [])
  done()
  await closing
  assert.deepEqual(f.events, ['close'])
})
test('failed checkpoint keeps desktop window open with visible warning', async () => {
  const f = fixture(async () => {
    throw Error('synthetic quota')
  })
  await f.winClose()
  assert.deepEqual(f.events, ['warning'])
})
test('updater cannot start before successful checkpoint', async () => {
  let done!: () => void
  const f = fixture(
    () =>
      new Promise<void>((r) => {
        done = r
      }),
  )
  const install = f.updInstall()
  await new Promise((r) => setImmediate(r))
  assert.deepEqual(f.events, [])
  done()
  await install
  assert.deepEqual(f.events, ['update_install'])
})
test('failed checkpoint prevents update install', async () => {
  const f = fixture(async () => {
    throw Error('synthetic quota')
  })
  await assert.rejects(f.updInstall(), /synthetic quota/)
  assert.deepEqual(f.events, [])
})
