import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import { create } from 'zustand'
function fixture() {
  let token: string | null = 'token-a'
  let tokenRevision = 0
  const backend = create(() => ({ base: 'http://a', status: 'online' }))
  let syncs = 0
  const root = {
    authed: false,
    settings: {},
    people: { me: { name: 'A', email: 'a' } },
    signIn: () => {},
    signOut: () => {},
    toast: () => {},
  }
  const src = fs.readFileSync(new URL('./account.ts', import.meta.url), 'utf8')
  const js = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const mod = { exports: {} }
  const user = { id: 'a', name: 'A', email: 'a', hue: 1 }
  let me: () => Promise<unknown> = async () => ({ user })
  const fetch = async (url: string) => ({
    ok: true,
    status: 200,
    json: async () =>
      url.endsWith('/me') ? await me() : url.endsWith('/config') ? { hasUsers: true } : { invites: [] },
  })
  const require = (id: string) =>
    id === 'zustand'
      ? { create }
      : id === './backend'
        ? { useBackend: backend, serverOnline: () => true }
        : id === './token'
          ? {
              getToken: () => token,
              getTokenRevision: () => tokenRevision,
              setToken: (v: string | null) => {
                if (token !== v) tokenRevision++
                token = v
              },
              authHeader: () => ({}),
            }
          : id === '../store'
            ? { useStore: { getState: () => root } }
            : id === './sync'
              ? {
                  resyncNow: async () => {
                    syncs++
                  },
                }
              : {}
  new Function('require', 'module', 'exports', 'fetch', js)(require, mod, mod.exports, fetch)
  const api = mod.exports as {
    setAccountRecoveryMode: (on: boolean) => void
    confirmedAccountId: () => string | null
    verifySession: () => Promise<void>
    logout: () => Promise<void>
    captureSession: () => unknown
    applySession: (r: unknown, c?: unknown) => void
    useAccount: ReturnType<typeof create>
  }
  return {
    api,
    backend,
    user,
    syncs: () => syncs,
    setToken: (v: string) => {
      if (token !== v) tokenRevision++
      token = v
    },
    deferMe: (fn: () => Promise<unknown>) => {
      me = fn
    },
  }
}
test('identity requires verified exact backend/token, never just user state', async () => {
  const f = fixture()
  assert.equal(f.api.confirmedAccountId(), null)
  await f.api.verifySession()
  assert.equal(f.api.confirmedAccountId(), 'a')
  f.setToken('rotated')
  assert.equal(f.api.confirmedAccountId(), null)
  await f.api.verifySession()
  assert.equal(f.api.confirmedAccountId(), 'a')
  f.backend.setState({ base: 'http://b' })
  assert.equal(f.api.confirmedAccountId(), null)
  assert.equal((f.api.useAccount.getState() as { user: unknown }).user, null)
})
test('late verification cannot authenticate a different server', async () => {
  const f = fixture()
  let resolve!: (v: unknown) => void
  f.deferMe(
    () =>
      new Promise((r) => {
        resolve = r
      }),
  )
  const pending = f.api.verifySession()
  while (!resolve) await new Promise((r) => setTimeout(r, 0))
  f.backend.setState({ base: 'http://b' })
  resolve({ user: f.user })
  await pending
  assert.equal(f.api.confirmedAccountId(), null)
})
test('login proof precedes account subscribers and logout clears proof', async () => {
  const f = fixture()
  let seen: string | null = null
  f.api.useAccount.subscribe(() => {
    seen = f.api.confirmedAccountId()
  })
  f.api.applySession({ token: 'new', user: f.user })
  assert.equal(seen, 'a')
  await f.api.logout()
  assert.equal(f.api.confirmedAccountId(), null)
})

test('recovery sign-in proves identity without starting disk sync before boot gate', () => {
  const f = fixture()
  f.api.setAccountRecoveryMode(true)
  f.api.applySession({ token: 'new', user: f.user })
  assert.equal(f.api.confirmedAccountId(), 'a')
  assert.equal(f.syncs(), 0)
  f.api.setAccountRecoveryMode(false)
  f.api.applySession({ token: 'again', user: f.user })
  assert.equal(f.syncs(), 1)
})
