// Benign controlled responses; all session/store/vault functions are the actual source modules.
import assert from 'node:assert/strict'
const mode = process.argv[2]
class MemoryStorage implements Storage {
  data = new Map<string, string>()
  get length() {
    return this.data.size
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null
  }
  getItem(k: string) {
    return this.data.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.data.set(k, v)
  }
  removeItem(k: string) {
    this.data.delete(k)
  }
  clear() {
    this.data.clear()
  }
}
const storage = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', { value: storage })
Object.defineProperty(globalThis, 'sessionStorage', { value: new MemoryStorage() })
const handlers = new Map<string, (event: { key: string; newValue: string | null }) => void>()
Object.defineProperty(globalThis, 'location', {
  value: { search: '', pathname: '/', origin: 'http://app.invalid' },
})
Object.defineProperty(globalThis, 'history', { value: { replaceState() {} } })
Object.defineProperty(globalThis, 'document', { value: { hidden: true, addEventListener() {} } })
Object.defineProperty(globalThis, 'window', {
  value: {
    addEventListener: (name: string, fn: (event: { key: string; newValue: string | null }) => void) =>
      handlers.set(name, fn),
  },
})
const { initialPersisted } = await import('../store/defaults')
const { PERSIST_VERSION, flushPersistence } = await import('../store/persistence')
const state = { ...initialPersisted(), projects: [], providers: [] }
storage.setItem('tetrafree', JSON.stringify({ state, version: PERSIST_VERSION, revision: 1 }))
storage.setItem('tetrafree:authority', JSON.stringify({ backend: 'ls', revision: 1 }))
const { useStore, hydrateStore } = await import('../store')
await hydrateStore()
const { useBackend } = await import('./backend')
const { getToken, setToken } = await import('./token')
const {
  api,
  useAccount,
  applySession,
  captureSession,
  confirmedAccountId,
  sessionIsCurrent,
  setAccountRecoveryMode,
  verifySession,
  loadConfig,
  refreshInvites,
  logout,
  initAccount,
} = await import('./account')
const { startVault, prepareVaultRecovery, vaultStartupBlocked } = await import('./vault')
const { vaultDurableScope } = await import('./vaultState')
const { enqueueVaultDelete } = await import('./vaultOutbox')
setAccountRecoveryMode(true)
useBackend.setState({ base: 'http://backend.invalid', status: 'online', info: { local: true } as never })
const user = (id: string, name = id) => ({
  id,
  name,
  email: id + '@invalid.test',
  verified: true,
  twofa: false,
  createdAt: 0,
  hue: 0,
  providers: [],
  hasPassword: true,
})
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const wait = async (check: () => boolean) => {
  for (let i = 0; i < 120; i++) {
    if (check()) return
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error('timed out ' + mode)
}
const baseFetch = async (input: RequestInfo | URL) => {
  const path = String(input)
  if (path.endsWith('/api/auth/config')) return json({ mail: 'dev', oauth: [], hasUsers: true })
  if (path.endsWith('/api/auth/me')) return json({ user: user('A') })
  if (path.endsWith('/api/invites')) return json({ invites: [] })
  if (path.endsWith('/api/health'))
    return json({ local: true, mail: 'dev', root: '', version: 'test', platform: 'test' })
  if (path.endsWith('/api/auth/logout')) return json({ ok: true })
  throw new Error('unexpected controlled request: ' + path)
}
globalThis.fetch = baseFetch
applySession({ token: 'session-A', user: user('A') })
if (mode === 'token-aba') {
  const context = captureSession()
  let release!: (r: Response) => void
  globalThis.fetch = async () =>
    new Promise<Response>((r) => {
      release = r
    })
  const pending = api('GET', '/controlled').then(
    (value) => ({ value }),
    (error) => ({ error }),
  )
  setToken('session-B')
  setToken('session-A')
  assert.equal(sessionIsCurrent(context), false)
  assert.equal(confirmedAccountId(), null)
  release(json({ old: true }))
  assert.ok('error' in (await pending))
} else if (mode === 'verify-order' || mode === 'verify-stale401') {
  const replies: ((r: Response) => void)[] = []
  globalThis.fetch = async (input) =>
    String(input).endsWith('/api/auth/me') ? new Promise<Response>((r) => replies.push(r)) : baseFetch(input)
  const first = verifySession()
  await wait(() => replies.length === 1)
  const second = verifySession()
  await wait(() => replies.length === 2)
  replies[1](json({ user: user('A', 'New profile') }))
  await second
  assert.equal(useAccount.getState().user?.name, 'New profile')
  replies[0](
    mode === 'verify-stale401'
      ? json({ error: { message: 'older rejected read' } }, 401)
      : json({ user: user('A', 'Old profile') }),
  )
  await first
  assert.equal(getToken(), 'session-A')
  assert.equal(confirmedAccountId(), 'A')
  assert.equal(useAccount.getState().user?.name, 'New profile')
  assert.equal(useStore.getState().people.me.name, 'New profile')
} else if (mode === 'config-order') {
  const replies: ((r: Response) => void)[] = []
  globalThis.fetch = async () => new Promise<Response>((r) => replies.push(r))
  const first = loadConfig()
  const second = loadConfig()
  replies[1](json({ mail: 'smtp', oauth: ['new'], hasUsers: true }))
  await second
  replies[0](json({ mail: 'dev', oauth: ['old'], hasUsers: false }))
  await first
  assert.deepEqual(useAccount.getState().config?.oauth, ['new'])
} else if (mode === 'verify-restores-signin') {
  await logout()
  setToken('session-A-restored')
  await verifySession()
  assert.equal(confirmedAccountId(), 'A')
  assert.equal(useStore.getState().authed, true)
  assert.equal(useStore.getState().screen, 'launcher')
} else if (mode === 'invite-order') {
  const replies: ((r: Response) => void)[] = []
  globalThis.fetch = async () => new Promise<Response>((r) => replies.push(r))
  const first = refreshInvites()
  const second = refreshInvites()
  replies[1](json({ invites: [{ id: 'new' }] }))
  await second
  replies[0](json({ invites: [{ id: 'old' }] }))
  await first
  assert.deepEqual(
    useAccount.getState().invites.map((i) => i.id),
    ['new'],
  )
} else if (mode === 'storage-stale-event') {
  initAccount()
  applySession({ token: 'session-B', user: user('B') })
  // Earlier remote removal notification arrives after this tab committed a new login.
  handlers.get('storage')!({ key: 'tf-token', newValue: null })
  assert.equal(getToken(), 'session-B')
  assert.equal(confirmedAccountId(), 'B')
  assert.equal(useStore.getState().authed, true)
} else if (mode === 'proof-publication') {
  let observed = false
  const off = useAccount.subscribe((s) => {
    if (s.user?.id === 'B' && confirmedAccountId() === 'B') {
      observed = true
      assert.equal(useStore.getState().people.me.email, 'B@invalid.test')
      assert.equal(useStore.getState().people.me.name, 'B')
      assert.equal(useStore.getState().authed, true)
    }
  })
  applySession({ token: 'session-B', user: user('B') })
  off()
  assert.equal(observed, true)
} else if (mode === 'reentrant-logout') {
  let switched = false
  const off = useAccount.subscribe((s) => {
    if (!switched && s.user?.id === 'B') {
      switched = true
      void logout()
    }
  })
  try {
    applySession({ token: 'session-B', user: user('B') })
  } catch {
    /* superseded login may reject */
  }
  off()
  assert.equal(switched, true)
  assert.equal(getToken(), null)
  assert.equal(useAccount.getState().user, null)
  assert.equal(useStore.getState().authed, false)
  assert.equal(confirmedAccountId(), null)
} else if (mode === 'signin-throws') {
  const original = useStore.getState().signIn
  useStore.setState({
    signIn: () => {
      throw new Error('controlled publication failure')
    },
  })
  assert.throws(() => applySession({ token: 'session-B', user: user('B') }))
  assert.equal(confirmedAccountId(), null)
  useStore.setState({ signIn: original })
} else if (mode === 'null-token-expiry') {
  initAccount()
  // The storage event may arrive after another path has already removed the local bearer.
  setToken(null)
  assert.equal(useStore.getState().authed, true)
  handlers.get('storage')!({ key: 'tf-token', newValue: null })
  assert.equal(useStore.getState().authed, false)
  assert.equal(useAccount.getState().user, null)
  assert.equal(confirmedAccountId(), null)
} else if (mode === 'logout-reentrant-login' || mode === 'expiry-reentrant-login') {
  let loggedIn = false
  const off = useAccount.subscribe((s) => {
    if (!loggedIn && s.user === null) {
      loggedIn = true
      applySession({ token: 'session-B', user: user('B') })
    }
  })
  if (mode === 'logout-reentrant-login') await logout()
  else {
    globalThis.fetch = async () => json({ error: { message: 'current session expired' } }, 401)
    await assert.rejects(api('GET', '/controlled'))
  }
  off()
  assert.equal(loggedIn, true)
  assert.equal(getToken(), 'session-B')
  assert.equal(confirmedAccountId(), 'B')
  assert.equal(useStore.getState().authed, true)
  assert.equal(useStore.getState().people.me.email, 'B@invalid.test')
} else if (mode === 'old-logout-reply') {
  let release!: (r: Response) => void
  globalThis.fetch = async () =>
    new Promise<Response>((r) => {
      release = r
    })
  const pending = logout()
  applySession({ token: 'session-B', user: user('B') })
  release(json({ error: { message: 'late old logout' } }, 401))
  await pending
  assert.equal(getToken(), 'session-B')
  assert.equal(confirmedAccountId(), 'B')
  assert.equal(useStore.getState().authed, true)
} else if (mode === 'vault-provider-snapshot') {
  const provider = (id: string, apiKey: string) => ({
    id,
    apiKey,
    name: id,
    kind: 'custom',
    baseUrl: 'http://model.invalid',
    models: [],
    on: true,
  })
  useStore.setState({ providers: [provider('p1', 'FIRST'), provider('p2', 'OLD-SECOND')] as never })
  let release!: (r: Response) => void
  const sent: { id: string; value: string }[] = []
  globalThis.fetch = async (input, init) => {
    if (String(input).endsWith('/api/secrets')) return json({ mode: 'file', items: {} })
    const body = JSON.parse(String(init?.body))
    sent.push(body)
    if (body.id === 'p1' && sent.length === 1)
      return new Promise<Response>((r) => {
        release = r
      })
    return json({ ok: true })
  }
  startVault()
  await wait(() => sent.length === 1)
  useStore.getState().saveProvider({ ...useStore.getState().providers[1], apiKey: 'NEW-SECOND' })
  release(json({ ok: true }))
  await wait(() => sent.some((x) => x.id === 'p2'))
  assert.deepEqual(
    sent.filter((x) => x.id === 'p2').map((x) => x.value),
    ['NEW-SECOND'],
  )
  await flushPersistence()
  assert.equal(useStore.getState().providers[1].apiKey, 'NEW-SECOND')
} else if (mode === 'vault-reauth-replacement') {
  useStore.setState({ providers: [{ id: 'p', apiKey: '' }] as never })
  useStore.getState().saveProvider({ ...useStore.getState().providers[0], apiKey: '' })
  useStore.getState().saveProvider({ ...useStore.getState().providers[0], apiKey: 'NEW-REPLACEMENT' })
  let gets = 0,
    sets = 0,
    deletes = 0
  let release!: (r: Response) => void
  globalThis.fetch = async (input) => {
    const path = String(input)
    if (path.endsWith('/api/secrets')) {
      gets++
      return json({ mode: 'file', items: { p: 'OLD-REMOTE' } })
    }
    if (path.endsWith('/api/secrets/delete')) {
      deletes++
      return json({ ok: true })
    }
    if (path.endsWith('/api/secrets/set')) {
      sets++
      if (sets === 1)
        return new Promise<Response>((r) => {
          release = r
        })
      return json({ ok: true })
    }
    throw new Error('unexpected replacement request')
  }
  startVault()
  await wait(() => sets === 1)
  // The replacement app checkpoint + metadata proof already committed, but old SET is pending.
  applySession({ token: 'session-A-refreshed', user: user('A') })
  await wait(() => gets >= 2)
  assert.equal(useStore.getState().providers[0].apiKey, 'NEW-REPLACEMENT')
  assert.equal(deletes, 0)
  release(json({ ok: true }))
  await wait(() => sets >= 2)
  await flushPersistence()
  assert.equal(useStore.getState().providers[0].apiKey, 'NEW-REPLACEMENT')
  assert.equal(deletes, 0)
} else if (mode === 'vault-session-epoch') {
  useStore.setState({ providers: [{ id: 'p', apiKey: '' }] as never })
  const gets: ((r: Response) => void)[] = []
  globalThis.fetch = async (input) => {
    if (String(input).endsWith('/api/secrets')) return new Promise<Response>((r) => gets.push(r))
    return json({ ok: true })
  }
  startVault()
  await wait(() => gets.length === 1)
  applySession({ token: 'session-A', user: user('A') })
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(gets.length, 2)
  gets[1](json({ mode: 'file', items: { p: 'NEW-SESSION' } }))
  await wait(() => useStore.getState().providers[0].apiKey === 'NEW-SESSION')
  gets[0](json({ mode: 'file', items: { p: 'OLD-SESSION' } }))
  await new Promise((r) => setTimeout(r, 30))
  assert.equal(useStore.getState().providers[0].apiKey, 'NEW-SESSION')
} else if (mode === 'recovery-flight-rotation') {
  const empty = prepareVaultRecovery()
  const scope = vaultDurableScope()!
  enqueueVaultDelete(scope, 'p')
  setToken('session-B')
  globalThis.fetch = async (input) =>
    String(input).endsWith('/api/auth/me') ? json({}, 503) : baseFetch(input)
  const next = prepareVaultRecovery()
  await empty
  await assert.rejects(next)
  assert.equal(vaultStartupBlocked(), true)
} else throw new Error('unknown audit mode ' + mode)
console.log(JSON.stringify({ mode, desired: 'PASS' }))
process.exit(0)
