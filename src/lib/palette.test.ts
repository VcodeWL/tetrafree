import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
function fixture() {
  const listeners = new Map<string, Set<(e: { detail: unknown }) => void>>()
  let opened = 0
  const window = {
    addEventListener: (k: string, f: (e: { detail: unknown }) => void) => {
      if (!listeners.has(k)) listeners.set(k, new Set())
      listeners.get(k)!.add(f)
    },
    removeEventListener: (k: string, f: (e: { detail: unknown }) => void) => listeners.get(k)?.delete(f),
    dispatchEvent: (e: { type: string; detail: unknown }) => {
      for (const f of listeners.get(e.type) || []) f(e)
    },
  }
  const src = fs.readFileSync(new URL('./palette.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const mod = { exports: {} }
  class Event {
    constructor(
      public type: string,
      public detailObj: { detail: unknown },
    ) {}
    get detail() {
      return this.detailObj.detail
    }
  }
  new Function('require', 'module', 'exports', 'window', 'CustomEvent', js)(
    () => ({
      useStore: {
        getState: () => ({
          setPalette: () => {
            opened++
          },
        }),
      },
    }),
    mod,
    mod.exports,
    window,
    Event,
  )
  return {
    ...(mod.exports as {
      openPalette: (p?: string) => void
      palettePrefix: () => string
      startPaletteBridge: () => () => void
    }),
    window,
    opened: () => opened,
  }
}
test('first palette request survives asynchronous chunk loading without relying on a mounted listener', () => {
  const f = fixture()
  f.openPalette('/')
  assert.equal(f.opened(), 1)
  assert.equal(f.palettePrefix(), '/')
})
test('legacy request bridge opens lazy palette, keeps prefix and is cleaned up', () => {
  const f = fixture(),
    off = f.startPaletteBridge()
  f.window.dispatchEvent({ type: 'tf:palette', detail: '>tasks' })
  assert.equal(f.opened(), 1)
  assert.equal(f.palettePrefix(), '>tasks')
  off()
  f.window.dispatchEvent({ type: 'tf:palette', detail: 'ignored' })
  assert.equal(f.opened(), 1)
})
test('request values are bounded and new explicit request replaces old prefix', () => {
  const f = fixture()
  f.openPalette('x'.repeat(5000))
  assert.equal(f.palettePrefix().length, 2000)
  f.openPalette('')
  assert.equal(f.palettePrefix(), '')
})
