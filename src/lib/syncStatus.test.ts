/** Real store/sync modules with benign in-memory transport and checkpoint delegates; not native persistence E2E. */
import test, { before, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { emptyProject } from '../data/seed'
const values = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value)
    },
    removeItem: (key: string) => {
      values.delete(key)
    },
    key: (i: number) => [...values.keys()][i] ?? null,
    get length() {
      return values.size
    },
  },
})
let store: typeof import('../store'),
  sync: typeof import('./sync'),
  status: typeof import('./syncStatus'),
  backend: typeof import('./backend'),
  persistence: typeof import('../store/persistence'),
  token: typeof import('./token')
let seq = 0,
  flush: () => Promise<void> = async () => {}
const fetch0 = globalThis.fetch
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
before(async () => {
  const { initialPersisted } = await import('../store/defaults')
  values.set('tetrafree', JSON.stringify({ state: initialPersisted(), version: 7, revision: 1 }))
  values.set('tetrafree:authority', JSON.stringify({ backend: 'ls', revision: 1 }))
  store = await import('../store')
  await store.hydrateStore()
  backend = await import('./backend')
  sync = await import('./sync')
  status = await import('./syncStatus')
  persistence = await import('../store/persistence')
  token = await import('./token')
  persistence.registerPersistenceCheckpoint(() => flush())
})
afterEach(() => {
  sync.stopSync()
  globalThis.fetch = fetch0
  flush = async () => {}
})
function setup() {
  token.setToken('benign-session')
  backend.useBackend.setState({
    status: 'online',
    base: 'https://sync.invalid',
    info: { local: true } as never,
    lastSync: Date.now(),
    lastError: undefined,
  })
  const p = emptyProject({
    id: 'health-' + ++seq,
    name: 'PRIVATE_PROJECT_NAME',
    path: 'C:/PRIVATE_PATH',
    files: { note: 'PRIVATE_CONTENT' },
  })
  const q = emptyProject({ id: 'other-' + seq, name: 'other', path: 'C:/other', files: {} })
  store.useStore.setState((s) => {
    s.projects = [p, q]
    s.projectId = p.id
    s.settings.backendSync = true
  })
  values.set('tf-sync:' + p.id, JSON.stringify({ note: backend.fnv('PRIVATE_CONTENT') }))
  globalThis.fetch = async () => json({ hashes: { note: backend.fnv('PRIVATE_CONTENT') }, dir: p.path })
  return { p, q }
}
test('desired: disk proof is scoped to pid and invalidates on unsynced local edit', async () => {
  const { p, q } = setup()
  await sync.reconcile(p.id)
  assert.equal(status.captureSyncHealth(p.id).disk, 'verified')
  assert.equal(status.captureSyncHealth(q.id).disk, 'unchecked')
  store.useStore.getState().writeFile('note', 'human edit', p.id)
  assert.equal(status.captureSyncHealth(p.id).disk, 'pending')
  assert.equal(status.captureSyncHealth(p.id).lastDiskCheckAt, undefined)
  assert.equal(status.captureSyncHealth(p.id).checkpoint, 'unconfirmed')
})
test('desired: concurrent request is checking, not error or another queued writer', async () => {
  const { p } = setup()
  let resolve!: (response: Response) => void
  globalThis.fetch = async () =>
    new Promise<Response>((done) => {
      resolve = done
    })
  const active = sync.reconcile(p.id)
  while (!resolve) await new Promise((done) => setImmediate(done))
  assert.equal(status.captureSyncHealth(p.id).disk, 'checking')
  assert.equal(status.captureSyncHealth(p.id).canRetry, false)
  assert.equal(await sync.reconcile(p.id), null)
  resolve(json({ hashes: { note: backend.fnv('PRIVATE_CONTENT') }, dir: p.path }))
  await active
})
test('desired: truncated scan never reports all files verified', async () => {
  const { p } = setup()
  globalThis.fetch = async () =>
    json({ hashes: { note: backend.fnv('PRIVATE_CONTENT') }, truncated: true, dir: p.path })
  await sync.reconcile(p.id)
  const health = status.captureSyncHealth(p.id)
  assert.equal(health.disk, 'partial')
  assert.equal(health.truncated, true)
  assert.equal(health.lastDiskCheckAt, undefined)
})
test('desired: failed checkpoint is distinct from disk verification', async () => {
  const { p } = setup()
  flush = async () => {
    throw new Error('PRIVATE_ERROR_PATH')
  }
  await sync.reconcile(p.id)
  const health = status.captureSyncHealth(p.id)
  assert.equal(health.disk, 'error')
  assert.equal(health.checkpoint, 'failed')
  assert.ok(!JSON.stringify(health).includes('PRIVATE'))
})
test('desired: backend and folder changes invalidate old hasSynced and health', async () => {
  const { p } = setup()
  await sync.reconcile(p.id)
  assert.equal(sync.hasSynced(p.id), true)
  backend.useBackend.setState({ base: 'https://new.invalid' })
  assert.equal(sync.hasSynced(p.id), false)
  assert.equal(status.captureSyncHealth(p.id).disk, 'unchecked')
})
test('checkpoint-only observation never claims disk or cloud confirmation; health is a whitelist', async () => {
  const { p } = setup()
  backend.useBackend.setState({ status: 'offline' })
  await status.checkpointProject(p.id)
  const health = status.captureSyncHealth(p.id)
  assert.equal(health.disk, 'unavailable')
  assert.equal(health.checkpoint, 'confirmed')
  assert.deepEqual(
    Object.keys(health).sort(),
    [
      'backend',
      'canRetry',
      'checkpoint',
      'conflicts',
      'disk',
      'failedFiles',
      'projectId',
      'truncated',
    ].sort(),
  )
  assert.ok(!JSON.stringify(health).includes('PRIVATE'))
  assert.match(status.syncHealthLabel(health).detail, /не подтверждает синхронизацию облака/)
})

test('desired: token ABA invalidates disk proof and stale sync errors never poison new context', async () => {
  const { p } = setup()
  await sync.reconcile(p.id)
  assert.equal(status.captureSyncHealth(p.id).disk, 'verified')
  let resolve!: (response: Response) => void
  globalThis.fetch = async () =>
    new Promise<Response>((done) => {
      resolve = done
    })
  const pending = sync.reconcile(p.id)
  while (!resolve) await new Promise((done) => setImmediate(done))
  token.setToken('benign-temp')
  token.setToken('benign-session')
  backend.useBackend.setState({ lastError: undefined })
  resolve(json({ hashes: {}, dir: p.path }))
  await pending
  assert.equal(status.captureSyncHealth(p.id).disk, 'unchecked')
  assert.equal(sync.hasSynced(p.id), false)
  assert.equal(backend.useBackend.getState().lastError, undefined)
})
test('desired: one completed project cannot clear another project running state', async () => {
  const { p, q } = setup()
  const replies = new Map<string, (response: Response) => void>()
  globalThis.fetch = async (url) =>
    new Promise<Response>((done) => {
      replies.set(new URL(String(url)).searchParams.get('id')!, done)
    })
  const first = sync.reconcile(p.id),
    second = sync.reconcile(q.id)
  while (replies.size < 2) await new Promise((done) => setImmediate(done))
  replies.get(p.id)!(json({ hashes: { note: backend.fnv('PRIVATE_CONTENT') }, dir: p.path }))
  await first
  assert.equal(backend.useBackend.getState().syncing, true)
  assert.equal(status.captureSyncHealth(q.id).disk, 'checking')
  assert.equal(status.captureSyncHealth(p.id).disk, 'verified')
  replies.get(q.id)!(json({ hashes: {}, dir: q.path }))
  await second
  assert.equal(backend.useBackend.getState().syncing, false)
})
test('desired: safe retry offline only checkpoints, preserves baseline and never sends network IO', async () => {
  const { p } = setup()
  const baseline = values.get('tf-sync:' + p.id)
  backend.useBackend.setState({ status: 'offline' })
  let requests = 0
  globalThis.fetch = async () => {
    requests++
    throw new Error('must not send')
  }
  await sync.retryProjectSync(p.id)
  assert.equal(requests, 0)
  assert.equal(values.get('tf-sync:' + p.id), baseline)
  assert.equal(status.captureSyncHealth(p.id).checkpoint, 'confirmed')
  assert.equal(status.captureSyncHealth(p.id).disk, 'unavailable')
})
test('desired: retry during running reconcile does not queue a second attempt', async () => {
  const { p } = setup()
  let resolve!: (response: Response) => void,
    requests = 0
  globalThis.fetch = async () => {
    requests++
    return new Promise<Response>((done) => {
      resolve = done
    })
  }
  const first = sync.reconcile(p.id)
  while (!resolve) await new Promise((done) => setImmediate(done))
  await sync.retryProjectSync(p.id)
  resolve(json({ hashes: { note: backend.fnv('PRIVATE_CONTENT') }, dir: p.path }))
  await first
  assert.equal(requests, 1)
  assert.equal(status.captureSyncHealth(p.id).disk, 'verified')
})

test('desired: edit during hash await cannot be stamped verified from the post-await live file reference', async () => {
  const { p } = setup()
  let resolve!: (response: Response) => void
  globalThis.fetch = async () =>
    new Promise<Response>((done) => {
      resolve = done
    })
  const result = sync.reconcile(p.id)
  while (!resolve) await new Promise((done) => setImmediate(done))
  store.useStore.getState().writeFile('note', 'fresh while scanning', p.id)
  resolve(json({ hashes: { note: backend.fnv('PRIVATE_CONTENT') }, dir: p.path }))
  await result
  assert.equal(status.captureSyncHealth(p.id).disk, 'pending')
  assert.equal(status.captureSyncHealth(p.id).lastDiskCheckAt, undefined)
})

test('desired: explicit safe retry actually retries unchanged files after transient permission failure', async () => {
  const { p } = setup()
  store.useStore.getState().writeFile('note', 'retry text', p.id)
  let disk = 'PRIVATE_CONTENT',
    batches = 0
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('/hashes')) return json({ hashes: { note: backend.fnv(disk) }, dir: p.path })
    const body = JSON.parse(String(options?.body))
    batches++
    if (batches === 1)
      return json({ failed: [{ path: 'note', code: 'EACCES', error: 'benign permission fixture' }] })
    disk = body.write.note
    return json({ failed: [] })
  }
  await sync.reconcile(p.id)
  assert.equal(status.captureSyncHealth(p.id).disk, 'partial')
  await sync.retryProjectSync(p.id)
  assert.equal(batches, 2)
  assert.equal(disk, 'retry text')
  assert.equal(status.captureSyncHealth(p.id).disk, 'verified')
})
