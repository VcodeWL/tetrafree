import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = Record<string, any> // Controlled compiler fixture, not production input validation.
function fixture() {
  const events: unknown[] = []
  const message = { id: 'm', kind: 'agent', text: 'SYNTHETIC_PRIVATE_PROMPT', at: 1, endedAt: 2, parts: [] }
  const project = (id: string) => ({
    id,
    name: id,
    chats: [
      { id: 'same', title: 'Chat', createdAt: 1, messages: [structuredClone(message)], running: false },
    ],
    deploy: { runs: [] },
  })
  const state: Any = {
    authed: true,
    projectId: 'A',
    screen: 'workspace',
    projects: [project('A'), project('B')],
    openProject(id: string) {
      state.projectId = id
      state.screen = 'workspace'
      events.push(['project', id])
    },
    setCenter(c: unknown) {
      events.push(['center', state.projectId, c])
    },
    openModal(m: unknown) {
      events.push(['modal', state.projectId, m])
    },
    closeModal() {
      events.push('close')
    },
  }
  const queues: Any = { q: {} },
    loops: Any = { loops: {} },
    controls: Any = {},
    pipelineControls: Any = {},
    retries: Any[] = [],
    journal: Any = { runs: [] }
  const env = {
    epoch: 1,
    token: 1,
    health: { disk: 'unchecked', checkpoint: 'unconfirmed', canRetry: true, conflicts: 0 },
    retry: async (_pid: string) => {
      events.push(['retry', _pid])
    },
    autoRetry: async () => {
      events.push('auto')
      return { ok: true, note: 'requested' }
    },
  }
  const key = (pid: string, cid: string) => JSON.stringify([pid, cid])
  const imports: Any = {
    '../store': { useStore: { getState: () => state } },
    './engine': {
      captureRetryControls: () => retries,
      captureTurnControl: (cid: string, pid: string) => controls[key(pid, cid)] || null,
    },
    './queue': {
      useQueue: { getState: () => queues },
      queueFor: (s: Any, pid: string, cid: string) => s.q[key(pid, cid)] || empty,
      clearQueue: (cid: string, pid: string) => {
        events.push(['clear', pid, cid])
        queues.q[key(pid, cid)] = []
      },
    },
    './loop': {
      useLoops: { getState: () => loops },
      loopFor: (s: Any, pid: string, cid: string) => (s.loops[cid]?.pid === pid ? s.loops[cid] : undefined),
      loopStop: (cid: string, why: string, pid: string) => {
        events.push(['loopStop', pid, cid, why])
        delete loops.loops[cid]
        return true
      },
    },
    './ci': { capturePipelineControl: (pid: string, id: string) => pipelineControls[key(pid, id)] || null },
    './automationJournal': {
      useAutomationJournal: { getState: () => journal },
      runReasonText: { complete: 'done', error: 'failed', restart: 'interrupted' },
    },
    './autorun': { retryAutomation: () => env.autoRetry() },
    '../lib/syncStatus': {
      captureSyncHealth: () => env.health,
      syncHealthLabel: () => ({ text: 'disk', detail: 'observation only' }),
    },
    '../lib/sync': { retryProjectSync: (pid: string) => env.retry(pid) },
    '../lib/backend': { captureBackendContextRevision: () => env.epoch },
    '../lib/token': { getTokenRevision: () => env.token },
  }
  const mod = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(new URL('./operations.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (name: string) => {
      assert.ok(name in imports, name)
      return imports[name]
    },
    mod,
    mod.exports,
  )
  const api = mod.exports as typeof import('./operations')
  return {
    api,
    state,
    queues,
    loops,
    controls,
    pipelineControls,
    retries,
    journal,
    env,
    events,
    key,
    rows: () => api.collectOperations().rows,
  }
}
const empty: never[] = []

test('projection never dispatches work or includes prompt/command log content', () => {
  const f = fixture()
  f.rows()
  assert.deepEqual(f.events, [])
  assert.ok(!JSON.stringify(f.rows()).includes('SYNTHETIC_PRIVATE_PROMPT'))
  f.state.authed = false
  assert.deepEqual(f.rows(), [])
})
test('idle projection reads only the bounded history window', () => {
  const f = fixture(),
    messages = Array.from({ length: 5000 }, (_, i) => ({ id: `s${i}`, kind: 'sys', text: 'benign', at: i }))
  let iterated = 0
  f.state.projects = [
    {
      id: 'A',
      name: 'A',
      chats: [
        {
          id: 'same',
          title: 'Chat',
          running: false,
          messages: new Proxy(messages, {
            get(target, prop, receiver) {
              if (prop === Symbol.iterator)
                return function* () {
                  for (const value of target) {
                    iterated++
                    yield value
                  }
                }
              return Reflect.get(target, prop, receiver)
            },
          }),
        },
      ],
      deploy: { runs: [] },
    },
  ]
  assert.deepEqual(f.rows(), [])
  assert.equal(iterated, 0)
})
test('same-ID clones have distinct active and queued rows with explicit origin', () => {
  const f = fixture()
  f.controls[f.key('A', 'same')] = {
    phase: 'running',
    cancel: () => {
      f.events.push('cancelA')
      return true
    },
  }
  f.queues.q[f.key('A', 'same')] = [{ id: 'one', text: 'SYNTHETIC_PRIVATE_PROMPT' }]
  const rows = f.rows()
  assert.equal(rows.filter((x) => x.kind === 'agent' && x.status === 'running').length, 1)
  assert.equal(rows.filter((x) => x.kind === 'queue').length, 1)
  assert.equal(rows.find((x) => x.kind === 'queue')?.projectId, 'A')
  rows
    .find((x) => x.kind === 'agent' && x.status === 'running')!
    .actions.find((x) => x.kind === 'cancel')!
    .run()
  assert.deepEqual(f.events, ['cancelA'])
})
test('stale queue removal preserves new messages; unchanged queue removes only origin', () => {
  const f = fixture()
  f.queues.q[f.key('A', 'same')] = [{ id: 'one' }]
  f.queues.q[f.key('B', 'same')] = [{ id: 'other' }]
  const action = f
    .rows()
    .find((x) => x.kind === 'queue' && x.projectId === 'A')!
    .actions.find((x) => x.kind === 'cancel')!
  f.queues.q[f.key('A', 'same')] = [{ id: 'one' }, { id: 'new' }]
  assert.equal((action.run() as { ok: boolean }).ok, false)
  assert.equal(f.queues.q[f.key('A', 'same')].length, 2)
  f.rows()
    .find((x) => x.kind === 'queue' && x.projectId === 'A')!
    .actions.find((x) => x.kind === 'cancel')!
    .run()
  assert.equal(f.queues.q[f.key('A', 'same')].length, 0)
  assert.equal(f.queues.q[f.key('B', 'same')].length, 1)
})
test('loop restart invalidates old cancel; current cancel is origin-scoped', () => {
  const f = fixture()
  f.loops.loops.same = { pid: 'A', title: 'Loop', n: 1, phase: 'wait' }
  const old = f
    .rows()
    .find((x) => x.kind === 'loop')!
    .actions.find((x) => x.kind === 'cancel')!
  f.loops.loops.same = { pid: 'A', title: 'NEW', n: 1, phase: 'wait' }
  assert.equal((old.run() as { ok: boolean }).ok, false)
  f.rows()
    .find((x) => x.kind === 'loop')!
    .actions.find((x) => x.kind === 'cancel')!
    .run()
  assert.equal(f.loops.loops.same, undefined)
})
test('navigation rejects deleted origins and opens existing source explicitly', () => {
  const f = fixture()
  const row = f.rows().find((x) => x.projectId === 'A')!
  f.state.projectId = 'B'
  row.actions[0].run()
  assert.deepEqual(f.events[0], ['project', 'A'])
  assert.deepEqual(f.events[1], ['center', 'A', { kind: 'chat', id: 'same' }])
  f.events.length = 0
  f.state.projects = f.state.projects.filter((p: Any) => p.id !== 'A')
  assert.equal((row.actions[0].run() as { ok: boolean }).ok, false)
  assert.deepEqual(f.events, [])
})
test('unknown persisted pipeline execution is attention, never falsely live or successful', () => {
  const f = fixture()
  f.state.projects[0].deploy.runs = [
    { id: 'r', pipeline: 'release', status: 'running', steps: [], at: 1, log: ['SYNTHETIC_PRIVATE_PROMPT'] },
  ]
  const row = f.rows().find((x) => x.kind === 'pipeline')!
  assert.equal(row.status, 'attention')
  assert.equal(
    row.actions.some((x) => x.kind === 'cancel'),
    false,
  )
  assert.ok(!JSON.stringify(row).includes('SYNTHETIC'))
})
test('sync retry pins backend/token and does not dispatch from another active project', async () => {
  const f = fixture()
  f.env.health.disk = 'error'
  const action = f
    .rows()
    .find((x) => x.kind === 'sync' && x.projectId === 'A')!
    .actions.find((x) => x.kind === 'retry')!
  f.env.token++
  assert.equal((await action.run()).ok, false)
  assert.deepEqual(f.events, [])
  const fresh = f
    .rows()
    .find((x) => x.kind === 'sync' && x.projectId === 'A')!
    .actions.find((x) => x.kind === 'retry')!
  f.state.projectId = 'B'
  assert.equal((await fresh.run()).ok, false)
  f.state.projectId = 'A'
  f.env.retry = async () => {
    f.state.projectId = 'B'
  }
  assert.equal((await fresh.run()).ok, false)
})
test('automation retry uses existing policy, terminal row proof and explicit confirmation', async () => {
  const f = fixture()
  f.journal.runs = [{ id: 'r', project: 'hashA', outcome: 'failed', reason: 'error', at: 1 }]
  const row = f.api.collectOperations({ hashA: 'A' }).rows.find((x) => x.kind === 'automation')!
  const action = row.actions.find((x) => x.kind === 'retry')!
  assert.ok(action.confirm)
  assert.equal((await action.run()).ok, true)
  assert.deepEqual(f.events, ['auto'])
  f.journal.runs = [{ ...f.journal.runs[0], outcome: 'running' }]
  assert.equal((await action.run()).ok, false)
})
test('bounded projection keeps later live work ahead of old pipeline history', () => {
  const f = fixture()
  f.state.projects = Array.from({ length: 30 }, (_, i) => ({
    id: String(i),
    name: 'P',
    chats: [],
    deploy: {
      runs: Array.from({ length: 20 }, (_, n) => ({
        id: String(n),
        pipeline: 'p',
        at: 1,
        status: 'ok',
        steps: [],
      })),
    },
  }))
  f.state.projects.push({
    id: 'last',
    name: 'last',
    chats: [{ id: 'same', title: 'live', messages: [] }],
    deploy: { runs: [] },
  })
  f.controls[f.key('last', 'same')] = { phase: 'running', cancel: () => true }
  const projection = f.api.collectOperations()
  assert.equal(projection.rows.length, 250)
  assert.equal(projection.truncated, true)
  assert.equal(projection.rows[0].projectId, 'last')
})
test('quiet progress is advisory since observation, resets on progress/clock rewind, prunes done work', () => {
  const { api } = fixture()
  const row = { id: 'r', status: 'running', progress: '1' } as import('./operations').Operation
  let observed = api.observeProgress([row], new Map(), 1000)
  assert.equal(observed.quiet.size, 0)
  observed = api.observeProgress([row], observed.next, 121000)
  assert.ok(observed.quiet.has('r'))
  row.progress = '2'
  observed = api.observeProgress([row], observed.next, 122000)
  assert.equal(observed.quiet.size, 0)
  observed = api.observeProgress([row], observed.next, 1)
  assert.equal(observed.quiet.size, 0)
  row.status = 'succeeded'
  assert.equal(api.observeProgress([row], observed.next, 500000).next.size, 0)
})

test('standalone command retry is visible with origin-only cancellation and no command or output payload', () => {
  const f = fixture()
  let live = true
  f.retries.push({
    pid: 'A',
    chatId: 'same',
    msgId: 'm',
    partId: 'cmd',
    stopping: false,
    cancel: () => {
      if (!live) return false
      live = false
      f.events.push('cancelRetryA')
      return true
    },
  })
  const row = f.rows().find((x) => x.kind === 'command')!
  assert.equal(row.status, 'running')
  assert.equal(row.projectId, 'A')
  assert.ok(!JSON.stringify(row).includes('SYNTHETIC_PRIVATE_PROMPT'))
  const cancel = row.actions.find((x) => x.kind === 'cancel')!
  assert.equal((cancel.run() as { ok: boolean }).ok, true)
  assert.equal((cancel.run() as { ok: boolean }).ok, false)
  assert.deepEqual(f.events, ['cancelRetryA'])
  f.retries[0].stopping = true
  assert.equal(
    f
      .rows()
      .find((x) => x.kind === 'command')!
      .actions.some((x) => x.kind === 'cancel'),
    false,
  )
  f.state.projects = f.state.projects.filter((p: Any) => p.id !== 'A')
  assert.equal(
    f.rows().some((x) => x.kind === 'command'),
    false,
  )
})
