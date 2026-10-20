import test, { after, before } from 'node:test'
import assert from 'node:assert/strict'
import type { ChatAgent, Lane, Message, Part, Tier } from '../types'
import type { StreamOpts } from './llm'
import type { BackendInfo } from '../lib/backend'
import { harness, deferred, tick } from './test-helpers/harness'
import { parseStream } from './protocol'

type MockChat = { id: string; title: string; agents: ChatAgent[]; messages: Message[]; running?: boolean }
type MockProject = {
  id: string
  name: string
  files: Record<string, string>
  dirs: string[]
  chats: MockChat[]
  tasks: unknown[]
  versions: { n: number; snapshot: Record<string, string> }[]
  lanes: Lane[]
}
const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  },
})
let serial = 0
let modal: { run: () => void } | undefined
const project = (id: string): MockProject => ({
  id,
  name: id,
  files: {},
  dirs: [],
  chats: [],
  tasks: [],
  versions: [],
  lanes: [],
})
const state = {
  projectId: 'A',
  projects: [project('A'), project('B')],
  model: 'local:unit',
  providers: [{ id: 'local', on: true, kind: 'ollama', models: [{ id: 'unit', name: 'unit' }] }],
  settings: { autoVerify: false, followAgent: false },
  people: { me: { name: 'Tester' } },
  mode: 'dev',
  screen: 'workspace',
  center: { kind: 'chat', id: 'c' },
  patchMsg(chatId: string, id: string, patch: Partial<Message>, pid: string) {
    const c = getProject(pid).chats.find((c) => c.id === chatId)
    if (!c) return
    c.messages = c.messages.map((m) => (m.id === id ? ({ ...m, ...patch } as Message) : m))
  },
  pushMsg(chatId: string, message: Message, pid: string) {
    getProject(pid)
      .chats.find((c) => c.id === chatId)!
      .messages.push(message)
  },
  setChat(chatId: string, patch: Partial<MockChat>, pid: string) {
    Object.assign(
      getProject(pid).chats.find((c) => c.id === chatId)!,
      patch,
    )
  },
  setLanes(updater: (lanes: Lane[]) => Lane[], pid: string) {
    getProject(pid).lanes = updater(getProject(pid).lanes)
  },
  up(updater: (p: MockProject) => void, pid: string) {
    updater(getProject(pid))
  },
  writeFile(path: string, text: string, pid: string) {
    getProject(pid).files[path] = text
  },
  deleteFile(path: string) {
    delete getProject(state.projectId).files[path]
  },
  commit(_o: unknown, pid: string) {
    const p = getProject(pid)
    const n = p.versions.length + 1
    p.versions.push({ n, snapshot: { ...p.files } })
    return n
  },
  remember() {},
  setDraft() {},
  setRight() {},
  toast() {},
  openModal(o: { run: () => void }) {
    modal = o
  },
  createChat(o: Omit<MockChat, 'id' | 'messages'>, pid?: string): string {
    const id = 'created' + ++serial
    getProject(pid || state.projectId).chats.push({ ...o, id, messages: [] })
    return id
  },
  saveTask(o: unknown, pid?: string): string {
    getProject(pid || state.projectId).tasks.push(o)
    return 'task' + ++serial
  },
}
function getProject(pid = 'A'): MockProject {
  return state.projects.find((p) => p.id === pid)!
}
const listeners = new Set<(s: typeof state) => void>()
const H = {
  subscribe(fn: (s: typeof state) => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  state,
  toasts: [] as unknown[],
  stream: async (_o: StreamOpts) => {},
  mcp: async (..._args: unknown[]) => ({ ok: true, text: 'benign MCP result' }),
  web: async (..._args: unknown[]) => ({ ok: true, text: 'benign web result', label: 'unit' }),
}
let selectedPid = state.projectId
Object.defineProperty(state, 'projectId', {
  configurable: true,
  get: () => selectedPid,
  set: (pid: string) => {
    selectedPid = pid
    for (const notify of listeners) notify(state)
  },
})
;(globalThis as unknown as { __agentHarness: typeof H }).__agentHarness = H
let api: Awaited<ReturnType<typeof harness>>
const originalFetch = globalThis.fetch
const response = (source = '{"t":"x","code":0}\n') => new Response(source, { status: 200 })
before(async () => {
  api = await harness()
})
after(() => {
  globalThis.fetch = originalFetch
})
function reset(tier: Tier = 'Уведомить') {
  state.projects = [project('A'), project('B')]
  state.projectId = 'A'
  state.model = 'local:unit'
  modal = undefined
  getProject().chats.push({
    id: 'c',
    title: 'Builder',
    agents: [{ name: 'Builder', tier, sub: [] }],
    messages: [],
  })
  H.stream = async () => {}
  H.mcp = async () => ({ ok: true, text: 'benign MCP result' })
  H.web = async () => ({ ok: true, text: 'benign web result', label: 'unit' })
  api.clearQueue('c')
  api.useAutos.setState({ approved: {}, runs: {} })
  api.useBackend.setState({ status: 'online', info: { local: true } as BackendInfo })
  api.setToken('unit-token')
  globalThis.fetch = async () => response()
}
const start = () => api.runTurn('A', 'c', 'benign task', 'Builder', getProject().chats[0].agents[0].tier, [])
function turn(tier: Tier = 'Уведомить') {
  return new api.Turn('A', 'c', 'm', 'Builder', tier, 'l', new AbortController())
}
function saveTurn(T: ReturnType<typeof turn>) {
  getProject().chats[0].messages.push({
    id: 'm',
    kind: 'agent',
    agent: 'Builder',
    text: '',
    at: 0,
    parts: T.parts,
  } as Message)
  T.stop()
}
function recovery() {
  return Object.entries(getProject().files)
    .filter(([path]) => path.startsWith('.tetra/recovery/'))
    .map(([, text]) => JSON.parse(text).files as Record<string, string | null>)
}

test('A02 old turn cannot clear a newer controller, running flag or live file', async () => {
  reset()
  const calls: StreamOpts[] = [],
    gates = [deferred(), deferred()]
  H.stream = async (o) => {
    const i = calls.push(o) - 1
    await gates[i].promise
  }
  const old = start()
  await tick()
  const newer = start()
  await tick()
  calls[1].onDelta('<write path="new.txt">\nnew work')
  await new Promise((r) => setTimeout(r, 65))
  gates[0].resolve()
  await old
  assert.equal(api.isRunning('c'), true)
  assert.equal(getProject().chats[0].running, true)
  calls[0].onDelta('<write path="late.txt">ignored</write>')
  api.stopTurn('c')
  assert.equal(calls[1].signal.aborted, true)
  gates[1].resolve()
  await newer
  assert.equal(getProject().files['late.txt'], undefined)
  assert.equal(api.isRunning('c'), false)
})

test('A03 Stop during shell response prevents all subsequent shell/MCP/web dispatch', async () => {
  reset()
  H.stream = async (o) =>
    o.onDelta(
      '<run>echo first</run><run>echo second</run><mcp server="demo" tool="status">{}</mcp><search>unit notes</search>',
    )
  const gate = deferred<Response>()
  let execs = 0,
    tools = 0
  H.mcp = async () => {
    tools++
    return { ok: true, text: 'unit' }
  }
  H.web = async () => {
    tools++
    return { ok: true, text: 'unit', label: 'unit' }
  }
  globalThis.fetch = async (url) =>
    String(url).endsWith('/api/exec') ? (++execs, gate.promise) : new Response('{"ok":true}')
  const running = start()
  await tick()
  assert.equal(execs, 1)
  api.stopTurn('c')
  gate.resolve(response())
  await running
  assert.equal(execs, 1)
  assert.equal(tools, 0)
})

test('A03 Stop during MCP drops late result and prevents following web tool', async () => {
  reset()
  H.stream = async (o) => o.onDelta('<mcp server="demo" tool="status">{}</mcp><search>unit notes</search>')
  const gate = deferred<{ ok: boolean; text: string }>()
  let web = 0
  H.mcp = async () => gate.promise
  H.web = async () => {
    web++
    return { ok: true, text: 'unit', label: 'unit' }
  }
  const running = start()
  await tick()
  api.stopTurn('c')
  gate.resolve({ ok: true, text: 'late' })
  await running
  assert.equal(web, 0)
  assert.equal(
    getProject().chats[0].messages.some((m) => m.kind === 'agent' && m.parts?.some((p) => p.k === 'read')),
    false,
  )
})

test('A11 canceled Turn and syncSegs cannot mutate files or live output', () => {
  reset()
  getProject().files['sample.txt'] = 'human'
  const T = turn()
  T.ctl.abort()
  api.syncSegs(
    T,
    0,
    [{ t: 'op', kind: 'delete', attrs: { path: 'sample.txt' }, body: '', closed: true }],
    true,
    new Map(),
    new Set(),
  )
  T.begin('w', 'edit', 'sample.txt')
  T.endWrite('w', 'sample.txt', 'agent')
  T.endDelete('d', 'sample.txt')
  T.endRename('r', 'sample.txt', 'other.txt')
  T.stop()
  assert.deepEqual(getProject().files, { 'sample.txt': 'human' })
  assert.equal(T.parts.length, 0)
})

test('A08 live-write CAS preserves human text and keeps agent text proposed', () => {
  reset()
  getProject().files['sample.txt'] = 'before'
  const T = turn()
  T.begin('w', 'edit', 'sample.txt')
  getProject().files['sample.txt'] = 'human'
  T.endWrite('w', 'sample.txt', 'agent')
  T.stop()
  assert.equal(getProject().files['sample.txt'], 'human')
  assert.equal(T.parts[0].state, 'proposed')
  assert.equal(T.parts[0].after, 'agent')
})

test('A08 CAS includes deletion during stream and repeated edits in one turn', () => {
  reset()
  getProject().files['sample.txt'] = 'before'
  const T = turn()
  T.begin('w', 'edit', 'sample.txt')
  delete getProject().files['sample.txt']
  T.endWrite('w', 'sample.txt', 'agent')
  assert.equal(T.parts[0].state, 'proposed')
  T.stop()
  const U = turn()
  U.begin('a', 'create', 'other.txt')
  U.endWrite('a', 'other.txt', 'first')
  U.begin('b', 'edit', 'other.txt')
  U.endWrite('b', 'other.txt', 'second')
  U.stop()
  assert.equal(getProject().files['other.txt'], 'second')
  assert.equal(U.parts[1].state, 'done')
})

test('A09 stale delete requires fresh confirmation; recovery stores displaced human text', () => {
  reset()
  getProject().files['sample.txt'] = 'before'
  const T = turn('Спросить')
  T.endDelete('d', 'sample.txt')
  saveTurn(T)
  getProject().files['sample.txt'] = 'human'
  api.applyProposed('c', 'm')
  assert.equal(getProject().files['sample.txt'], 'human')
  assert.ok(modal)
  const first = modal!.run
  getProject().files['sample.txt'] = 'new human'
  first()
  assert.equal(getProject().files['sample.txt'], 'new human')
  assert.notEqual(modal!.run, first)
  modal!.run()
  assert.equal(getProject().files['sample.txt'], undefined)
  assert.ok(recovery().some((f) => f['sample.txt'] === 'new human'))
})

test('A09 rename checks both ends, and revert restores both pre-apply sides', () => {
  reset()
  getProject().files['source.txt'] = 'before'
  const T = turn('Спросить')
  T.endRename('r', 'source.txt', 'target.txt')
  saveTurn(T)
  getProject().files['source.txt'] = 'human source'
  getProject().files['target.txt'] = 'human target'
  api.applyProposed('c', 'm')
  assert.ok(modal)
  assert.equal(getProject().files['target.txt'], 'human target')
  modal!.run()
  assert.equal(getProject().files['target.txt'], 'human source')
  assert.ok(recovery().some((f) => f['target.txt'] === 'human target'))
  api.revertTurn('c', 'm')
  assert.equal(getProject().files['source.txt'], 'human source')
  assert.equal(getProject().files['target.txt'], 'human target')
})

test('A10 revert delete protects new occupant and rechecks repeated conflict', () => {
  reset()
  getProject().files['sample.txt'] = 'before'
  const T = turn()
  T.endDelete('d', 'sample.txt')
  saveTurn(T)
  getProject().files['sample.txt'] = 'human'
  api.revertTurn('c', 'm')
  assert.equal(getProject().files['sample.txt'], 'human')
  assert.ok(modal)
  const first = modal!.run
  getProject().files['sample.txt'] = 'latest'
  first()
  assert.equal(getProject().files['sample.txt'], 'latest')
  modal!.run()
  assert.equal(getProject().files['sample.txt'], 'before')
  assert.ok(recovery().some((f) => f['sample.txt'] === 'latest'))
})

test('A10 revert rename preserves later source and destination edits in recovery', () => {
  reset()
  getProject().files['source.txt'] = 'before'
  const T = turn()
  T.endRename('r', 'source.txt', 'target.txt')
  saveTurn(T)
  getProject().files['source.txt'] = 'human source'
  getProject().files['target.txt'] = 'human target'
  api.revertTurn('c', 'm')
  assert.ok(modal)
  modal!.run()
  assert.equal(getProject().files['source.txt'], 'before')
  assert.equal(getProject().files['target.txt'], undefined)
  assert.ok(recovery().some((f) => f['source.txt'] === 'human source' && f['target.txt'] === 'human target'))
})

test('legacy folder proposal snapshots all current members before accepting', () => {
  reset()
  getProject().files = { 'folder/a.txt': 'human a', 'folder/b.txt': 'human b' }
  const part: Part = { k: 'file', id: 'd', op: 'delete', path: 'folder', state: 'proposed', add: 0, del: 0 }
  getProject().chats[0].messages.push({
    id: 'm',
    kind: 'agent',
    agent: 'Builder',
    text: '',
    at: 0,
    parts: [part],
  })
  api.applyProposed('c', 'm')
  assert.ok(modal)
  modal!.run()
  assert.equal(getProject().files['folder/a.txt'], undefined)
  assert.ok(recovery().some((f) => f['folder/b.txt'] === 'human b'))
  api.revertTurn('c', 'm')
  assert.equal(getProject().files['folder/a.txt'], 'human a')
  assert.equal(getProject().files['folder/b.txt'], 'human b')
})

test('recovery write failure prevents destructive accept', () => {
  reset()
  getProject().files['sample.txt'] = 'before'
  const T = turn('Спросить')
  T.endDelete('d', 'sample.txt')
  saveTurn(T)
  getProject().files['sample.txt'] = 'human'
  api.applyProposed('c', 'm')
  const write = state.writeFile
  state.writeFile = () => {
    throw new Error('unit persistence unavailable')
  }
  try {
    assert.throws(() => modal!.run(), /unavailable/)
    assert.equal(getProject().files['sample.txt'], 'human')
  } finally {
    state.writeFile = write
  }
})

test('A12 standalone benign filenames are not interpolated into shell verify', () => {
  reset()
  assert.equal(api.verifyCommand({}, ['src/greeting.js', 'src/hello world.py']), null)
  assert.equal(
    api.verifyCommand({ 'package.json': '{"scripts":{"typecheck":"tsc"}}' }, ['src/greeting.js']),
    'npm run typecheck --silent',
  )
})

test('A13 project switched before finish retains queued message', async () => {
  reset()
  const gate = deferred()
  H.stream = async () => gate.promise
  const running = start()
  await tick()
  api.enqueue('c', 'queued unit task', [])
  state.projectId = 'B'
  gate.resolve()
  await running
  assert.equal(api.peekQueue('c').text, 'queued unit task')
})

test('A13 project switched during queue pause retains queued message', async () => {
  reset()
  const gate = deferred()
  let calls = 0
  H.stream = async () => {
    calls++
    await gate.promise
  }
  const running = start()
  await tick()
  api.enqueue('c', 'queued unit task', [])
  gate.resolve()
  await running
  state.projectId = 'B'
  await new Promise((r) => setTimeout(r, 400))
  assert.equal(calls, 1)
  assert.equal(api.peekQueue('c').text, 'queued unit task')
})

test('A14 Stop in queue pause cancels timer and clears requested queue', async () => {
  reset()
  const gate = deferred()
  let calls = 0
  H.stream = async () => {
    calls++
    await gate.promise
  }
  const running = start()
  await tick()
  api.enqueue('c', 'queued unit task', [])
  gate.resolve()
  await running
  api.stopTurn('c')
  await new Promise((r) => setTimeout(r, 400))
  assert.equal(calls, 1)
  assert.equal(api.peekQueue('c'), undefined)
})

test('A14 clear plus new enqueue cannot reuse an old queue timer', async () => {
  reset()
  const gate = deferred()
  let calls = 0
  H.stream = async () => {
    calls++
    await gate.promise
  }
  const running = start()
  await tick()
  api.enqueue('c', 'old task', [])
  gate.resolve()
  await running
  api.clearQueue('c')
  api.enqueue('c', 'replacement task', [])
  await new Promise((r) => setTimeout(r, 400))
  assert.equal(calls, 1)
  assert.equal(api.peekQueue('c').text, 'replacement task')
})

test('queue item removed only when the next request is accepted', async () => {
  reset()
  const gate = deferred()
  let calls = 0
  H.stream = async () => {
    calls++
    if (calls === 1) await gate.promise
  }
  const running = start()
  await tick()
  api.enqueue('c', 'queued task', [])
  gate.resolve()
  await running
  await new Promise((r) => setTimeout(r, 400))
  assert.equal(calls, 2)
  assert.equal(api.peekQueue('c'), undefined)
})

test('queue failure to resolve a model retains item', async () => {
  reset()
  const gate = deferred()
  H.stream = async () => gate.promise
  const running = start()
  await tick()
  api.enqueue('c', 'queued task', [])
  gate.resolve()
  await running
  state.model = 'missing:model'
  await new Promise((r) => setTimeout(r, 400))
  assert.equal(api.peekQueue('c').text, 'queued task')
})

async function approvedAuto(raw: Record<string, unknown>) {
  const text = JSON.stringify({ automations: [raw] })
  getProject().files[api.AUTO_FILE] = text
  const a = api.parseAutomations(text).list[0]
  const hash = await api.autoHash('A', a)
  api.useAutos.setState({ approved: { [hash]: true } })
  return a
}

test('A05/A06 automation wire prompt and tier are approved, not inherited from title', async () => {
  reset()
  getProject().chats[0].title = '⚙ Unit review'
  const a = await approvedAuto({
    name: 'Unit review',
    when: { manual: true },
    do: { agent: 'Review greeting', tier: 'Эскалация' },
  })
  const calls: StreamOpts[] = []
  H.stream = async (o) => {
    calls.push(o)
    o.onDelta('<write path="review.txt">agent review</write>')
  }
  assert.equal((await api.fireAuto('A', a, {}, 'unit')).ok, true)
  await tick()
  const automationChat = getProject().chats.find((c) => c.id !== 'c')!
  assert.ok(automationChat)
  assert.equal(calls[0].messages[calls[0].messages.length - 1].content, 'Review greeting')
  assert.equal(getProject().files['review.txt'], undefined)
  const message = automationChat.messages.find((m) => m.kind === 'agent')!
  assert.equal(message.kind === 'agent' && message.tier, 'Эскалация')
  assert.equal(message.kind === 'agent' && message.parts?.find((p) => p.k === 'file')?.state, 'proposed')
})

test('A06 existing automation chat cannot weaken explicit approved tier', async () => {
  reset()
  const a = await approvedAuto({
    name: 'Unit existing',
    when: { manual: true },
    do: { agent: 'Review greeting', tier: 'Эскалация' },
  })
  H.stream = async () => {}
  await api.fireAuto('A', a, {}, 'unit')
  await tick()
  const c = getProject().chats.find((c) => c.id !== 'c')!
  c.agents[0].tier = 'Уведомить'
  api.useAutos.setState({ runs: {} })
  H.stream = async (o) => o.onDelta('<write path="review.txt">agent review</write>')
  await api.fireAuto('A', a, {}, 'unit')
  await tick()
  assert.equal(getProject().files['review.txt'], undefined)
  const agentMessages = c.messages.filter((m) => m.kind === 'agent')
  assert.equal(agentMessages[agentMessages.length - 1].tier, 'Эскалация')
})

test('A07 project switch while digest is pending creates no task in either project', async () => {
  reset()
  const a = await approvedAuto({ name: 'Unit task', when: { manual: true }, do: { task: 'Review greeting' } })
  const running = api.fireAuto('A', a, {}, 'unit')
  state.projectId = 'B'
  assert.equal((await running).ok, false)
  assert.equal(getProject('A').tasks.length, 0)
  assert.equal(getProject('B').tasks.length, 0)
})

test('automation refuses changed specification after approval check and pins pid on actions', async () => {
  reset()
  const a = await approvedAuto({
    name: 'Unit task stable',
    when: { manual: true },
    do: { task: 'Review greeting' },
  })
  const running = api.fireAuto('A', a, {}, 'unit')
  getProject().files[api.AUTO_FILE] = '{"automations":[]}'
  assert.equal((await running).ok, false)
  assert.equal(getProject().tasks.length, 0)
  const b = await approvedAuto({
    name: 'Unit task pinned',
    when: { manual: true },
    do: { task: 'Review greeting' },
  })
  const save = state.saveTask
  state.saveTask = (o, pid) => {
    state.projectId = 'B'
    return save(o, pid)
  }
  try {
    assert.equal((await api.fireAuto('A', b, {}, 'unit')).ok, true)
  } finally {
    state.saveTask = save
  }
  assert.equal(getProject('A').tasks.length, 1)
  assert.equal(getProject('B').tasks.length, 0)
})

test('concurrent automation fires do not double dispatch approved task', async () => {
  reset()
  const a = await approvedAuto({
    name: 'Unit serialized',
    when: { manual: true },
    do: { task: 'Review greeting' },
  })
  const first = api.fireAuto('A', a, {}, 'unit')
  const second = api.fireAuto('A', a, {}, 'unit')
  assert.equal((await second).ok, false)
  assert.equal((await first).ok, true)
  assert.equal(getProject().tasks.length, 1)
})

test('recovery is not swept into a stale legacy delete of .tetra', () => {
  reset()
  getProject().files['.tetra/notes.txt'] = 'human notes'
  getProject().chats[0].messages.push({
    id: 'm',
    kind: 'agent',
    agent: 'Builder',
    text: '',
    at: 0,
    parts: [{ k: 'file', id: 'd', op: 'delete', path: '.tetra', state: 'proposed', add: 0, del: 0 }],
  })
  api.applyProposed('c', 'm')
  assert.ok(modal)
  modal!.run()
  assert.equal(getProject().files['.tetra/notes.txt'], undefined)
  assert.ok(recovery().some((f) => f['.tetra/notes.txt'] === 'human notes'))
})

test('A09 create proposal conflicts with a newly created occupant', () => {
  reset()
  const T = turn('Эскалация')
  T.begin('w', 'create', 'sample.txt')
  T.endWrite('w', 'sample.txt', 'agent')
  saveTurn(T)
  getProject().files['sample.txt'] = 'human'
  api.applyProposed('c', 'm')
  assert.equal(getProject().files['sample.txt'], 'human')
  modal!.run()
  assert.equal(getProject().files['sample.txt'], 'agent')
  assert.ok(recovery().some((f) => f['sample.txt'] === 'human'))
})

test('A09 proposal confirmation is pinned to its original project', () => {
  reset()
  getProject().files['sample.txt'] = 'before'
  const T = turn('Спросить')
  T.endDelete('d', 'sample.txt')
  saveTurn(T)
  getProject().files['sample.txt'] = 'human'
  api.applyProposed('c', 'm')
  state.projectId = 'B'
  getProject('B').files['sample.txt'] = 'other project'
  modal!.run()
  assert.equal(getProject('A').files['sample.txt'], 'human')
  assert.equal(getProject('B').files['sample.txt'], 'other project')
})

test('A07 project A-to-B-to-A during approval invalidates the old lifecycle', async () => {
  reset()
  const a = await approvedAuto({
    name: 'Unit lifecycle',
    when: { manual: true },
    do: { task: 'Review greeting' },
  })
  const running = api.fireAuto('A', a, {}, 'unit')
  state.projectId = 'B'
  state.projectId = 'A'
  assert.equal((await running).ok, false)
  assert.equal(getProject('A').tasks.length, 0)
})

test('large before-image survives card JSON roundtrip and exact revert', () => {
  reset()
  const original = 'human text\n'.repeat(5000)
  getProject().files['sample.txt'] = original
  const T = turn()
  T.begin('w', 'edit', 'sample.txt')
  T.endWrite('w', 'sample.txt', 'agent')
  saveTurn(T)
  getProject().chats[0].messages = JSON.parse(JSON.stringify(getProject().chats[0].messages))
  api.revertTurn('c', 'm')
  assert.equal(modal, undefined)
  assert.equal(getProject().files['sample.txt'], original)
})

test('expanded folder proposals never delete files added later to the folder', () => {
  reset()
  getProject().files['folder/before.txt'] = 'before'
  const T = turn('Спросить')
  api.syncSegs(
    T,
    0,
    [{ t: 'op', kind: 'delete', attrs: { path: 'folder' }, body: '', closed: true }],
    true,
    new Map(),
    new Set(),
  )
  saveTurn(T)
  getProject().files['folder/new.txt'] = 'new human member'
  api.applyProposed('c', 'm')
  assert.equal(getProject().files['folder/before.txt'], undefined)
  assert.equal(getProject().files['folder/new.txt'], 'new human member')
})

test('legacy edit with missing original never invents a destructive revert', () => {
  reset()
  getProject().files['sample.txt'] = 'human current'
  getProject().chats[0].messages.push({
    id: 'm',
    kind: 'agent',
    agent: 'Builder',
    text: '',
    at: 0,
    parts: [
      {
        k: 'file',
        id: 'e',
        op: 'edit',
        path: 'sample.txt',
        state: 'done',
        before: null,
        after: 'old agent',
        add: 1,
        del: 1,
      },
    ],
  })
  api.revertTurn('c', 'm')
  assert.ok(modal)
  modal!.run()
  assert.equal(getProject().files['sample.txt'], 'human current')
  assert.equal(getProject().versions.length, 0)
})

test('F01 repeated applied edit computes from current human text, not stale T.after', () => {
  reset()
  getProject().files['note.txt'] = 'alpha\nbeta'
  const T = turn()
  try {
    api.syncSegs(
      T,
      0,
      parseStream('<write path="note.txt">alpha\nbeta agent</write>', false),
      true,
      new Map(),
      new Set(),
    )
    getProject().files['note.txt'] = 'human alpha\nbeta agent'
    api.syncSegs(
      T,
      1,
      parseStream('<edit path="note.txt"><find>beta agent</find><replace>beta final</replace></edit>', false),
      true,
      new Map(),
      new Set(),
    )
    assert.equal(getProject().files['note.txt'], 'human alpha\nbeta final')
    const card = T.parts[T.parts.length - 1]
    assert.equal(card.before, 'human alpha\nbeta agent')
    assert.equal(card.state, 'done')
  } finally {
    T.stop()
  }
})

test('F01 deletion between applied operations is not silently recreated by edit', () => {
  reset()
  getProject().files['note.txt'] = 'alpha\nbeta'
  const T = turn()
  try {
    api.syncSegs(
      T,
      0,
      parseStream('<write path="note.txt">alpha\nbeta agent</write>', false),
      true,
      new Map(),
      new Set(),
    )
    delete getProject().files['note.txt']
    api.syncSegs(
      T,
      1,
      parseStream('<edit path="note.txt"><find>beta agent</find><replace>beta final</replace></edit>', false),
      true,
      new Map(),
      new Set(),
    )
    assert.equal(getProject().files['note.txt'], undefined)
    assert.equal(T.parts[T.parts.length - 1].state, 'error')
  } finally {
    T.stop()
  }
})

test('F01 streaming repeated edit binds computation and CAS to one captured input', () => {
  reset()
  getProject().files['note.txt'] = 'alpha\nbeta'
  const T = turn()
  try {
    api.syncSegs(
      T,
      0,
      parseStream('<write path="note.txt">alpha\nbeta agent</write>', false),
      true,
      new Map(),
      new Set(),
    )
    const ids = new Map(),
      applied = new Set()
    const edit = '<edit path="note.txt"><find>beta agent</find><replace>beta final</replace>'
    api.syncSegs(T, 1, parseStream(edit, true), false, ids, applied)
    getProject().files['note.txt'] = 'human alpha\nbeta agent'
    api.syncSegs(T, 1, parseStream(edit + '</edit>', false), true, ids, applied)
    assert.equal(getProject().files['note.txt'], 'human alpha\nbeta agent')
    const card = T.parts[T.parts.length - 1]
    assert.equal(card.state, 'proposed')
    assert.equal(card.before, 'alpha\nbeta agent')
    assert.equal(card.after, 'alpha\nbeta final')
  } finally {
    T.stop()
  }
})

test('F01 unaccepted proposal chain keeps original CAS evidence and cannot auto-commit', () => {
  reset()
  getProject().files['note.txt'] = 'alpha\nbeta'
  const T = turn('Эскалация')
  try {
    api.syncSegs(
      T,
      0,
      parseStream('<write path="note.txt">alpha\nbeta agent</write>', false),
      true,
      new Map(),
      new Set(),
    )
    T.tier = 'Уведомить'
    api.syncSegs(
      T,
      1,
      parseStream('<edit path="note.txt"><find>beta agent</find><replace>beta final</replace></edit>', false),
      true,
      new Map(),
      new Set(),
    )
    assert.equal(getProject().files['note.txt'], 'alpha\nbeta')
    const card = T.parts[T.parts.length - 1]
    assert.equal(card.state, 'proposed')
    assert.equal(card.before, 'alpha\nbeta')
    assert.equal(card.after, 'alpha\nbeta final')
  } finally {
    T.stop()
  }
})

test('F06 digest failure resolves to logged failure and releases firing lock for retry', async () => {
  reset()
  const a = await approvedAuto({
    name: 'Unit digest boundary',
    when: { manual: true },
    do: { task: 'Review greeting' },
  })
  const digest = crypto.subtle.digest
  crypto.subtle.digest = async () => {
    throw new Error('unit digest unavailable')
  }
  try {
    const result = await api.fireAuto('A', a, {}, 'unit')
    assert.equal(result.ok, false)
    assert.ok(result.note)
    const run = api.useAutos.getState().runs['A:' + a.id]
    assert.equal(run.last.ok, false)
    assert.equal(run.recent.length, 0)
    assert.equal(run.running, false)
    assert.equal(getProject().tasks.length, 0)
  } finally {
    crypto.subtle.digest = digest
  }
  assert.equal((await api.fireAuto('A', a, {}, 'unit retry')).ok, true)
  assert.equal(getProject().tasks.length, 1)
})

test('F06 task action runtime failure is supervised without reporting success', async () => {
  reset()
  const a = await approvedAuto({
    name: 'Unit action boundary',
    when: { manual: true },
    do: { task: 'Review greeting' },
  })
  const save = state.saveTask
  state.saveTask = () => {
    throw new Error('unit action unavailable')
  }
  try {
    const result = await api.fireAuto('A', a, {}, 'unit')
    assert.equal(result.ok, false)
    assert.equal(api.useAutos.getState().runs['A:' + a.id].last.ok, false)
    assert.equal(getProject().tasks.length, 0)
  } finally {
    state.saveTask = save
  }
})

test('F01 virtual edit of unaccepted creation remains proposed with missing-file baseline', () => {
  reset()
  const T = turn('Эскалация')
  try {
    api.syncSegs(T, 0, parseStream('<write path="new.txt">alpha</write>', false), true, new Map(), new Set())
    T.tier = 'Уведомить'
    api.syncSegs(
      T,
      1,
      parseStream('<edit path="new.txt"><find>alpha</find><replace>beta</replace></edit>', false),
      true,
      new Map(),
      new Set(),
    )
    assert.equal(getProject().files['new.txt'], undefined)
    const card = T.parts[T.parts.length - 1]
    assert.equal(card.state, 'proposed')
    assert.equal(card.before, null)
    assert.equal(card.after, 'beta')
  } finally {
    T.stop()
  }
})

test('F01 streaming repeated edit does not recreate a file deleted after its input was frozen', () => {
  reset()
  getProject().files['note.txt'] = 'alpha'
  const T = turn()
  try {
    const ids = new Map(),
      applied = new Set()
    const edit = '<edit path="note.txt"><find>alpha</find><replace>beta</replace>'
    api.syncSegs(T, 0, parseStream(edit, true), false, ids, applied)
    delete getProject().files['note.txt']
    api.syncSegs(T, 0, parseStream(edit + '</edit>', false), true, ids, applied)
    assert.equal(getProject().files['note.txt'], undefined)
    assert.equal(T.parts[T.parts.length - 1].state, 'proposed')
  } finally {
    T.stop()
  }
})

test('F06 reporting failure cannot create a second rejected background promise', async () => {
  reset()
  const a = await approvedAuto({
    name: 'Unit reporter boundary',
    when: { manual: true },
    do: { task: 'Review greeting' },
  })
  const digest = crypto.subtle.digest
  crypto.subtle.digest = async () => {
    throw new Error('unit digest unavailable')
  }
  const unsubscribe = api.useAutos.subscribe(() => {
    throw new Error('unit reporter unavailable')
  })
  try {
    const result = await api.fireAuto('A', a, {}, 'unit')
    assert.equal(result.ok, false)
    assert.doesNotMatch(result.note, /unit digest|unit reporter/)
    assert.equal(getProject().tasks.length, 0)
  } finally {
    unsubscribe()
    crypto.subtle.digest = digest
  }
  assert.equal((await api.fireAuto('A', a, {}, 'unit retry')).ok, true)
})
