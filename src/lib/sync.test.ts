import test, { before, after, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import type { Project } from '../types'
import { emptyProject } from '../data/seed'

class MemoryStorage {
  values = new Map<string, string>()
  getItem(k: string) {
    return this.values.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.values.set(k, v)
  }
  removeItem(k: string) {
    this.values.delete(k)
  }
  clear() {
    this.values.clear()
  }
  key(i: number) {
    return [...this.values.keys()][i] ?? null
  }
  get length() {
    return this.values.size
  }
}
const ls = new MemoryStorage()
Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true })
let store: typeof import('../store'),
  sync: typeof import('./sync'),
  backend: typeof import('./backend'),
  persistence: typeof import('../store/persistence')
let seq = 0
const fetch0 = globalThis.fetch
let flush: () => Promise<void>
const json = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const setup = (
  files: Record<string, string>,
  disk: Record<string, string>,
  base: Record<string, string> = files,
) => {
  const id = 'sync-test-' + ++seq,
    path = 'C:/tests/' + id
  const p = emptyProject({ id, name: id, path, files })
  ls.setItem(
    'tf-sync:' + id,
    JSON.stringify(Object.fromEntries(Object.entries(base).map(([k, v]) => [k, backend.fnv(v)]))),
  )
  store.useStore.setState((s) => {
    s.projects = [p]
    s.projectId = id
    s.settings.backendSync = true
  })
  return { p, disk }
}
before(async () => {
  const { initialPersisted } = await import('../store/defaults')
  ls.setItem('tetrafree', JSON.stringify({ state: initialPersisted(), version: 7, revision: 1 }))
  ls.setItem('tetrafree:authority', JSON.stringify({ backend: 'ls', revision: 1 }))
  store = await import('../store')
  await store.hydrateStore()
  backend = await import('./backend')
  sync = await import('./sync')
  persistence = await import('../store/persistence')
  const { setToken } = await import('./token')
  setToken('test-only-token')
  backend.useBackend.setState({
    status: 'online',
    base: 'http://sync.invalid',
    info: { local: true } as never,
  })
  flush = async () => {
    ls.setItem('test-durable', JSON.stringify(store.useStore.getState().projects))
  }
  persistence.registerPersistenceCheckpoint(() => flush())
})
afterEach(() => {
  sync.stopSync()
  globalThis.fetch = fetch0
})
after(() => {
  sync.stopSync()
  globalThis.fetch = fetch0
})
const now = () => store.useStore.getState().projects[0]
const hashReply = (p: Project, disk: Record<string, string>) =>
  json({ dir: p.path, hashes: Object.fromEntries(Object.entries(disk).map(([k, v]) => [k, backend.fnv(v)])) })

test('ST06: drop-only hash await cannot delete a concurrently edited local file', async () => {
  const { p, disk } = setup({ a: 'old', b: 'same' }, { b: 'same' })
  let resolve!: (r: Response) => void
  globalThis.fetch = async () =>
    new Promise<Response>((r) => {
      resolve = r
    })
  const result = sync.reconcile(p.id)
  while (!resolve) await new Promise((r) => setImmediate(r))
  store.useStore.getState().writeFile('a', 'NEW', p.id)
  resolve(hashReply(p, disk))
  await result
  assert.equal(now().files.a, 'NEW')
  assert.equal(JSON.parse(ls.getItem('tf-sync:' + p.id)!).a, backend.fnv('old'))
})
test('ST06: drop concurrent with pull awaits is compare-before-delete; read hash must match scan', async () => {
  const { p, disk } = setup({ a: 'old', b: 'old' }, { b: 'remote' })
  let reads = 0
  globalThis.fetch = async (url) => {
    if (String(url).includes('/hashes')) return hashReply(p, disk)
    reads++
    store.useStore.getState().writeFile('a', 'NEW', p.id)
    return json({ files: { b: 'changed after scan' } })
  }
  await sync.reconcile(p.id)
  assert.equal(reads, 1)
  assert.equal(now().files.a, 'NEW')
  assert.equal(now().files.b, 'old')
})
test('ST07: foreign uncommitted bytes are durable before overwrite, unique Windows-safe copy, CAS forwarded', async () => {
  const { p, disk } = setup(
    { a: 'mine', 'A.DISK-CONFLICT': 'precious' },
    { a: 'theirs', 'A.DISK-CONFLICT': 'precious' },
    { a: 'base', 'A.DISK-CONFLICT': 'precious' },
  )
  let batch = false
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/hashes')) return hashReply(p, disk)
    if (String(url).endsWith('/read')) return json({ files: { a: 'theirs' } })
    if (String(url).endsWith('/batch')) {
      batch = true
      const body = JSON.parse(String(opts!.body))
      assert.deepEqual(body.expectedHashes, { a: backend.fnv('theirs') })
      const durable = JSON.parse(ls.getItem('test-durable')!)[0]
      assert.equal(durable.files['a.disk-conflict.2'], 'theirs')
      assert.equal(durable.files['A.DISK-CONFLICT'], 'precious')
      return json({ failed: [] })
    }
    throw new Error('unexpected ' + url)
  }
  await sync.reconcile(p.id)
  assert.equal(batch, true)
  assert.equal(now().files['a.disk-conflict.2'], 'theirs')
  assert.ok(!store.useStore.getState().toasts.some((t) => t.desc?.includes('Старая — в Git')))
})
test('ST07: recovery read/scan mismatch blocks destructive write and retains old baseline', async () => {
  const { p, disk } = setup({ a: 'mine' }, { a: 'theirs' }, { a: 'base' })
  let batches = 0
  globalThis.fetch = async (url) => {
    if (String(url).includes('/hashes')) return hashReply(p, disk)
    if (String(url).endsWith('/read')) return json({ files: { a: 'new foreign edit' } })
    batches++
    return json({ failed: [] })
  }
  await sync.reconcile(p.id)
  assert.equal(batches, 0)
  assert.equal(now().files.a, 'mine')
  assert.equal(JSON.parse(ls.getItem('tf-sync:' + p.id)!).a, backend.fnv('base'))
})
test('checkpoint reject never advances baseline or writes unrecoverable disk conflict', async () => {
  const { p, disk } = setup({ a: 'mine' }, { a: 'theirs' }, { a: 'base' })
  const old = ls.getItem('tf-sync:' + p.id)
  let batches = 0
  flush = async () => {
    throw new Error('quota')
  }
  globalThis.fetch = async (url) => {
    if (String(url).includes('/hashes')) return hashReply(p, disk)
    if (String(url).endsWith('/read')) return json({ files: { a: 'theirs' } })
    batches++
    return json({ failed: [] })
  }
  try {
    assert.equal(await sync.reconcile(p.id), null)
    assert.equal(batches, 0)
    assert.equal(ls.getItem('tf-sync:' + p.id), old)
  } finally {
    flush = async () => {
      ls.setItem('test-durable', JSON.stringify(store.useStore.getState().projects))
    }
  }
})
test('CAS conflict response does not acknowledge planned bytes or permanently suppress next attempt', async () => {
  const { p, disk } = setup({ a: 'mine' }, { a: 'base' }, { a: 'base' })
  globalThis.fetch = async (url) =>
    String(url).includes('/hashes')
      ? hashReply(p, disk)
      : json({ failed: [{ path: 'a', code: 'CONFLICT', error: 'changed' }] })
  const result = await sync.reconcile(p.id)
  assert.equal(result?.pushed, 0)
  assert.equal(JSON.parse(ls.getItem('tf-sync:' + p.id)!).a, backend.fnv('base'))
})
test('folder switch while hashes awaits cancels stale IO and checkpoint', async () => {
  const { p, disk } = setup({ a: 'mine' }, { a: 'base' }, { a: 'base' })
  let resolve!: (r: Response) => void
  globalThis.fetch = async () =>
    new Promise<Response>((r) => {
      resolve = r
    })
  const result = sync.reconcile(p.id)
  while (!resolve) await new Promise((r) => setImmediate(r))
  store.useStore.getState().up((x) => {
    x.path = 'C:/other'
  }, p.id)
  resolve(hashReply(p, disk))
  assert.equal(await result, null)
  assert.equal(now().path, 'C:/other')
})

test('generation drift during batch keeps newer local bytes and old disk baseline', async () => {
  const { p, disk } = setup({ a: 'sent' }, { a: 'base' }, { a: 'base' })
  const old = ls.getItem('tf-sync:' + p.id)
  globalThis.fetch = async (url) => {
    if (String(url).includes('/hashes')) return hashReply(p, disk)
    store.useStore.getState().writeFile('a', 'newer local', p.id)
    return json({ failed: [] })
  }
  assert.equal(await sync.reconcile(p.id), null)
  assert.equal(now().files.a, 'newer local')
  assert.equal(ls.getItem('tf-sync:' + p.id), old)
})
test('rejected recovery checkpoint is retryable without unbounded identical recovery copies', async () => {
  const { p, disk } = setup({ 'src/a': 'mine' }, { 'src/a': 'theirs' }, { 'src/a': 'base' })
  store.useStore.getState().up((x) => {
    x.dirs = ['src']
  }, p.id)
  flush = async () => {
    throw new Error('quota')
  }
  let batches = 0
  globalThis.fetch = async (url) => {
    if (String(url).includes('/hashes')) return hashReply(p, disk)
    if (String(url).endsWith('/read')) return json({ files: { 'src/a': 'theirs' } })
    batches++
    return json({ failed: [] })
  }
  try {
    await sync.reconcile(p.id)
    await sync.reconcile(p.id)
    assert.equal(batches, 0)
    assert.equal(Object.keys(now().files).filter((k) => k.includes('disk-conflict')).length, 1)
    assert.equal(now().files['src/a.disk-conflict'], 'theirs')
  } finally {
    flush = async () => {
      ls.setItem('test-durable', JSON.stringify(store.useStore.getState().projects))
    }
  }
})

test('F03 desired: accepted write cannot absorb undo; restore during remove is sent back to disk', async () => {
  for (const removing of [false, true]) {
    const { p, disk } = setup({ note: 'base' }, { note: 'base' })
    store.useStore.getState().up((x) => {
      if (removing) delete x.files.note
      else x.files.note = 'sent'
    }, p.id)
    let batches = 0
    globalThis.fetch = async (url, opts) => {
      if (String(url).includes('/hashes')) return hashReply(p, disk)
      const body = JSON.parse(String(opts?.body))
      if (String(url).endsWith('/batch')) {
        Object.assign(disk, body.write)
        for (const k of body.remove) delete disk[k]
        if (++batches === 1) store.useStore.getState().writeFile('note', 'base', p.id)
        return json({ dir: p.path, failed: [] })
      }
      return json({ files: Object.fromEntries(body.paths.map((k: string) => [k, disk[k] ?? null])) })
    }
    await sync.reconcile(p.id)
    sync.stopSync()
    await sync.reconcile(p.id)
    sync.stopSync()
    assert.equal(now().files.note, 'base')
    assert.equal(disk.note, 'base')
    assert.equal(batches, 2)
  }
})
test('F03 desired: restart after accepted batch + rejected checkpoint restores persisted undo intent', async () => {
  const { p, disk } = setup({ note: 'base' }, { note: 'base' })
  store.useStore.getState().writeFile('note', 'sent', p.id)
  const durable = JSON.stringify({
    state: persistence.partialize(store.useStore.getState()),
    version: 7,
    revision: 2,
  })
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/hashes')) return hashReply(p, disk)
    const body = JSON.parse(String(opts?.body))
    Object.assign(disk, body.write)
    store.useStore.getState().writeFile('note', 'base', p.id)
    flush = async () => {
      throw new Error('checkpoint rejected')
    }
    return json({ dir: p.path, failed: [] })
  }
  try {
    await sync.reconcile(p.id)
    sync.stopSync()
    const { execFileSync } = await import('node:child_process'),
      { fileURLToPath } = await import('node:url')
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        ['--import', 'tsx', fileURLToPath(new URL('./syncRestart.fixture.ts', import.meta.url))],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            SYNC_RESTART_INPUT: JSON.stringify({
              kind: 'disk',
              storage: [...ls.values],
              durable,
              server: { files: disk, dirs: [], rev: 1 },
            }),
          },
          encoding: 'utf8',
        },
      ).trim(),
    )
    assert.equal(result.files.note, 'base')
    assert.equal(result.server.files.note, 'base')
    assert.equal(result.batches, 1)
  } finally {
    flush = async () => {
      ls.setItem('test-durable', JSON.stringify(store.useStore.getState().projects))
    }
  }
})

test('durable disk redo equal to journal.prior is not replaced by older undo journal on restart', async () => {
  const { p, disk } = setup({ note: 'base' }, { note: 'base' })
  store.useStore.getState().writeFile('note', 'sent', p.id)
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/hashes')) return hashReply(p, disk)
    const body = JSON.parse(String(opts?.body))
    Object.assign(disk, body.write)
    store.useStore.getState().writeFile('note', 'base', p.id)
    flush = async () => {
      throw new Error('checkpoint rejected')
    }
    return json({ dir: p.path, failed: [] })
  }
  try {
    await sync.reconcile(p.id)
    sync.stopSync()
    const key = [...ls.values.keys()].find(
      (k) => k.startsWith('tf-sync-intent:' + p.id + ':') && !k.endsWith(':authority'),
    )!
    const entry = JSON.parse(ls.getItem(key)!).value
    assert.equal(entry.local.note, 'base')
    store.useStore.getState().writeFile('note', 'sent', p.id)
    const appStorage = store.useStore.persist.getOptions()
      .storage as import('../store/persistence').DurableStorage
    const issuedBeforeCommit = persistence.capturePersistenceGeneration().current
    appStorage.setItem('tetrafree', {
      state: persistence.partialize(store.useStore.getState()),
      version: persistence.PERSIST_VERSION,
    })
    await appStorage.flush()
    const durable = ls.getItem('tetrafree')!
    assert.ok(JSON.parse(durable).revision > entry.appRevision)
    assert.ok(JSON.parse(durable).revision >= issuedBeforeCommit)
    const { execFileSync } = await import('node:child_process'),
      { fileURLToPath } = await import('node:url')
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        ['--import', 'tsx', fileURLToPath(new URL('./syncRestart.fixture.ts', import.meta.url))],
        {
          env: {
            ...process.env,
            SYNC_RESTART_INPUT: JSON.stringify({
              kind: 'disk',
              storage: [...ls.values],
              durable,
              server: { files: disk, dirs: [], rev: 1 },
            }),
          },
          encoding: 'utf8',
        },
      ).trim(),
    )
    assert.equal(result.files.note, 'sent')
    assert.equal(result.server.files.note, 'sent')
    const legacyStorage = [...ls.values].map(([k, v]): [string, string] => {
      if (k !== key) return [k, v]
      const raw = JSON.parse(v)
      delete raw.value.appRevision
      return [k, JSON.stringify(raw)]
    })
    const legacy = JSON.parse(
      execFileSync(
        process.execPath,
        ['--import', 'tsx', fileURLToPath(new URL('./syncRestart.fixture.ts', import.meta.url))],
        {
          env: {
            ...process.env,
            SYNC_RESTART_INPUT: JSON.stringify({
              kind: 'disk',
              storage: legacyStorage,
              durable,
              server: { files: disk, dirs: [], rev: 1 },
            }),
          },
          encoding: 'utf8',
        },
      ).trim(),
    )
    assert.equal(legacy.files.note, 'sent')
    assert.equal(legacy.batches, 0)
    const copy = JSON.parse(legacy.files['files.journal-recovery.json'])
    assert.equal(copy.desired.note, 'base')
  } finally {
    flush = async () => {
      ls.setItem('test-durable', JSON.stringify(store.useStore.getState().projects))
    }
  }
})

test('A01 desired: uncertain first creation is not silently resurrected after local undo', async () => {
  const { p, disk } = setup({}, {})
  store.useStore.getState().writeFile('new-note.txt', 'new text', p.id)
  let batches = 0
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/hashes')) return hashReply(p, disk)
    const body = JSON.parse(String(opts?.body))
    if (String(url).endsWith('/batch')) {
      Object.assign(disk, body.write)
      for (const k of body.remove) delete disk[k]
      if (++batches === 1) {
        store.useStore.getState().up((x) => {
          delete x.files['new-note.txt']
        }, p.id)
        throw new Error('response lost')
      }
      return json({ dir: p.path, failed: [] })
    }
    return json({ files: Object.fromEntries(body.paths.map((k: string) => [k, disk[k] ?? null])) })
  }
  await sync.reconcile(p.id)
  sync.stopSync()
  await sync.reconcile(p.id)
  sync.stopSync()
  assert.equal(now().files['new-note.txt'], undefined)
  assert.equal(disk['new-note.txt'], undefined)
  assert.ok(Object.entries(now().files).some(([k, v]) => k.includes('disk-conflict') && v === 'new text'))
})

test('A01 desired: failed CAS on uncertain creation removal retains dirty deletion for following retry', async () => {
  const { p, disk } = setup({}, {})
  store.useStore.getState().writeFile('new-note', 'sent', p.id)
  let batches = 0
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/hashes')) return hashReply(p, disk)
    const body = JSON.parse(String(opts?.body))
    if (String(url).endsWith('/read'))
      return json({ files: Object.fromEntries(body.paths.map((k: string) => [k, disk[k] ?? null])) })
    batches++
    if (batches === 2) {
      disk['new-note'] = 'new foreign'
      return json({ failed: [{ path: 'new-note', code: 'CONFLICT', error: 'changed' }] })
    }
    Object.assign(disk, body.write)
    for (const k of body.remove) delete disk[k]
    if (batches === 1) {
      store.useStore.getState().up((x) => {
        delete x.files['new-note']
      }, p.id)
      throw new Error('response lost')
    }
    return json({ failed: [] })
  }
  for (let i = 0; i < 3; i++) {
    await sync.reconcile(p.id)
    sync.stopSync()
    assert.equal(now().files['new-note'], undefined)
  }
  assert.equal(disk['new-note'], undefined)
  assert.ok(Object.values(now().files).includes('new foreign'))
})

test('A04 desired: fresh runtime human file edit after hydration blocks whole disk journal replay on every retry', async () => {
  const { p, disk } = setup({ note: 'base' }, { note: 'base' })
  store.useStore.getState().writeFile('note', 'sent', p.id)
  const storage = store.useStore.persist.getOptions().storage as import('../store/persistence').DurableStorage
  storage.setItem('tetrafree', {
    state: persistence.partialize(store.useStore.getState()),
    version: persistence.PERSIST_VERSION,
  })
  await storage.flush()
  const durable = ls.getItem('tetrafree')!
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('/hashes')) return hashReply(p, disk)
    const body = JSON.parse(String(opts?.body))
    Object.assign(disk, body.write)
    store.useStore.getState().writeFile('note', 'base', p.id)
    flush = async () => {
      throw new Error('checkpoint rejected')
    }
    return json({ failed: [] })
  }
  try {
    await sync.reconcile(p.id)
    sync.stopSync()
    const { execFileSync } = await import('node:child_process'),
      { fileURLToPath } = await import('node:url')
    const result = JSON.parse(
      execFileSync(
        process.execPath,
        ['--import', 'tsx', fileURLToPath(new URL('./syncRestart.fixture.ts', import.meta.url))],
        {
          env: {
            ...process.env,
            SYNC_RESTART_INPUT: JSON.stringify({
              kind: 'disk',
              storage: [...ls.values],
              durable,
              retries: 2,
              runtimeHuman: { path: 'note', text: 'human fresh' },
              server: { files: disk, dirs: [], rev: 1 },
            }),
          },
          encoding: 'utf8',
        },
      ).trim(),
    )
    assert.equal(result.files.note, 'human fresh')
    assert.equal(result.batches, 0)
    assert.equal(result.server.files.note, 'sent')
    assert.equal(JSON.parse(result.files['files.journal-recovery.json']).desired.note, 'base')
    assert.ok(result.warnings > 0)
  } finally {
    flush = async () => {
      ls.setItem('test-durable', JSON.stringify(store.useStore.getState().projects))
    }
  }
})
