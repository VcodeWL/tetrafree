import test from 'node:test'
import assert from 'node:assert/strict'
import {
  idbStorage,
  flushPersistence,
  capturePersistenceGeneration,
  capturePersistenceRuntimeRevision,
  recoverySnapshots,
  type StoredValue,
} from './persistence'
import { initialPersisted } from './defaults'
import { idbAvailable } from './idb'

class MemoryStorage implements Storage {
  data = new Map<string, string>()
  failWrite = false
  failAuthority = false
  ignoreAuthority = false
  failRemove = false
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
    if (this.failWrite) throw new Error('quota')
    if (this.failAuthority && k.endsWith(':authority')) throw new Error('authority write failed')
    if (this.ignoreAuthority && k.endsWith(':authority')) return
    this.data.set(k, v)
  }
  removeItem(k: string) {
    if (this.failRemove && k === 'tetrafree') throw new Error('cleanup failed')
    this.data.delete(k)
  }
  clear() {
    this.data.clear()
  }
}
const ls = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true })
const disk = new Map<string, string>()
let failWrite = false
let failRead = false
let gate: Promise<void> | undefined
let failOpen = false
let opens = 0
let transactions: Promise<void> = Promise.resolve()
const db = {
  objectStoreNames: { contains: () => true },
  close: () => {},
  onversionchange: undefined as (() => void) | undefined,
  onclose: undefined as (() => void) | undefined,
  transaction: () => {
    const tx = {
      oncomplete: () => {},
      onerror: () => {},
      onabort: () => {},
      error: new Error('disk'),
      objectStore: () => ({
        get: (k: string) => operation('get', k),
        put: (v: string, k: string) => operation('put', k, v),
        delete: (k: string) => operation('delete', k),
      }),
    }
    function operation(op: string, k: string, v?: string) {
      const request = { result: undefined as string | undefined }
      const wait = gate
      transactions = transactions.then(async () => {
        await wait
        if ((op !== 'get' && failWrite) || (op === 'get' && failRead)) {
          tx.onerror()
          return
        }
        if (op === 'put') disk.set(k, v!)
        if (op === 'delete') disk.delete(k)
        request.result = op === 'get' ? disk.get(k) : undefined
        tx.oncomplete()
      })
      return request
    }
    return tx
  },
}
Object.defineProperty(globalThis, 'indexedDB', {
  configurable: true,
  value: {
    open: () => {
      opens++
      const request = {
        result: db,
        onsuccess: () => {},
        onerror: () => {},
        onblocked: () => {},
        onupgradeneeded: () => {},
      }
      queueMicrotask(() => (failOpen ? request.onerror() : request.onsuccess()))
      return request
    },
  },
})
const value = (label: string, revision = 0): StoredValue => ({
  state: { ...initialPersisted(), model: label },
  version: 7,
  revision,
})
const raw = (label: string, revision = 0) => JSON.stringify(value(label, revision))
const reset = () => {
  disk.clear()
  ls.clear()
  failWrite = false
  failRead = false
  ls.failWrite = false
  ls.failAuthority = false
  ls.ignoreAuthority = false
  ls.failRemove = false
  gate = undefined
}
const loaded = async () => {
  const storage = idbStorage(() => {})
  await storage.getItem('tetrafree')
  storage.completeHydration()
  return storage
}

test('S01 newer fallback wins crash recovery, later durable IDB write cleans fallback', async () => {
  reset()
  disk.set('tetrafree', raw('OLD'))
  const storage = await loaded()
  failWrite = true
  storage.setItem('tetrafree', value('NEW'))
  await storage.flush()
  assert.equal(JSON.parse(ls.getItem('tetrafree')!).state.model, 'NEW')
  const afterCrash = idbStorage(() => {})
  const read = await afterCrash.getItem('tetrafree')
  assert.equal((read!.state as { model: string }).model, 'NEW')
  afterCrash.completeHydration()
  failWrite = false
  afterCrash.setItem('tetrafree', value('RECOVERED'))
  await afterCrash.flush()
  assert.equal(ls.getItem('tetrafree'), null)
  assert.equal(JSON.parse(disk.get('tetrafree')!).state.model, 'RECOVERED')
})
test('S02 delete is queued behind an in-flight put; failed delete leaves newer tombstone', async () => {
  reset()
  const storage = await loaded()
  let release!: () => void
  gate = new Promise<void>((r) => {
    release = r
  })
  storage.setItem('tetrafree', value('NEW'))
  const writing = storage.flush()
  const deleting = storage.removeItem('tetrafree')
  gate = undefined
  release()
  await writing
  await deleting
  assert.equal(JSON.parse(disk.get('tetrafree')!).deleted, true)
  assert.equal(await idbStorage(() => {}).getItem('tetrafree'), null)
  assert.equal(ls.getItem('tetrafree'), null)
  disk.set('tetrafree', raw('OLD'))
  failWrite = true
  await storage.removeItem('tetrafree')
  assert.equal(await idbStorage(() => {}).getItem('tetrafree'), null)
})
test('S03 unsupported/corrupt raw remains intact and cannot become a writable empty state', async () => {
  for (const saved of [
    JSON.stringify({ ...value('future'), version: 8 }),
    '{broken',
    JSON.stringify({ state: { projects: 'bad' }, version: 7 }),
  ]) {
    reset()
    disk.set('tetrafree', saved)
    const storage = idbStorage(() => {})
    await assert.rejects(Promise.resolve(storage.getItem('tetrafree')))
    const error = new Error('hydration failed')
    storage.completeHydration(error)
    assert.throws(() => storage.setItem('tetrafree', value('EMPTY')))
    await assert.rejects(storage.flush())
    assert.equal(disk.get('tetrafree'), saved)
    assert.equal(recoverySnapshots.indexedDB, saved)
  }
})
test('S05 pending hydration is never a writable checkpoint', async () => {
  reset()
  disk.set('tetrafree', raw('OLD'))
  let release!: () => void
  gate = new Promise<void>((r) => {
    release = r
  })
  const storage = idbStorage(() => {})
  const reading = storage.getItem('tetrafree')
  await assert.rejects(storage.flush(), /не загружено/)
  assert.equal(disk.get('tetrafree'), raw('OLD'))
  gate = undefined
  release()
  await reading
  storage.completeHydration()
})
test('S14 a failed durable write rejects, retries current state, never acknowledges a swallowed quota', async () => {
  reset()
  const storage = await loaded()
  failWrite = true
  ls.failWrite = true
  storage.setItem('tetrafree', value('NEW'))
  await assert.rejects(storage.flush(), /quota/)
  ls.failWrite = false
  await storage.flush()
  assert.equal(JSON.parse(ls.getItem('tetrafree')!).state.model, 'NEW')
})
test('failed in-flight put followed by delete cannot resurrect pending old state', async () => {
  reset()
  const storage = await loaded()
  failWrite = true
  ls.failWrite = true
  let release!: () => void
  gate = new Promise<void>((r) => {
    release = r
  })
  storage.setItem('tetrafree', value('OLD'))
  const writing = storage.flush()
  const expectedFailure = assert.rejects(writing)
  const deleting = storage.removeItem('tetrafree')
  const expectedDeleteFailure = assert.rejects(Promise.resolve(deleting))
  gate = undefined
  release()
  await expectedFailure
  await expectedDeleteFailure
  ls.failWrite = false
  // Explicit retry of delete; no stale pending put was restored.
  await storage.removeItem('tetrafree')
  await storage.flush()
  assert.equal(await idbStorage(() => {}).getItem('tetrafree'), null)
})
test('failed IDB open and versionchange are retryable, not cached forever', async () => {
  db.onversionchange?.()
  failOpen = true
  assert.equal(await idbAvailable(), false)
  const before = opens
  failOpen = false
  assert.equal(await idbAvailable(), true)
  assert.ok(opens > before)
  db.onversionchange?.()
  const after = opens
  assert.equal(await idbAvailable(), true)
  assert.ok(opens > after)
})
test('exported flushPersistence snapshots CURRENT Zustand state and rejects an unavailable checkpoint', async () => {
  reset()
  const { useStore, hydrateStore } = await import('./index')
  await assert.rejects(flushPersistence(), /не загружено/)
  await hydrateStore()
  useStore.setState({ model: 'CURRENT' })
  await flushPersistence()
  assert.equal(JSON.parse(disk.get('tetrafree')!).state.model, 'CURRENT')
  failWrite = true
  ls.failWrite = true
  useStore.setState({ model: 'UNSAVED' })
  await assert.rejects(flushPersistence())
  ls.failWrite = false
  failWrite = false
  await flushPersistence()
})

test('S14 docsync cannot save ancestor before durable state, deletions retain recovery trash', async () => {
  reset()
  const { useStore } = await import('./index')
  const { syncDocs } = await import('../lib/docsync')
  useStore.setState({
    projects: [
      {
        id: 'docs-p',
        name: 'Docs',
        path: '',
        docs: [{ id: 'd', title: 'A', blocks: [{ id: 'b', type: 'p', text: 'note' }] }],
        files: {},
        dirs: [],
        versions: [],
        chats: [],
      },
    ] as never,
  })
  failWrite = true
  ls.failWrite = true
  await assert.rejects(syncDocs('docs-p'))
  assert.equal(ls.getItem('tf-docs:docs-p'), null)
  failWrite = false
  ls.failWrite = false
  await syncDocs('docs-p')
  const ancestor = JSON.parse(ls.getItem('tf-docs:docs-p')!)
  assert.ok(ancestor.d)
  assert.ok(JSON.parse(disk.get('tetrafree')!).state.projects[0].files['docs/A.md'])
  useStore.setState((s) => {
    s.projects[0].docs = []
  })
  await syncDocs('docs-p')
  assert.equal(useStore.getState().projects[0].files['docs/A.md'], undefined)
  assert.equal(useStore.getState().projects[0].trash?.[0].path, 'docs/A.md')
  useStore.setState({ projects: [] })
  await flushPersistence()
})
test('S15 stale 401, successful profile, login result and slow logout cannot overwrite new session', async () => {
  const { useBackend } = await import('../lib/backend')
  const { setToken, getToken } = await import('../lib/token')
  const { api, applySession, useAccount, verifySession, logout } = await import('../lib/account')
  const { useStore } = await import('./index')
  useBackend.setState({ status: 'online', base: 'A', info: { local: true } as never })
  const user = (id: string) => ({
    id,
    name: id,
    email: id + '@example.test',
    verified: true,
    twofa: false,
    createdAt: 1,
    hue: 1,
    providers: [],
    hasPassword: true,
  })
  const respond = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
  let release!: (r: Response) => void
  globalThis.fetch = async (input) => {
    if (String(input).endsWith('/api/auth/config')) return respond({ hasUsers: true })
    if (String(input).endsWith('/api/auth/me')) return respond({ user: user('new'), previewToken: 'preview' })
    return new Promise<Response>((r) => {
      release = r
    })
  }
  setToken('old')
  const request = api('GET', '/api/invites')
  const rejected = assert.rejects(request, /устаревшей/)
  applySession({ token: 'new', user: user('new') })
  release(respond({ error: { message: 'expired' } }, 401))
  await rejected
  assert.equal(getToken(), 'new')
  assert.equal(useAccount.getState().user?.id, 'new')
  assert.equal(useStore.getState().authed, true)
  // A slow verify success must not replace a newer user.
  let profileStarted!: () => void
  const started = new Promise<void>((r) => {
    profileStarted = r
  })
  globalThis.fetch = async (input) => {
    if (String(input).endsWith('/api/auth/config')) return respond({ hasUsers: true })
    if (String(input).endsWith('/api/auth/me')) {
      profileStarted()
      return new Promise<Response>((r) => {
        release = r
      })
    }
    return respond({ invites: [] })
  }
  const verifying = verifySession()
  await started
  setToken('newer')
  useAccount.setState({ user: user('newer') })
  release(respond({ user: user('old'), previewToken: 'old-preview' }))
  await verifying
  assert.equal(useAccount.getState().user?.id, 'newer')
  // api result retains its epoch even if applySession is invoked after another flow won.
  globalThis.fetch = async () => respond({ token: 'late', user: user('late') })
  const loginResult = await api<{ token: string; user: ReturnType<typeof user> }>('POST', '/api/auth/login')
  applySession({ token: 'winner', user: user('winner') })
  assert.throws(() => applySession(loginResult), /устарел/)
  globalThis.fetch = async (input) =>
    String(input).endsWith('/api/auth/logout')
      ? new Promise<Response>((r) => {
          release = r
        })
      : respond({ user: user('last'), previewToken: 'last' })
  const loggingOut = logout()
  assert.equal(getToken(), null)
  applySession({ token: 'last', user: user('last') })
  release(respond({ ok: true }))
  await loggingOut
  assert.equal(getToken(), 'last')
  assert.equal(useAccount.getState().user?.id, 'last')
})
test('S16 vault ack and delayed responses are backend scoped; S17 stabilized idle causes no provider updates or writes', async () => {
  reset()
  const { useStore } = await import('./index')
  const { useBackend } = await import('../lib/backend')
  const { setToken } = await import('../lib/token')
  const { startVault, isVaulted } = await import('../lib/vault')
  const { stripSecrets } = await import('../lib/vaultState')
  setToken('vault-session')
  useBackend.setState({ base: 'A', status: 'online', info: { local: true } as never })
  useStore.setState({ providers: [{ id: 'p', apiKey: '' }] as never })
  const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
  const respond = (body: unknown) => new Response(JSON.stringify(body))
  let requests = 0
  let oldRelease!: (r: Response) => void
  globalThis.fetch = async (input) => {
    requests++
    if (String(input).startsWith('C'))
      return new Promise<Response>((r) => {
        oldRelease = r
      })
    if (String(input).endsWith('/api/secrets')) return respond({ mode: 'file', items: { p: 'KEY' } })
    return respond({ ok: true })
  }
  startVault()
  await sleep(650)
  assert.equal(isVaulted(useStore.getState().providers[0]), true)
  let updates = 0
  const unsubscribe = useStore.subscribe((s, prev) => {
    if (s.providers !== prev.providers) updates++
  })
  const beforeRequests = requests,
    beforeTransactions = transactions
  await sleep(1650)
  assert.equal(updates, 0)
  assert.equal(requests, beforeRequests)
  assert.equal(transactions, beforeTransactions)
  useBackend.setState({ base: 'B' })
  assert.equal(isVaulted(useStore.getState().providers[0]), false)
  assert.equal(stripSecrets(useStore.getState().providers)[0].apiKey, 'KEY')
  await sleep(650)
  assert.equal(isVaulted(useStore.getState().providers[0]), true)
  useBackend.setState({ base: 'C' })
  await sleep(10)
  useBackend.setState({ base: 'D' })
  await sleep(650)
  oldRelease(respond({ mode: 'file', items: { p: 'OLD-BACKEND-KEY' } }))
  await sleep(20)
  assert.equal(useStore.getState().providers[0].apiKey, 'KEY')
  assert.equal(isVaulted(useStore.getState().providers[0]), true)
  unsubscribe()
})

test('authority prevents stale LS recovery when IDB temporarily cannot be read; confirmed fallback works', async () => {
  reset()
  disk.set('tetrafree', raw('OLD'))
  const storage = await loaded()
  failWrite = true
  storage.setItem('tetrafree', value('NEW'))
  await storage.flush()
  failRead = true
  assert.equal(((await idbStorage(() => {}).getItem('tetrafree'))!.state as { model: string }).model, 'NEW')
  failRead = false
  failWrite = false
  // Simulate an uncleared old LS copy, and a newer committed IDB state.
  disk.set('tetrafree', raw('NEWER', 3))
  ls.setItem('tetrafree:authority', JSON.stringify({ revision: 3, backend: 'idb' }))
  failRead = true
  await assert.rejects(Promise.resolve(idbStorage(() => {}).getItem('tetrafree')), /актуальность/)
  failRead = false
})

test('R01 logical delete must survive failed LS cleanup and restart without resurrecting OLD', async () => {
  reset()
  disk.set('tetrafree', raw('OLD', 1))
  ls.setItem('tetrafree', raw('OLD', 1))
  const storage = await loaded()
  ls.failRemove = true
  await storage.removeItem('tetrafree')
  assert.equal(await idbStorage(() => {}).getItem('tetrafree'), null)
  assert.equal(JSON.parse(disk.get('tetrafree')!).deleted, true)
  // A later set supersedes the retained tombstone with a strictly newer revision.
  ls.failRemove = false
  const next = await loaded()
  next.setItem('tetrafree', value('AFTER-DELETE'))
  await next.flush()
  assert.equal(
    ((await idbStorage(() => {}).getItem('tetrafree'))!.state as { model: string }).model,
    'AFTER-DELETE',
  )
})
test('R02 failed fallback authority must reject checkpoint and keep NEW retryable', async () => {
  reset()
  disk.set('tetrafree', raw('OLD', 1))
  ls.setItem('tetrafree', raw('OLD', 1))
  ls.setItem('tetrafree:authority', JSON.stringify({ revision: 1, backend: 'ls' }))
  const storage = await loaded()
  failWrite = true
  ls.failAuthority = true
  storage.setItem('tetrafree', value('NEW'))
  await assert.rejects(storage.flush(), /authority/)
  assert.equal(JSON.parse(ls.getItem('tetrafree')!).state.model, 'NEW')
  // Only a retry which makes authority durable can acknowledge baseline advancement.
  ls.failAuthority = false
  await storage.flush()
  failRead = true
  assert.equal(((await idbStorage(() => {}).getItem('tetrafree'))!.state as { model: string }).model, 'NEW')
  failRead = false
})
test('R07 delayed vault GET cannot restore a key locally cleared and persisted during the request', async () => {
  reset()
  const { useStore } = await import('./index')
  const { useBackend } = await import('../lib/backend')
  const { setToken } = await import('../lib/token')
  const { startVault, isVaulted } = await import('../lib/vault')
  const provider = {
    id: 'cleared-provider',
    apiKey: 'KEY-TO-CLEAR',
    name: 'clear test',
    kind: 'custom',
    baseUrl: 'https://invalid.example',
    models: [],
    on: true,
  } as never
  let release!: (r: Response) => void
  let began!: () => void
  const started = new Promise<void>((r) => {
    began = r
  })
  let deleted!: () => void
  const removed = new Promise<void>((r) => {
    deleted = r
  })
  let deletes = 0,
    sets = 0
  globalThis.fetch = async (input) => {
    if (String(input) === 'CLEAR:/api/secrets') {
      began()
      return new Promise<Response>((r) => {
        release = r
      })
    }
    if (String(input) === 'CLEAR:/api/secrets/delete') {
      deletes++
      deleted()
      return new Response('{}')
    }
    if (String(input) === 'CLEAR:/api/secrets/set') {
      sets++
      return new Response('{}')
    }
    throw new Error('Unexpected test request: ' + input)
  }
  useStore.setState({ providers: [provider] })
  setToken('clear-session')
  useBackend.setState({ base: 'CLEAR:', status: 'online', info: { local: true } as never })
  startVault()
  await started
  useStore.getState().saveProvider({ ...useStore.getState().providers[0], apiKey: '' })
  await flushPersistence()
  assert.equal(useStore.getState().providers[0].apiKey, '')
  release(new Response(JSON.stringify({ mode: 'file', items: { 'cleared-provider': 'KEY-TO-CLEAR' } })))
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      removed,
      new Promise<void>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('vault delete not sent')), 1500)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
  await flushPersistence()
  assert.equal(useStore.getState().providers[0].apiKey, '')
  assert.equal(isVaulted(useStore.getState().providers[0]), false)
  assert.equal(deletes, 1)
  assert.equal(sets, 0)
})

test('R01 missing authoritative snapshot fails closed instead of loading lower-revision fallback', async () => {
  reset()
  ls.setItem('tetrafree', raw('OLD', 1))
  ls.setItem('tetrafree:authority', JSON.stringify({ revision: 2, backend: 'idb' }))
  const storage = idbStorage(() => {})
  await assert.rejects(Promise.resolve(storage.getItem('tetrafree')), /Актуальный снимок недоступен/)
  await assert.rejects(storage.flush())
  assert.equal(ls.getItem('tetrafree'), raw('OLD', 1))
})
test('R02 silently dropped fallback authority is not acknowledged as a durable checkpoint', async () => {
  reset()
  disk.set('tetrafree', raw('OLD', 1))
  ls.setItem('tetrafree', raw('OLD', 1))
  ls.setItem('tetrafree:authority', JSON.stringify({ revision: 1, backend: 'ls' }))
  const storage = await loaded()
  failWrite = true
  ls.ignoreAuthority = true
  storage.setItem('tetrafree', value('NEW'))
  await assert.rejects(storage.flush(), /указателя/)
  assert.equal(JSON.parse(ls.getItem('tetrafree')!).state.model, 'NEW')
  ls.ignoreAuthority = false
  await storage.flush()
  failRead = true
  assert.equal(((await idbStorage(() => {}).getItem('tetrafree'))!.state as { model: string }).model, 'NEW')
  failRead = false
})
test('R07 delayed vault GET preserves a replacement key and deletes a provider removed while pending', async () => {
  reset()
  const { useStore } = await import('./index')
  const { useBackend } = await import('../lib/backend')
  for (const action of ['replace', 'remove'] as const) {
    let release!: (r: Response) => void, began!: () => void, posted!: () => void
    const started = new Promise<void>((r) => {
      began = r
    })
    const written = new Promise<void>((r) => {
      posted = r
    })
    const operations: { path: string; body: unknown }[] = []
    const base = action + ':'
    globalThis.fetch = async (input, init) => {
      const path = String(input).slice(base.length)
      if (path === '/api/secrets') {
        began()
        return new Promise<Response>((r) => {
          release = r
        })
      }
      operations.push({ path, body: JSON.parse(String(init?.body)) })
      posted()
      return new Response('{}')
    }
    useStore.setState({ providers: [{ id: 'edited-provider', apiKey: 'OLD-REMOTE' }] as never })
    useBackend.setState({ base })
    await started
    if (action === 'replace')
      useStore.getState().saveProvider({ ...useStore.getState().providers[0], apiKey: 'LOCAL-NEW' })
    else useStore.getState().deleteProvider('edited-provider')
    await flushPersistence()
    release(new Response(JSON.stringify({ mode: 'file', items: { 'edited-provider': 'OLD-REMOTE' } })))
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        written,
        new Promise<void>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('vault operation not sent')), 1500)
        }),
      ])
    } finally {
      clearTimeout(timeout)
    }
    if (action === 'replace') {
      assert.equal(useStore.getState().providers[0].apiKey, 'LOCAL-NEW')
      assert.deepEqual(operations, [
        { path: '/api/secrets/set', body: { id: 'edited-provider', value: 'LOCAL-NEW' } },
      ])
    } else {
      assert.equal(useStore.getState().providers.length, 0)
      assert.deepEqual(operations, [{ path: '/api/secrets/delete', body: { id: 'edited-provider' } }])
    }
    await flushPersistence()
  }
})

test('R07 ABA: placeholder -> temporary key -> cleared while GET pending never restores old remote', async () => {
  reset()
  const { useStore } = await import('./index')
  const { useBackend } = await import('../lib/backend')
  const { setToken } = await import('../lib/token')
  const { startVault, isVaulted } = await import('../lib/vault')
  const provider = {
    id: 'aba-provider',
    apiKey: '',
    name: 'ABA',
    kind: 'custom',
    baseUrl: 'https://invalid.example',
    models: [],
    on: true,
  } as never
  let release!: (r: Response) => void, began!: () => void, deleted!: () => void
  const beganGet = new Promise<void>((r) => {
    began = r
  })
  const deletedKey = new Promise<void>((r) => {
    deleted = r
  })
  let deletes = 0,
    sets = 0
  globalThis.fetch = async (input) => {
    if (String(input) === 'ABA:/api/secrets') {
      began()
      return new Promise<Response>((r) => {
        release = r
      })
    }
    if (String(input) === 'ABA:/api/secrets/delete') {
      deletes++
      deleted()
      return new Response('{}')
    }
    if (String(input) === 'ABA:/api/secrets/set') {
      sets++
      return new Response('{}')
    }
    throw new Error('Unexpected ABA test request: ' + input)
  }
  useStore.setState({ providers: [provider] })
  setToken('aba-session')
  useBackend.setState({ base: 'ABA:', status: 'online', info: { local: true } as never })
  startVault()
  await beganGet
  // All three values and both real actions matter: a before/after value comparison sees equality.
  assert.equal(useStore.getState().providers[0].apiKey, '')
  useStore.getState().saveProvider({ ...useStore.getState().providers[0], apiKey: 'TEMPORARY-LOCAL' })
  assert.equal(useStore.getState().providers[0].apiKey, 'TEMPORARY-LOCAL')
  useStore.getState().saveProvider({ ...useStore.getState().providers[0], apiKey: '' })
  await flushPersistence()
  assert.equal(useStore.getState().providers[0].apiKey, '')
  assert.equal(JSON.parse(disk.get('tetrafree')!).state.providers[0].apiKey, '')
  release(new Response(JSON.stringify({ mode: 'file', items: { 'aba-provider': 'OLD-REMOTE' } })))
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      deletedKey,
      new Promise<void>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('ABA clear was not sent to vault')), 500)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
  await flushPersistence()
  assert.equal(useStore.getState().providers[0].apiKey, '')
  assert.equal(isVaulted(useStore.getState().providers[0]), false)
  assert.equal(deletes, 1)
  assert.equal(sets, 0)
})

test('R07 explicit same-empty save is not a hydration placeholder; failed delete retains runtime intent for retry', async () => {
  reset()
  const { useStore } = await import('./index')
  const { useBackend } = await import('../lib/backend')
  const { pendingVaultDeletes, vaultClearIntent } = await import('../lib/vaultState')
  const id = 'same-empty-provider'
  useStore.setState({ providers: [{ id, apiKey: '' }] as never })
  let release!: (r: Response) => void, began!: () => void, firstDelete!: () => void, retryDelete!: () => void
  const beganGet = new Promise<void>((r) => {
    began = r
  })
  const failed = new Promise<void>((r) => {
    firstDelete = r
  })
  const retried = new Promise<void>((r) => {
    retryDelete = r
  })
  let deletes = 0
  globalThis.fetch = async (input) => {
    if (String(input) === 'SAME:/api/secrets') {
      began()
      return new Promise<Response>((r) => {
        release = r
      })
    }
    if (String(input) === 'SAME:/api/secrets/delete') {
      deletes++
      if (deletes === 1) {
        firstDelete()
        return new Response('{}', { status: 503 })
      }
      retryDelete()
      return new Response('{}')
    }
    throw new Error('Unexpected same-empty test request: ' + input)
  }
  useBackend.setState({ base: 'SAME:' })
  await beganGet
  useStore.getState().saveProvider({ ...useStore.getState().providers[0], apiKey: '' })
  await flushPersistence()
  release(new Response(JSON.stringify({ mode: 'file', items: { [id]: 'OLD-REMOTE' } })))
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      failed,
      new Promise<void>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('initial delete not sent')), 1500)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
  await new Promise<void>((r) => setTimeout(r, 10))
  assert.equal(useStore.getState().providers[0].apiKey, '')
  assert.equal(vaultClearIntent(id), true)
  assert.equal(pendingVaultDeletes().includes(id), true)
  useStore.getState().saveProvider({ ...useStore.getState().providers[0], apiKey: '' })
  try {
    await Promise.race([
      retried,
      new Promise<void>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('delete retry not sent')), 1500)
      }),
    ])
  } finally {
    clearTimeout(timeout)
  }
  await new Promise<void>((r) => setTimeout(r, 10))
  assert.equal(pendingVaultDeletes().includes(id), false)
  assert.equal(vaultClearIntent(id), true)
  assert.equal(useStore.getState().providers[0].apiKey, '')
  assert.equal(deletes, 2)
  await flushPersistence()
})

test('generation: selected durable revision is captured independently from queued identical setItems and committed writes', async () => {
  reset()
  disk.set('tetrafree', raw('IDB-OLD', 20))
  ls.setItem('tetrafree', raw('FALLBACK-NEW', 24))
  ls.setItem('tetrafree:authority', JSON.stringify({ revision: 24, backend: 'ls' }))
  const storage = await loaded()
  assert.deepEqual(storage.captureGeneration(), { current: 24, hydrated: 24 })
  storage.setItem('tetrafree', value('QUEUED'))
  assert.deepEqual(storage.captureGeneration(), { current: 25, hydrated: 24 })
  storage.setItem('tetrafree', value('QUEUED'))
  assert.deepEqual(storage.captureGeneration(), { current: 26, hydrated: 24 })
  assert.equal(JSON.parse(disk.get('tetrafree')!).revision, 20)
  await storage.flush()
  assert.equal(JSON.parse(disk.get('tetrafree')!).revision, 26)
  assert.deepEqual(storage.captureGeneration(), { current: 26, hydrated: 24 })
  assert.deepEqual(storage.captureGeneration(), storage.captureGeneration())
})
test('generation: real middleware migration auto-write N+1 must not change hydrated N', async () => {
  reset()
  const { useStore, hydrateStore } = await import('./index')
  const n = 1_000_000
  assert.ok(capturePersistenceGeneration().current < n)
  disk.set('tetrafree', JSON.stringify({ ...value('V6-MIGRATION', n), version: 6 }))
  ls.setItem('tetrafree:authority', JSON.stringify({ revision: n, backend: 'idb' }))
  await hydrateStore()
  assert.equal(useStore.persist.hasHydrated(), true)
  assert.equal(useStore.getState().model, 'V6-MIGRATION')
  // Actual Zustand migrate() triggers storage.setItem before finishHydration, not a fabricated write.
  assert.deepEqual(capturePersistenceGeneration(), { current: n + 1, hydrated: n })
  assert.equal(capturePersistenceRuntimeRevision(), 0)
  assert.equal(JSON.parse(disk.get('tetrafree')!).revision, n)
  await flushPersistence()
  const committed = JSON.parse(disk.get('tetrafree')!)
  assert.equal(committed.state.model, 'V6-MIGRATION')
  assert.equal(committed.revision, n + 2)
  assert.equal(capturePersistenceGeneration().hydrated, n)
  assert.equal(capturePersistenceRuntimeRevision(), 0)
})
test('generation: runtime slice and public setState reserve before subscribers, then issued revisions survive ABA/fresh read', async () => {
  const { useStore } = await import('./index')
  const initial = capturePersistenceGeneration()
  const observed: { current: number; hydrated: number }[] = []
  const unsubscribe = useStore.subscribe((s, prev) => {
    if (s.model !== prev.model && s.model.startsWith('GEN-')) observed.push(capturePersistenceGeneration())
  })
  try {
    useStore.getState().setModel('GEN-A')
    const journal = capturePersistenceGeneration()
    assert.equal(observed.length, 1)
    assert.ok(observed[0].current > initial.current)
    assert.ok(journal.current > observed[0].current)
    assert.equal(journal.hydrated, initial.hydrated)
    // Durable state has NOT been written just because current issued a watermark.
    const beforeFlush = idbStorage(() => {})
    await beforeFlush.getItem('tetrafree')
    assert.ok(beforeFlush.captureGeneration().hydrated < journal.current)
    useStore.setState({ model: 'GEN-B' })
    const middle = capturePersistenceGeneration()
    assert.ok(observed[1].current > journal.current)
    assert.ok(middle.current > observed[1].current)
    useStore.getState().setModel('GEN-A')
    const aba = capturePersistenceGeneration()
    assert.ok(aba.current > middle.current)
    await flushPersistence()
    const committed = JSON.parse(disk.get('tetrafree')!)
    assert.equal(committed.state.model, 'GEN-A')
    assert.ok(committed.revision >= aba.current)
    const fresh = idbStorage(() => {})
    await fresh.getItem('tetrafree')
    // A real newly-loaded durable revision, not current's runtime reservations, proves journal obsolete.
    assert.equal(fresh.captureGeneration().hydrated, committed.revision)
    assert.ok(fresh.captureGeneration().hydrated >= journal.current)
    assert.equal(capturePersistenceGeneration().hydrated, initial.hydrated)
  } finally {
    unsubscribe()
  }
})

test('generation: failed durable write advances current issuance but cannot manufacture hydrated proof', async () => {
  reset()
  disk.set('tetrafree', raw('STILL-DURABLE', 52))
  const storage = await loaded()
  failWrite = true
  ls.failWrite = true
  storage.setItem('tetrafree', value('UNSAVED'))
  assert.deepEqual(storage.captureGeneration(), { current: 53, hydrated: 52 })
  await assert.rejects(storage.flush())
  assert.deepEqual(storage.captureGeneration(), { current: 53, hydrated: 52 })
  assert.equal(JSON.parse(disk.get('tetrafree')!).revision, 52)
  const fresh = idbStorage(() => {})
  await fresh.getItem('tetrafree')
  assert.equal(fresh.captureGeneration().hydrated, 52)
  assert.ok(fresh.captureGeneration().hydrated < storage.captureGeneration().current)
  failWrite = false
  ls.failWrite = false
  await storage.flush()
})

test('runtime revision: migration/flush stay zero; real human and public mutations are visible before subscriber replay', async () => {
  reset()
  const { useStore, hydrateStore } = await import('./index')
  const n = capturePersistenceGeneration().current + 20
  disk.set('tetrafree', JSON.stringify({ ...value('RUNTIME-HYDRATION', n), version: 6 }))
  ls.setItem('tetrafree:authority', JSON.stringify({ revision: n, backend: 'idb' }))
  await hydrateStore()
  assert.deepEqual(capturePersistenceGeneration(), { current: n + 1, hydrated: n })
  assert.equal(capturePersistenceRuntimeRevision(), 0)
  await flushPersistence()
  assert.equal(capturePersistenceRuntimeRevision(), 0)
  const observations: number[] = []
  const unsubscribe = useStore.subscribe((s, prev) => {
    if (s.model !== prev.model && s.model.startsWith('RUNTIME-'))
      observations.push(capturePersistenceRuntimeRevision())
  })
  try {
    useStore.getState().setModel('RUNTIME-HUMAN')
    assert.equal(capturePersistenceRuntimeRevision(), 1)
    assert.deepEqual(observations, [1])
    useStore.setState({ model: 'RUNTIME-PUBLIC' })
    assert.equal(capturePersistenceRuntimeRevision(), 2)
    assert.deepEqual(observations, [1, 2])
    await flushPersistence()
    assert.equal(capturePersistenceRuntimeRevision(), 2)
    // Another adapter's own reads, reservations and writes cannot reset the root getter.
    const isolated = await loaded()
    isolated.reserveRevision()
    assert.equal(isolated.captureRuntimeRevision(), 1)
    isolated.setItem('tetrafree', value('ISOLATED-ADAPTER'))
    await isolated.flush()
    assert.equal(capturePersistenceRuntimeRevision(), 2)
    // Explicit successful rehydration starts a new runtime epoch, not a synthetic persistence write.
    await hydrateStore()
    assert.equal(capturePersistenceRuntimeRevision(), 0)
  } finally {
    unsubscribe()
  }
})

test('runtime coverage: actual createChat, renameChat and pushMsg are guarded after hydration', async () => {
  reset()
  const { useStore, hydrateStore } = await import('./index')
  const { emptyProject } = await import('../data/seed')
  const pid = 'runtime-chat-coverage'
  const n = capturePersistenceGeneration().current + 20
  disk.set(
    'tetrafree',
    JSON.stringify({
      state: {
        ...initialPersisted(),
        projects: [emptyProject({ id: pid, name: 'Chat coverage' })],
        authed: true,
        projectId: pid,
        screen: 'workspace',
        center: { kind: 'empty' },
      },
      version: 7,
      revision: n,
    }),
  )
  await hydrateStore()
  assert.equal(capturePersistenceRuntimeRevision(), 0)
  const observed: number[] = []
  const stop = useStore.subscribe((s, prev) => {
    if (s.projects !== prev.projects) observed.push(capturePersistenceRuntimeRevision())
  })
  try {
    const id = useStore
      .getState()
      .createChat({ title: 'Human created', creator: { kind: 'human', id: 'me' }, agents: [] }, pid)
    assert.equal(useStore.getState().projects[0].chats[0].id, id)
    assert.ok(capturePersistenceRuntimeRevision() > 0, 'createChat must block whole-journal replay')
    assert.ok(observed[0] > 0, 'createChat subscriber must see runtime mutation before replay')
    const beforeRename = capturePersistenceRuntimeRevision()
    useStore.getState().renameChat(id, 'Human renamed')
    assert.equal(useStore.getState().projects[0].chats[0].title, 'Human renamed')
    assert.ok(capturePersistenceRuntimeRevision() > beforeRename)
    const beforeMessage = capturePersistenceRuntimeRevision()
    useStore.getState().pushMsg(id, { id: 'coverage-msg', kind: 'sys', text: 'Local message', at: 123 }, pid)
    assert.equal(useStore.getState().projects[0].chats[0].messages.slice(-1)[0]?.id, 'coverage-msg')
    assert.ok(capturePersistenceRuntimeRevision() > beforeMessage)
    assert.equal(observed.length, 3)
    assert.ok(observed.every((revision) => revision > 0))
    await flushPersistence()
  } finally {
    stop()
  }
})

test('runtime coverage: representative actual mutation from every slice is reserved before notifications', async (t) => {
  reset()
  const { useStore, hydrateStore } = await import('./index')
  const { emptyProject } = await import('../data/seed')
  const pid = 'all-slices-coverage'
  const actions: [string, () => unknown, () => void][] = [
    [
      'ui',
      () => useStore.getState().setRightWidth(57),
      () => assert.equal(useStore.getState().rightWidth, 57),
    ],
    [
      'projects',
      () =>
        useStore.getState().up((p) => {
          p.desc = 'updated'
        }, pid),
      () => assert.equal(useStore.getState().projects[0].desc, 'updated'),
    ],
    [
      'files',
      () => useStore.getState().writeFile('coverage.txt', 'file content', pid),
      () => assert.equal(useStore.getState().projects[0].files['coverage.txt'], 'file content'),
    ],
    [
      'chats',
      () =>
        useStore
          .getState()
          .createChat({ title: 'Coverage chat', creator: { kind: 'human', id: 'me' }, agents: [] }, pid),
      () => assert.equal(useStore.getState().projects[0].chats.length, 1),
    ],
    [
      'docs',
      () => useStore.getState().createDoc(pid),
      () => assert.equal(useStore.getState().projects[0].docs.length, 1),
    ],
    [
      'tasks',
      () => useStore.getState().saveTask({ title: 'Coverage task' }, pid),
      () => assert.equal(useStore.getState().projects[0].tasks.length, 1),
    ],
    [
      'settings',
      () => useStore.getState().setModel('coverage-model'),
      () => assert.equal(useStore.getState().model, 'coverage-model'),
    ],
    [
      'memory',
      () => useStore.getState().remember({ text: 'Coverage memory', kind: 'fact', by: 'user' }, pid),
      () => assert.equal(useStore.getState().projects[0].memory.length, 1),
    ],
  ]
  for (const [name, mutate, verify] of actions)
    await t.test(name, async () => {
      const n = capturePersistenceGeneration().current + 20
      disk.set(
        'tetrafree',
        JSON.stringify({
          state: {
            ...initialPersisted(),
            projects: [emptyProject({ id: pid, name: 'All slices' })],
            authed: true,
            projectId: pid,
            screen: 'workspace',
            center: { kind: 'empty' },
          },
          version: 7,
          revision: n,
        }),
      )
      await hydrateStore()
      assert.equal(capturePersistenceRuntimeRevision(), 0)
      const observed: number[] = []
      const stop = useStore.subscribe(() => observed.push(capturePersistenceRuntimeRevision()))
      try {
        mutate()
        verify()
        assert.ok(capturePersistenceRuntimeRevision() > 0, name + ' mutation must be guarded')
        assert.ok(observed.length > 0)
        assert.ok(
          observed.every((revision) => revision > 0),
          name + ' subscriber saw an unguarded mutation',
        )
        await flushPersistence()
      } finally {
        stop()
      }
    })
})
