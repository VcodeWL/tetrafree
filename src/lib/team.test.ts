import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { emptyProject } from '../data/seed'
import type { Project, Chat } from '../types'
import { convertMetaIds, type TeamMeta } from './teamMetadata'

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
  team: typeof import('./team'),
  backend: typeof import('./backend'),
  persistence: typeof import('../store/persistence')
const fetch0 = globalThis.fetch
let seq = 0,
  flush: () => Promise<void>
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const hashes = (files: Record<string, string>) =>
  Object.fromEntries(Object.entries(files).map(([k, v]) => [k, backend.fnv(v)]))
const metaOf = (p: Project): TeamMeta =>
  convertMetaIds(
    {
      desc: p.desc,
      icon: p.icon,
      template: p.template,
      tools: p.tools,
      docs: p.docs,
      tasks: p.tasks,
      taskSeq: p.taskSeq,
      memory: p.memory,
      chats: p.chats.map((c) => ({ ...c, running: false, messages: c.messages.slice(-80) })),
      history: [],
      deploy: p.deploy,
      comments: p.comments || [],
      tomb: p.cloud?.tomb || {},
    },
    'uid',
    'to',
  )
const setup = (input: Partial<Project> = {}, ancestor?: TeamMeta) => {
  const id = 'cloud-test-' + ++seq,
    cp = id + '-cp'
  const p = emptyProject({ id, name: id, cloud: { pid: cp, rev: 1, owner: true, ownerId: 'uid' }, ...input })
  store.useStore.setState((s) => {
    s.projects = [p]
    s.projectId = id
  })
  const m = ancestor || metaOf(p)
  ls.setItem(
    'tf-cloud:' + cp,
    JSON.stringify({
      rev: 1,
      files: hashes(p.files),
      meta: backend.fnv(JSON.stringify(m)),
      metadata: m,
      dirs: [...p.dirs],
    }),
  )
  return { p, cp, meta: m }
}
const now = () => store.useStore.getState().projects[0]
before(async () => {
  const { initialPersisted } = await import('../store/defaults')
  ls.setItem('tetrafree', JSON.stringify({ state: initialPersisted(), version: 7, revision: 1 }))
  ls.setItem('tetrafree:authority', JSON.stringify({ backend: 'ls', revision: 1 }))
  store = await import('../store')
  await store.hydrateStore()
  backend = await import('./backend')
  team = await import('./team')
  persistence = await import('../store/persistence')
  const { useAccount } = await import('./account'),
    { setToken } = await import('./token')
  useAccount.setState({ user: { id: 'uid', name: 'tester' } as never })
  setToken('test-only-token')
  backend.useBackend.setState({
    status: 'online',
    base: 'http://cloud.invalid',
    info: { local: true } as never,
  })
  flush = async () => {
    ls.setItem('test-durable', JSON.stringify(store.useStore.getState().projects))
  }
  persistence.registerPersistenceCheckpoint(() => flush())
})
after(() => {
  globalThis.fetch = fetch0
})
const chat: Chat = {
  id: 'c',
  title: 'old',
  creator: { kind: 'human', id: 'me' },
  agents: [],
  running: false,
  createdAt: 1,
  lastAt: 100,
  messages: Array.from({ length: 100 }, (_, i) => ({
    id: 'm' + i,
    kind: 'human',
    author: 'me',
    text: 'me',
    at: i,
  })),
}

test('ST08 integrated: unchanged wire metadata refresh cannot truncate local 100-message chat', async () => {
  const { p, meta } = setup({ chats: [chat] })
  const remote = { ...meta, desc: 'remote description' }
  let wire: TeamMeta | undefined
  globalThis.fetch = async (_url, opts) =>
    opts?.method === 'PUT'
      ? ((wire = JSON.parse(String(opts.body)).meta), json({ rev: 3 }))
      : json({ rev: 2, files: p.files, dirs: [], meta: remote })
  await team.cloudNow(p.id)
  assert.equal(now().chats[0].messages.length, 100)
  assert.equal(now().chats[0].messages[0].id, 'm0')
  assert.equal(now().desc, 'remote description')
  if (wire) assert.equal(wire.chats[0].messages.length, 80)
})
test('ST09 integrated: PUT person IDs convert but me prose and UID prose are untouched', async () => {
  const { p } = setup({
    docs: [
      { id: 'd', title: 'me', createdBy: 'me', updatedAt: 1, blocks: [{ id: 'b', type: 'p', text: 'me' }] },
    ],
    chats: [chat],
  })
  store.useStore.getState().up((x) => {
    x.desc = 'uid'
  }, p.id)
  let payload!: TeamMeta
  globalThis.fetch = async (_url, opts) =>
    opts?.method === 'PUT'
      ? ((payload = JSON.parse(String(opts.body)).meta), json({ rev: 2 }))
      : json({ same: true, rev: 1 })
  await team.cloudNow(p.id)
  assert.equal(payload.docs[0].title, 'me')
  assert.equal(payload.docs[0].blocks[0].text, 'me')
  assert.equal(payload.docs[0].createdBy, 'uid')
  assert.equal(payload.desc, 'uid')
  const message = payload.chats[0].messages[0]
  assert.equal(message.text, 'me')
  assert.equal(message.kind === 'human' && message.author, 'uid')
})
test('D07 integrated: task fields and doc blocks retain concurrent independent changes', async () => {
  const { p, meta } = setup({
    tasks: [
      {
        id: 't',
        key: 1,
        title: 'old',
        desc: 'old desc',
        status: 'backlog',
        priority: 'med',
        assignee: null,
        createdAt: 1,
        updatedAt: 10,
      },
    ],
    docs: [
      {
        id: 'd',
        title: 'doc',
        createdBy: 'me',
        updatedAt: 10,
        blocks: [
          { id: 'b1', type: 'p', text: 'old1' },
          { id: 'b2', type: 'p', text: 'old2' },
        ],
      },
    ],
  })
  store.useStore.getState().up((x) => {
    x.tasks[0].title = 'local'
    x.docs[0].blocks[0].text = 'local'
  }, p.id)
  const remote = structuredClone(meta)
  remote.tasks[0].desc = 'remote'
  remote.docs[0].blocks[1].text = 'remote'
  globalThis.fetch = async (_url, opts) =>
    opts?.method === 'PUT' ? json({ rev: 3 }) : json({ rev: 2, files: p.files, meta: remote })
  await team.cloudNow(p.id)
  assert.equal(now().tasks[0].title, 'local')
  assert.equal(now().tasks[0].desc, 'remote')
  assert.deepEqual(
    now().docs[0].blocks.map((x) => x.text),
    ['local', 'remote'],
  )
})
test('ST18 integrated: .cloud fallback reserves existing Windows aliases and future remote targets', async () => {
  const { p, cp, meta } = setup({ files: { x: 'mine', 'X.CLOUD': 'precious' } })
  const b = JSON.parse(ls.getItem('tf-cloud:' + cp)!)
  b.files.x = backend.fnv('base')
  ls.setItem('tf-cloud:' + cp, JSON.stringify(b))
  globalThis.fetch = async (_url, opts) =>
    opts?.method === 'PUT'
      ? json({ rev: 3 })
      : json({ rev: 2, files: { x: 'theirs', 'X.CLOUD': 'precious', 'x.cloud.2': 'remote precious' }, meta })
  await team.cloudNow(p.id)
  assert.equal(now().files['X.CLOUD'], 'precious')
  assert.equal(now().files['x.cloud.2'], 'remote precious')
  assert.equal(now().files['x.cloud.3'], 'theirs')
  assert.equal(now().files.x, 'mine')
})
test('old metadata checkpoint without ancestor retains visible conflict copies rather than LWW loss', async () => {
  const { p, cp, meta } = setup({
    docs: [
      {
        id: 'd',
        title: 'local',
        createdBy: 'me',
        updatedAt: 10,
        file: 'docs/local.md',
        blocks: [{ id: 'b', type: 'p', text: 'local' }],
      },
    ],
  })
  const b = JSON.parse(ls.getItem('tf-cloud:' + cp)!)
  delete b.metadata
  ls.setItem('tf-cloud:' + cp, JSON.stringify(b))
  const remote = structuredClone(meta)
  remote.docs[0].blocks[0].text = 'remote'
  remote.docs[0].updatedAt = 11
  globalThis.fetch = async (_url, opts) =>
    opts?.method === 'PUT' ? json({ rev: 3 }) : json({ rev: 2, files: {}, meta: remote })
  await team.cloudNow(p.id)
  assert.ok(now().docs.some((d) => d.blocks[0].text === 'local'))
  const copy = now().docs.find((d) => d.blocks[0].text === 'remote')!
  assert.ok(copy)
  assert.notEqual(copy.id, 'd')
  assert.equal(copy.file, undefined)
})
test('checkpoint failure after successful PUT cannot promote cloud baseline or ancestor texts', async () => {
  const { p, cp } = setup({ files: { a: 'base' } })
  const old = ls.getItem('tf-cloud:' + cp),
    oldText = ls.getItem('tf-cloud-txt:' + cp)
  store.useStore.getState().writeFile('a', 'new', p.id)
  let put = 0
  globalThis.fetch = async (_url, opts) =>
    opts?.method === 'PUT' ? (put++, json({ rev: 2 })) : json({ same: true, rev: 1 })
  flush = async () => {
    throw new Error('quota')
  }
  try {
    await team.cloudNow(p.id)
    assert.equal(put, 1)
    assert.equal(ls.getItem('tf-cloud:' + cp), old)
    assert.equal(ls.getItem('tf-cloud-txt:' + cp), oldText)
  } finally {
    flush = async () => {
      ls.setItem('test-durable', JSON.stringify(store.useStore.getState().projects))
    }
  }
})
test('state mutation during PUT keeps the old ack baseline; failed follow-up cannot erase newer local edit', async () => {
  const { p, cp } = setup({ files: { a: 'base' } }),
    old = ls.getItem('tf-cloud:' + cp)
  store.useStore.getState().writeFile('a', 'sent', p.id)
  let reads = 0
  globalThis.fetch = async (_url, opts) => {
    if (opts?.method === 'PUT') {
      store.useStore.getState().writeFile('a', 'newer local', p.id)
      return json({ rev: 2 })
    }
    if (++reads === 1) return json({ same: true, rev: 1 })
    return json({ error: 'follow-up unavailable' }, 503)
  }
  await team.cloudNow(p.id)
  assert.equal(now().files.a, 'newer local')
  assert.equal(ls.getItem('tf-cloud:' + cp), old)
})
test('missing cloud checkpoint forces full fetch rather than treating current local edits as ancestor', async () => {
  const { p, cp, meta } = setup({ files: { a: 'local only' } })
  ls.removeItem('tf-cloud:' + cp)
  let fetched = ''
  globalThis.fetch = async (url, opts) =>
    opts?.method === 'PUT'
      ? json({ rev: 3 })
      : ((fetched = String(url)), json({ rev: 2, files: { a: 'remote only' }, meta }))
  await team.cloudNow(p.id)
  assert.match(fetched, /since=0/)
  assert.equal(now().files.a, 'local only')
  assert.equal(now().files['a.cloud'], 'remote only')
})

test('running chat path rejects checkpoint failure and keeps its local prefix', async () => {
  const { p, cp, meta } = setup({ chats: [{ ...chat, running: true }] })
  const old = ls.getItem('tf-cloud:' + cp)
  globalThis.fetch = async (_url, opts) => {
    assert.notEqual(opts?.method, 'PUT')
    return json({ rev: 2, files: {}, meta: { ...meta, desc: 'remote desc' } })
  }
  flush = async () => {
    throw new Error('quota')
  }
  try {
    await team.cloudNow(p.id)
    assert.equal(now().chats[0].messages.length, 100)
    assert.equal(now().chats[0].running, true)
    assert.equal(ls.getItem('tf-cloud:' + cp), old)
  } finally {
    flush = async () => {
      ls.setItem('test-durable', JSON.stringify(store.useStore.getState().projects))
    }
  }
})
test('conflict task copies deduplicate even after key/updatedAt repair when no checkpoint can be saved', async () => {
  const { p, cp, meta } = setup({
    tasks: [
      {
        id: 't',
        key: 1,
        title: 'local',
        desc: '',
        status: 'backlog',
        priority: 'med',
        assignee: null,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  })
  const raw = JSON.parse(ls.getItem('tf-cloud:' + cp)!)
  delete raw.metadata
  ls.setItem('tf-cloud:' + cp, JSON.stringify(raw))
  const remote = structuredClone(meta)
  remote.tasks[0].title = 'remote'
  globalThis.fetch = async (_url, opts) =>
    opts?.method === 'PUT' ? json({ error: 'unavailable' }, 503) : json({ rev: 2, files: {}, meta: remote })
  await team.cloudNow(p.id)
  await team.cloudNow(p.id)
  assert.equal(now().tasks.length, 2)
  assert.equal(new Set(now().tasks.map((t) => t.key)).size, 2)
})

test('F02 desired: accepted PUT cannot absorb file and metadata undo during await', async () => {
  const { p, meta } = setup({ files: { 'note.txt': 'base' }, desc: 'base description' })
  let serverFiles = p.files,
    serverMeta = meta,
    rev = 1,
    puts = 0
  store.useStore.getState().up((x) => {
    x.files['note.txt'] = 'sent'
    x.desc = 'sent description'
  }, p.id)
  globalThis.fetch = async (url, opts) => {
    if (opts?.method === 'PUT') {
      const body = JSON.parse(String(opts.body))
      serverFiles = body.files
      serverMeta = body.meta
      rev++
      if (++puts === 1)
        store.useStore.getState().up((x) => {
          x.files['note.txt'] = 'base'
          x.desc = 'base description'
        }, p.id)
      return json({ rev })
    }
    const since = Number(new URL(String(url)).searchParams.get('since'))
    return since === rev
      ? json({ same: true, rev })
      : json({ rev, files: serverFiles, dirs: [], meta: serverMeta })
  }
  await team.cloudNow(p.id)
  assert.equal(now().files['note.txt'], 'base')
  assert.equal(now().desc, 'base description')
  assert.equal(serverFiles['note.txt'], 'base')
  assert.equal(serverMeta.desc, 'base description')
  assert.equal(puts, 2)
})
test('F02 desired: restart after accepted PUT + failed checkpoint restores undo from independent journal', async () => {
  const { p, meta, cp } = setup({ files: { 'note.txt': 'base' }, desc: 'base description' })
  store.useStore.getState().up((x) => {
    x.files['note.txt'] = 'sent'
    x.desc = 'sent description'
  }, p.id)
  const durable = JSON.stringify({
    state: persistence.partialize(store.useStore.getState()),
    version: 7,
    revision: 2,
  })
  let serverFiles = p.files,
    serverMeta = meta,
    rev = 1
  globalThis.fetch = async (_url, opts) => {
    if (opts?.method === 'PUT') {
      const body = JSON.parse(String(opts.body))
      serverFiles = body.files
      serverMeta = body.meta
      rev++
      store.useStore.getState().up((x) => {
        x.files['note.txt'] = 'base'
        x.desc = 'base description'
      }, p.id)
      return json({ rev })
    }
    return json({ same: true, rev: 1 })
  }
  flush = async () => {
    throw new Error('checkpoint rejected')
  }
  try {
    await team.cloudNow(p.id)
    const pending = JSON.parse(ls.getItem('tf-cloud-intent:' + cp)!)
    assert.equal(pending.value.phase, 'accepted')
    assert.equal(pending.value.ack.base.rev, 2)
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
              kind: 'cloud',
              storage: [...ls.values],
              durable,
              server: { files: serverFiles, meta: serverMeta, dirs: [], rev },
            }),
          },
          encoding: 'utf8',
        },
      ).trim(),
    )
    assert.equal(result.files['note.txt'], 'base')
    assert.equal(result.desc, 'base description')
    assert.equal(result.server.files['note.txt'], 'base')
    assert.equal(result.server.meta.desc, 'base description')
  } finally {
    flush = async () => {
      ls.setItem('test-durable', JSON.stringify(store.useStore.getState().projects))
    }
  }
})
test('F05 desired: isolated mkdir and rmdir trigger PUT; remote directory delete merges by ancestor', async () => {
  const { p, meta } = setup({ files: {}, dirs: [] })
  let serverDirs: string[] = [],
    rev = 1,
    puts = 0
  globalThis.fetch = async (url, opts) => {
    if (opts?.method === 'PUT') {
      const body = JSON.parse(String(opts.body))
      serverDirs = body.dirs
      puts++
      return json({ rev: ++rev })
    }
    const since = Number(new URL(String(url)).searchParams.get('since'))
    return since === rev ? json({ same: true, rev }) : json({ rev, files: {}, dirs: serverDirs, meta })
  }
  store.useStore.getState().addDir('empty')
  await team.cloudNow(p.id)
  assert.deepEqual(serverDirs, ['empty'])
  assert.equal(puts, 1)
  store.useStore.getState().up((x) => {
    x.dirs = []
  }, p.id)
  await team.cloudNow(p.id)
  assert.deepEqual(serverDirs, [])
  assert.equal(puts, 2)
  store.useStore.getState().addDir('remote-delete')
  await team.cloudNow(p.id)
  serverDirs = []
  rev++
  await team.cloudNow(p.id)
  assert.deepEqual(now().dirs, [])
})

test('F02 desired: accepted-but-lost response preserves undo using uncertain journal and full fetch', async () => {
  const { p, meta } = setup({ files: { note: 'base' }, desc: 'base description' })
  store.useStore.getState().up((x) => {
    x.files.note = 'sent'
    x.desc = 'sent description'
  }, p.id)
  let files = p.files,
    serverMeta = meta,
    rev = 1,
    puts = 0
  globalThis.fetch = async (url, opts) => {
    if (opts?.method === 'PUT') {
      const body = JSON.parse(String(opts.body))
      files = body.files
      serverMeta = body.meta
      rev++
      if (++puts === 1) {
        store.useStore.getState().up((x) => {
          x.files.note = 'base'
          x.desc = 'base description'
        }, p.id)
        throw new Error('response lost')
      }
      return json({ rev })
    }
    const since = Number(new URL(String(url)).searchParams.get('since'))
    return since === rev ? json({ same: true, rev }) : json({ rev, files, dirs: [], meta: serverMeta })
  }
  await team.cloudNow(p.id)
  await team.cloudNow(p.id)
  assert.equal(now().files.note, 'base')
  assert.equal(now().desc, 'base description')
  assert.equal(files.note, 'base')
  assert.equal(serverMeta.desc, 'base description')
})
test('F05 desired: dirs-only store mutation wakes the cloud debounce watcher', async () => {
  setup({ files: {}, dirs: [] })
  let puts = 0
  globalThis.fetch = async (_url, opts) =>
    opts?.method === 'PUT' ? (puts++, json({ rev: 2 })) : json({ same: true, rev: 1 })
  const interval = globalThis.setInterval
  const doc = Object.getOwnPropertyDescriptor(globalThis, 'document')
  globalThis.setInterval = ((..._args: unknown[]) => 0) as unknown as typeof globalThis.setInterval
  Object.defineProperty(globalThis, 'document', { value: { hidden: false }, configurable: true })
  try {
    team.startCloud()
    store.useStore.setState((s) => {
      s.activeFile = 'initialize-watch'
    })
    await new Promise((r) => setTimeout(r, 750))
    assert.equal(puts, 0)
    store.useStore.getState().addDir('watch-only-empty')
    await new Promise((r) => setTimeout(r, 750))
    assert.equal(puts, 1)
    assert.deepEqual(now().dirs, ['watch-only-empty'])
  } finally {
    globalThis.setInterval = interval
    if (doc) Object.defineProperty(globalThis, 'document', doc)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})

test('durable redo equal to journal.prior is newer than pending undo after fresh-process restart', async () => {
  const { p, meta, cp } = setup({ files: { note: 'base' }, desc: 'base description' })
  store.useStore.getState().up((x) => {
    x.files.note = 'sent'
    x.desc = 'sent description'
  }, p.id)
  let files = p.files,
    serverMeta = meta,
    rev = 1
  globalThis.fetch = async (_url, opts) => {
    if (opts?.method === 'PUT') {
      const body = JSON.parse(String(opts.body))
      files = body.files
      serverMeta = body.meta
      rev++
      store.useStore.getState().up((x) => {
        x.files.note = 'base'
        x.desc = 'base description'
      }, p.id)
      return json({ rev })
    }
    return json({ same: true, rev: 1 })
  }
  flush = async () => {
    throw new Error('checkpoint rejected')
  }
  try {
    await team.cloudNow(p.id)
    const entry = JSON.parse(ls.getItem('tf-cloud-intent:' + cp)!).value
    assert.equal(entry.local.files.note, 'base')
    store.useStore.getState().up((x) => {
      x.files.note = 'sent'
      x.desc = 'sent description'
    }, p.id)
    // Model a later COMMITTED full app snapshot, not a content-only comparison.
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
              kind: 'cloud',
              storage: [...ls.values],
              durable,
              server: { files, meta: serverMeta, dirs: [], rev },
            }),
          },
          encoding: 'utf8',
        },
      ).trim(),
    )
    assert.equal(result.files.note, 'sent')
    assert.equal(result.desc, 'sent description')
    assert.equal(result.server.files.note, 'sent')
    assert.equal(result.server.meta.desc, 'sent description')
    const legacyStorage = [...ls.values].map(([k, v]): [string, string] => {
      if (k !== 'tf-cloud-intent:' + cp) return [k, v]
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
              kind: 'cloud',
              storage: legacyStorage,
              durable,
              server: { files, meta: serverMeta, dirs: [], rev },
            }),
          },
          encoding: 'utf8',
        },
      ).trim(),
    )
    assert.equal(legacy.files.note, 'sent')
    assert.equal(legacy.puts, 0)
    const copy = JSON.parse(legacy.files['metadata.journal-recovery.json'])
    assert.equal(copy.desired.files.note, 'base')
  } finally {
    flush = async () => {
      ls.setItem('test-durable', JSON.stringify(store.useStore.getState().projects))
    }
  }
})

test('A02 desired: uncertain mkdir undo and another local directory edit do not resurrect sent mkdir', async () => {
  const { p, meta } = setup({ files: {}, dirs: [] })
  store.useStore.getState().addDir('empty')
  let serverDirs: string[] = [],
    serverMeta = meta,
    rev = 1,
    puts = 0
  globalThis.fetch = async (url, opts) => {
    if (opts?.method === 'PUT') {
      const body = JSON.parse(String(opts.body))
      serverDirs = body.dirs
      serverMeta = body.meta
      rev++
      if (++puts === 1) {
        store.useStore.getState().up((x) => {
          x.dirs = ['new-local']
        }, p.id)
        throw new Error('response lost')
      }
      return json({ rev })
    }
    const since = Number(new URL(String(url)).searchParams.get('since'))
    return since === rev
      ? json({ same: true, rev })
      : json({ files: {}, dirs: serverDirs, meta: serverMeta, rev })
  }
  await team.cloudNow(p.id)
  await team.cloudNow(p.id)
  assert.deepEqual(now().dirs, ['new-local'])
  assert.deepEqual(serverDirs, ['new-local'])
})

test('A04 desired: fresh runtime human edit after hydration blocks whole cloud journal replay on every retry', async () => {
  const { p, meta } = setup({ files: { note: 'base' }, desc: 'base description' })
  store.useStore.getState().up((x) => {
    x.files.note = 'sent'
    x.desc = 'sent description'
  }, p.id)
  const storage = store.useStore.persist.getOptions().storage as import('../store/persistence').DurableStorage
  storage.setItem('tetrafree', {
    state: persistence.partialize(store.useStore.getState()),
    version: persistence.PERSIST_VERSION,
  })
  await storage.flush()
  const durable = ls.getItem('tetrafree')!
  let files = p.files,
    serverMeta = meta,
    rev = 1
  globalThis.fetch = async (_url, opts) => {
    if (opts?.method === 'PUT') {
      const body = JSON.parse(String(opts.body))
      files = body.files
      serverMeta = body.meta
      rev++
      store.useStore.getState().up((x) => {
        x.files.note = 'base'
        x.desc = 'base description'
      }, p.id)
      return json({ rev })
    }
    return json({ same: true, rev: 1 })
  }
  flush = async () => {
    throw new Error('checkpoint rejected')
  }
  try {
    await team.cloudNow(p.id)
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
              kind: 'cloud',
              storage: [...ls.values],
              durable,
              retries: 2,
              runtimeHuman: { path: 'note', text: 'human fresh', desc: 'human fresh description' },
              server: { files, meta: serverMeta, dirs: [], rev },
            }),
          },
          encoding: 'utf8',
        },
      ).trim(),
    )
    assert.equal(result.files.note, 'human fresh')
    assert.equal(result.desc, 'human fresh description')
    assert.equal(result.puts, 0)
    assert.equal(result.server.files.note, 'sent')
    assert.equal(result.server.meta.desc, 'sent description')
    assert.equal(JSON.parse(result.files['metadata.journal-recovery.json']).desired.files.note, 'base')
    assert.ok(result.warnings > 0)
  } finally {
    flush = async () => {
      ls.setItem('test-durable', JSON.stringify(store.useStore.getState().projects))
    }
  }
})
