import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
function fixture(desktop: boolean) {
  let enabled = false,
    hidden = true,
    native = 0,
    browser = 0,
    opted = false
  const js = ts.transpileModule(fs.readFileSync(new URL('./osnotify.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const mod = { exports: {} }
  const require = (id: string) =>
    id === '../store'
      ? { useStore: { getState: () => ({ settings: { osNotify: enabled } }) } }
      : {
          isDesktop: desktop,
          notifyDesktop: async () => {
            native++
          },
          sysSetNotifications: async () => {
            opted = true
          },
        }
  class Notification {
    static permission = 'granted'
    onclick: unknown
    constructor() {
      browser++
    }
    close() {}
  }
  new Function('require', 'module', 'exports', 'document', 'Notification', 'setTimeout', js)(
    require,
    mod,
    mod.exports,
    {
      get hidden() {
        return hidden
      },
      hasFocus: () => !hidden,
    },
    Notification,
    () => 0,
  )
  return {
    ...(mod.exports as { osNotify: (t: string, b: string) => void; enableOsNotify: () => Promise<string> }),
    enable: () => {
      enabled = true
    },
    focus: () => {
      hidden = false
    },
    counts: () => ({ native, browser, opted }),
  }
}
test('desktop notification is opt-in, unfocused, native only and does not expose message payload', async () => {
  const f = fixture(true)
  f.osNotify('private', 'private')
  assert.equal(f.counts().native, 0)
  assert.equal(await f.enableOsNotify(), 'granted')
  f.enable()
  f.osNotify('private', 'private')
  assert.deepEqual(f.counts(), { native: 1, browser: 0, opted: true })
  f.focus()
  f.osNotify('private', 'private')
  assert.equal(f.counts().native, 1)
})
test('browser path remains browser only and respects app preference', () => {
  const f = fixture(false)
  f.osNotify('done', 'details')
  assert.equal(f.counts().browser, 0)
  f.enable()
  f.osNotify('done', 'details')
  assert.deepEqual(f.counts(), { native: 0, browser: 1, opted: false })
})
