// Spawned by vaultOutbox.integration.test.ts; each invocation is a genuinely fresh module graph.
import fs from 'node:fs'
import assert from 'node:assert/strict'
const [dir, phase] = process.argv.slice(2)
class DiskStorage implements Storage {
  data: Record<string, string> = fs.existsSync(dir + '/ls.json')
    ? JSON.parse(fs.readFileSync(dir + '/ls.json', 'utf8'))
    : {}
  fail = false
  failCheckpoint = false
  get length() {
    return Object.keys(this.data).length
  }
  key(i: number) {
    return Object.keys(this.data)[i] ?? null
  }
  getItem(k: string) {
    return this.data[k] ?? null
  }
  setItem(k: string, v: string) {
    if (this.failCheckpoint && k === 'tetrafree') throw new Error('checkpoint quota')
    if (this.fail && k.startsWith('tf-vault-delete')) throw new Error('quota')
    this.data[k] = v
    fs.writeFileSync(dir + '/ls.json', JSON.stringify(this.data))
  }
  removeItem(k: string) {
    delete this.data[k]
    fs.writeFileSync(dir + '/ls.json', JSON.stringify(this.data))
  }
  clear() {
    this.data = {}
    fs.writeFileSync(dir + '/ls.json', '{}')
  }
}
const ls = new DiskStorage()
Object.defineProperty(globalThis, 'localStorage', { value: ls })
// Exercise the real app storage fallback and real registered root checkpoint (no fake flush).
const { useStore, hydrateStore } = await import('../store')
const { flushPersistence } = await import('../store/persistence')
const { useBackend } = await import('./backend')
const { setToken } = await import('./token')
const { useAccount, verifySession } = await import('./account')
const {
  startVault,
  isVaulted,
  prepareVaultRecovery,
  vaultStartupBlocked,
  vaultRecoveryState,
  subscribeVaultRecovery,
} = await import('./vault')
const { readVaultOutbox, VAULT_OUTBOX_KEY } = await import('./vaultOutbox')
const {
  vaultDurableScope,
  recordVaultKeyIntent,
  vaultIntentGeneration,
  acknowledgeVaultDelete,
  vaultClearIntent,
} = await import('./vaultState')
if (ls.getItem('tetrafree') === null) {
  const { initialPersisted } = await import('../store/defaults')
  const { PERSIST_VERSION } = await import('../store/persistence')
  ls.setItem(
    'tetrafree',
    JSON.stringify({ state: initialPersisted(), version: PERSIST_VERSION, revision: 1 }),
  )
  ls.setItem('tetrafree:authority', JSON.stringify({ backend: 'ls', revision: 1 }))
}
await hydrateStore()
const provider = {
  id: 'p',
  apiKey: 'OLD-SECRET',
  name: 'P',
  kind: 'custom',
  baseUrl: 'http://model.invalid',
  models: [],
  on: true,
} as const
const account = (id: string) => ({
  id,
  name: id,
  email: id + '@invalid.test',
  verified: true,
  twofa: false,
  createdAt: 0,
  hue: 0,
  providers: [],
  hasPassword: true,
})
let fakeAccount = 'account-A'
let authAvailable = phase !== 'startup-login'
let remote = 'OLD-SECRET'
let deletes = 0,
  sets = 0,
  gets = 0
const paths: string[] = []
let onGet: (() => void) | undefined
let releaseGet: (() => void) | undefined
let onDelete: (() => void) | undefined
let releaseDelete: (() => void) | undefined
const wait = async (check: () => boolean) => {
  for (let i = 0; i < 150; i++) {
    if (check()) return
    await new Promise((r) => setTimeout(r, 20))
  }
  throw new Error('condition timed out: ' + phase)
}
globalThis.fetch = async (input, init) => {
  const url = String(input)
  paths.push(url)
  if (url.endsWith('/api/auth/config'))
    return new Response(JSON.stringify({ mail: 'dev', oauth: [], hasUsers: true }))
  if (url.endsWith('/api/auth/me') && (phase === 'startup-unknown' || !authAvailable))
    return new Response('{}', { status: 503 })
  if (url.endsWith('/api/auth/me')) return new Response(JSON.stringify({ user: account(fakeAccount) }))
  if (url.endsWith('/api/invites')) return new Response(JSON.stringify({ invites: [] }))
  if (url.endsWith('/api/secrets')) {
    gets++
    if (phase === 'aba')
      await new Promise<void>((r) => {
        releaseGet = r
        onGet?.()
      })
    return new Response(
      JSON.stringify({
        mode: 'file',
        items: remote
          ? {
              p:
                fakeAccount === 'account-B' || url.startsWith('http://backend-B.invalid')
                  ? 'B-SECRET'
                  : remote,
            }
          : {},
      }),
    )
  }
  if (url.endsWith('/api/secrets/delete')) {
    deletes++
    if (['late-delete', 'late-account', 'late-backend'].includes(phase))
      await new Promise<void>((r) => {
        releaseDelete = r
        onDelete?.()
      })
    if (phase === 'failed-delete' || phase === 'reload-failed') return new Response('{}', { status: 503 })
    remote = ''
    if (phase === 'ack-quota') ls.fail = true
    return new Response('{}')
  }
  if (url.endsWith('/api/secrets/set')) {
    sets++
    if (phase === 'replacement-fail') return new Response('{}', { status: 503 })
    remote = JSON.parse(String(init?.body)).value
    return new Response('{}')
  }
  throw new Error('unexpected request ' + url)
}
setToken('TOKEN-ONE')
useAccount.setState({ user: account('account-A'), checked: true })
useBackend.setState({ base: 'http://backend-A.invalid', status: 'online', info: { local: true } as never })
if (!phase.startsWith('startup-')) await verifySession()
if (
  [
    'failed-delete',
    'stale-snapshot',
    'removed',
    'quota',
    'aba',
    'late-delete',
    'late-account',
    'late-backend',
    'anonymous',
    'corrupt',
    'ack-quota',
    'replacement-fail',
  ].includes(phase)
) {
  useStore.setState({ providers: [{ ...provider }] as never })
  await flushPersistence()
}
if (phase.startsWith('startup-')) {
  assert.equal(vaultStartupBlocked(), true)
  const snapshot = vaultRecoveryState()
  assert.equal(vaultRecoveryState(), snapshot)
  let released = false
  const unsubscribe = subscribeVaultRecovery(() => {
    if (!vaultStartupBlocked()) {
      released = true
      assert.equal(JSON.parse(ls.getItem('tetrafree')!).state.providers[0].apiKey, '')
    }
  })
  if (phase === 'startup-durability-fail') ls.failCheckpoint = true
  if (phase === 'startup-login') {
    await assert.rejects(prepareVaultRecovery())
    assert.equal(vaultStartupBlocked(), true)
    authAvailable = true
    await verifySession()
    // No explicit retry: confirmed-account notification must release the gate only after checkpoint.
    await wait(() => !vaultStartupBlocked())
    assert.equal(released, true)
    assert.equal(useStore.getState().providers[0].apiKey, '')
  } else if (phase === 'startup-unknown' || phase === 'startup-durability-fail') {
    await assert.rejects(prepareVaultRecovery())
    assert.equal(vaultStartupBlocked(), true)
    assert.ok(vaultRecoveryState().error)
    assert.equal(released, false)
    if (phase === 'startup-durability-fail') {
      await assert.rejects(prepareVaultRecovery())
      assert.equal(vaultStartupBlocked(), true)
      assert.equal(released, false)
    }
    assert.equal(JSON.parse(ls.getItem('tetrafree')!).state.providers[0].apiKey, 'OLD-SECRET')
  } else {
    await prepareVaultRecovery()
    assert.equal(vaultStartupBlocked(), false)
    assert.equal(useStore.getState().providers[0].apiKey, '')
    assert.equal(released, true)
  }
  if (phase === 'startup-token-only') {
    const cached = vaultRecoveryState()
    const accountBefore = useAccount.getState()
    let notifications = 0
    const offRecovery = subscribeVaultRecovery(() => {
      notifications++
    })
    const offAccount = useAccount.subscribe(() => {
      notifications++
    })
    assert.equal(cached.blocked, false)
    // Deliberately no verification/account publication between setToken and the guard.
    setToken('TOKEN-ONLY-ROTATED')
    assert.equal(useAccount.getState(), accountBefore)
    assert.equal(notifications, 0)
    assert.equal(vaultStartupBlocked(), true)
    assert.equal(vaultStartupBlocked(), true)
    assert.equal(vaultRecoveryState(), cached)
    assert.equal(notifications, 0) // pure getter: no React/store notifications or snapshot churn
    offAccount()
    offRecovery()
    await verifySession()
    await prepareVaultRecovery()
    assert.equal(vaultStartupBlocked(), false)
    const recovered = vaultRecoveryState()
    const raw = ls.getItem(VAULT_OUTBOX_KEY)!
    ls.setItem(VAULT_OUTBOX_KEY, '{bad')
    assert.equal(vaultStartupBlocked(), true)
    assert.equal(vaultRecoveryState(), recovered)
    ls.setItem(VAULT_OUTBOX_KEY, raw)
    assert.equal(vaultStartupBlocked(), false)
  }
  assert.equal(gets + sets + deletes, 0)
  unsubscribe()
} else if (phase === 'corrupt') {
  const raw = '{"version":99,"entries":[]}'
  ls.setItem(VAULT_OUTBOX_KEY, raw)
  assert.throws(() => useStore.getState().saveProvider({ ...useStore.getState().providers[0], apiKey: '' }))
  startVault()
  await wait(() => useStore.getState().toasts.some((t) => t.title === 'Хранилище ключей требует внимания'))
  assert.equal(ls.getItem(VAULT_OUTBOX_KEY), raw)
  assert.equal(useStore.getState().providers[0].apiKey, 'OLD-SECRET')
  assert.equal(gets + deletes + sets, 0)
} else if (phase === 'ack-quota') {
  useStore.getState().saveProvider({ ...useStore.getState().providers[0], apiKey: '' })
  await flushPersistence()
  startVault()
  await wait(() => deletes === 1)
  await wait(() => useStore.getState().toasts.some((t) => t.title === 'Хранилище ключей требует внимания'))
  assert.equal(readVaultOutbox().entries[0].pending, true)
  assert.equal(useStore.getState().providers[0].apiKey, '')
} else if (phase === 'replacement-fail') {
  useStore.getState().saveProvider({ ...useStore.getState().providers[0], apiKey: '' })
  useStore.getState().saveProvider({ ...useStore.getState().providers[0], apiKey: 'NEW-SECRET' })
  startVault()
  await wait(() => sets === 1)
  assert.ok(readVaultOutbox().entries[0].replacementRevision !== undefined)
  assert.equal(useStore.getState().providers[0].apiKey, 'NEW-SECRET')
  assert.equal(JSON.parse(ls.getItem('tetrafree')!).state.providers[0].apiKey, 'NEW-SECRET')
} else if (phase === 'replacement-reload') {
  startVault()
  await wait(() => sets === 1 && readVaultOutbox().entries.length === 0)
  await flushPersistence()
  assert.equal(deletes, 0)
  assert.equal(useStore.getState().providers[0].apiKey, 'NEW-SECRET')
  assert.equal(remote, 'NEW-SECRET')
  assert.equal(JSON.parse(ls.getItem('tetrafree')!).state.providers[0].apiKey, '')
} else if (phase === 'quota') {
  ls.fail = true
  assert.throws(() => useStore.getState().saveProvider({ ...useStore.getState().providers[0], apiKey: '' }))
  assert.equal(useStore.getState().providers[0].apiKey, 'OLD-SECRET')
  assert.equal(useStore.getState().toasts[useStore.getState().toasts.length - 1]?.title, 'Ключ не изменён')
  assert.equal(readVaultOutbox().entries.length, 0)
} else if (phase === 'anonymous') {
  useAccount.setState({ user: null })
  useStore.getState().saveProvider({ ...useStore.getState().providers[0], apiKey: 'NEW-FALLBACK' })
  await flushPersistence()
  assert.equal(useStore.getState().providers[0].apiKey, 'NEW-FALLBACK')
  assert.throws(() => useStore.getState().saveProvider({ ...useStore.getState().providers[0], apiKey: '' }))
  assert.equal(useStore.getState().providers[0].apiKey, 'NEW-FALLBACK')
} else if (phase === 'stale-snapshot') {
  // Crash immediately after durable intent, BEFORE app clear is persisted.
  recordVaultKeyIntent('p', true)
  assert.equal(JSON.parse(ls.getItem('tetrafree')!).state.providers[0].apiKey, 'OLD-SECRET')
} else if (phase === 'removed') {
  useStore.getState().deleteProvider('p')
  await flushPersistence()
  assert.equal(useStore.getState().providers.length, 0)
} else if (phase === 'failed-delete') {
  useStore.getState().saveProvider({ ...useStore.getState().providers[0], apiKey: '' })
  await flushPersistence()
  startVault()
  await wait(() => deletes === 1)
  assert.equal(useStore.getState().providers[0].apiKey, '')
  assert.equal(readVaultOutbox().entries[0].pending, true)
  assert.equal(sets, 0)
} else if (phase === 'aba') {
  useStore.setState({ providers: [{ ...provider, apiKey: '' }] as never })
  const began = new Promise<void>((r) => {
    onGet = r
  })
  startVault()
  await began
  useStore.getState().saveProvider({ ...useStore.getState().providers[0], apiKey: 'NEW-SECRET' })
  useStore.getState().saveProvider({ ...useStore.getState().providers[0], apiKey: '' })
  await flushPersistence()
  releaseGet!()
  await wait(() => deletes === 1)
  assert.equal(useStore.getState().providers[0].apiKey, '')
  assert.equal(sets, 0)
} else if (phase === 'late-account' || phase === 'late-backend') {
  useStore.getState().saveProvider({ ...useStore.getState().providers[0], apiKey: '' })
  const began = new Promise<void>((r) => {
    onDelete = r
  })
  startVault()
  await began
  if (phase === 'late-account') fakeAccount = 'account-B'
  else useBackend.setState({ base: 'http://backend-B.invalid' })
  await verifySession()
  await wait(() => useStore.getState().providers[0].apiKey === 'B-SECRET')
  releaseDelete!()
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(readVaultOutbox().entries[0].pending, true)
  assert.equal(useStore.getState().providers[0].apiKey, 'B-SECRET')
  assert.equal(isVaulted(useStore.getState().providers[0]), true)
  assert.equal(sets, 0)
} else if (phase === 'late-delete') {
  useStore.getState().saveProvider({ ...useStore.getState().providers[0], apiKey: '' })
  const began = new Promise<void>((r) => {
    onDelete = r
  })
  startVault()
  await began
  const old = vaultIntentGeneration('p')
  useStore.getState().saveProvider({ ...useStore.getState().providers[0], apiKey: 'NEW-SECRET' })
  useStore.getState().saveProvider({ ...useStore.getState().providers[0], apiKey: '' })
  releaseDelete!()
  await wait(() => deletes >= 2)
  acknowledgeVaultDelete('p', old)
  assert.equal(vaultClearIntent('p'), true)
  assert.ok(vaultIntentGeneration('p') > old)
  assert.equal(sets, 0)
} else if (phase === 'account-B' || phase === 'backend-B') {
  if (phase === 'account-B') fakeAccount = 'account-B'
  else useBackend.setState({ base: 'http://backend-B.invalid' })
  await verifySession()
  useStore.setState({ providers: [{ ...provider, apiKey: '' }] as never })
  startVault()
  await wait(() => gets > 0 && useStore.getState().providers[0].apiKey === 'B-SECRET')
  await flushPersistence()
  assert.equal(deletes, 0)
  assert.equal(readVaultOutbox().entries[0].pending, true)
} else {
  if (phase === 'rotate-token') {
    setToken('TOKEN-ROTATED')
    await verifySession()
  }
  startVault()
  await wait(() => deletes === 1)
  // Wait through actual app checkpoint / durable metadata ACK, not merely the fetch call.
  if (phase !== 'reload-failed') await wait(() => readVaultOutbox().entries.every((e) => !e.pending))
  await flushPersistence()
  assert.ok(useStore.getState().providers.every((p) => !p.apiKey))
  assert.ok(JSON.parse(ls.getItem('tetrafree')!).state.providers.every((p: { apiKey: string }) => !p.apiKey))
  assert.equal(sets, 0)
  assert.equal(isVaulted({ id: 'p', apiKey: 'OLD-SECRET' }), false)
  if (phase === 'reload-failed') assert.equal(readVaultOutbox().entries[0].pending, true)
  else assert.equal(readVaultOutbox().entries[0].pending, false)
}
const raw = ls.getItem(VAULT_OUTBOX_KEY) ?? ''
assert.ok(!raw.includes('SECRET') && !raw.includes('TOKEN-'))
console.log(
  JSON.stringify({
    phase,
    gets,
    deletes,
    sets,
    scope: vaultDurableScope(false),
    providers: useStore.getState().providers.map((p) => ({ id: p.id, empty: !p.apiKey })),
    paths,
  }),
)
process.exit(0) // deliberate abrupt exit: no unload hooks or module reset helpers
