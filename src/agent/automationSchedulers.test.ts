import test from 'node:test'
import assert from 'node:assert/strict'
import type { DeployRun } from '../types'
import { automationModules } from './test-helpers/automation-module'
import { deferred } from './test-helpers/harness'

const storage = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
  },
})
const timers = new Map<number, () => void>()
let timerId = 0
const win = {
  setTimeout: (fn: () => void) => {
    timers.set(++timerId, fn)
    return timerId
  },
  clearTimeout: (id: number) => timers.delete(id),
  setInterval: (fn: () => void) => {
    timers.set(++timerId, fn)
    return timerId
  },
  dispatchEvent: () => true,
}
Object.defineProperty(globalThis, 'window', { configurable: true, value: win })
const yaml =
  'name: verify\ntrigger: [version]\nschedule: every 5m\nsteps:\n- name: Check\n  run: echo greeting\n- name: Check again\n  run: echo greeting again\n'
type Project = {
  id: string
  name: string
  path: string
  files: Record<string, string>
  versions: { n: number }[]
  deploy: { auto: boolean; runs: DeployRun[] }
}
const makeProject = (id: string): Project => ({
  id,
  name: id,
  path: 'unit',
  files: { '.tetra/pipelines/verify.yaml': yaml },
  versions: [],
  deploy: { auto: true, runs: [] },
})
const state = {
  projectId: 'A',
  projects: [makeProject('A'), makeProject('B')],
  people: { me: { name: 'Unit' } },
  up(fn: (p: Project) => void, pid: string) {
    fn(state.projects.find((p) => p.id === pid)!)
  },
}
const listeners = new Set<(s: typeof state) => void>()
const H = {
  state,
  subscribe(fn: (s: typeof state) => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },
  reconcile: async (_pid: string, _opts: unknown) => {},
  exec: async (_p: Project, _cmd: string, _opts: { signal: AbortSignal; onOut: (s: string) => void }) => ({
    code: 0,
  }),
}
;(globalThis as unknown as { __automationHarness: typeof H }).__automationHarness = H
async function fresh() {
  storage.clear()
  timers.clear()
  listeners.clear()
  state.projects = [makeProject('A'), makeProject('B')]
  state.projectId = 'A'
  H.reconcile = async () => {}
  H.exec = async () => ({ code: 0 })
  return automationModules(true)
}

test('CI scheduler does not run hidden projects, and global pause prevents schedules', async () => {
  const a = await fresh()
  const now = Date.now()
  storage.set('tf-sched:B:verify', String(now - 600000))
  await a.schedulerTick(now)
  assert.equal(state.projects[1].deploy.runs.length, 0)
  storage.set('tf-sched:A:verify', String(now - 600000))
  a.pauseAutomations()
  await a.schedulerTick(now)
  assert.equal(state.projects[0].deploy.runs.length, 0)
  a.resumeAutomations()
  await a.schedulerTick(now)
  assert.equal(state.projects[0].deploy.runs[0].status, 'ok')
})

test('stop-all while pipeline reconcile is pending prevents shell dispatch and success', async () => {
  const a = await fresh(),
    gate = deferred()
  let calls = 0
  H.reconcile = () => gate.promise
  H.exec = async () => {
    calls++
    return { code: 0 }
  }
  const run = a.runPipeline('verify', 'A')
  a.stopEverything()
  gate.resolve()
  await run
  assert.equal(calls, 0)
  assert.equal(state.projects[0].deploy.runs[0].status, 'failed')
  assert.equal(a.pipelineRunning(), false)
})

test('stop-all passes abort to active exec and forbids subsequent steps even after late success', async () => {
  const a = await fresh(),
    gate = deferred<{ code: number }>(),
    started = deferred()
  let signal: AbortSignal | undefined,
    calls = 0
  H.exec = async (_p, _cmd, opts) => {
    signal = opts.signal
    calls++
    started.resolve()
    return gate.promise
  }
  const run = a.runPipeline('verify', 'A')
  await started.promise
  a.stopEverything()
  assert.equal(signal?.aborted, true)
  gate.resolve({ code: 0 })
  await run
  assert.equal(calls, 1)
  assert.equal(state.projects[0].deploy.runs[0].status, 'failed')
})

test('project switch during pipeline await aborts and never starts the next step', async () => {
  const a = await fresh(),
    gate = deferred(),
    started = deferred()
  let calls = 0
  H.reconcile = async () => {
    started.resolve()
    await gate.promise
  }
  H.exec = async () => {
    calls++
    return { code: 0 }
  }
  const run = a.runPipeline('verify', 'A', true)
  await started.promise
  state.projectId = 'B'
  for (const notify of listeners) notify(state)
  gate.resolve()
  await run
  assert.equal(calls, 0)
  assert.equal(state.projects[0].deploy.runs[0].status, 'failed')
})

test('queued pipeline trigger cannot survive stop-all then resume', async () => {
  const a = await fresh()
  a.fireTrigger('A', 'version')
  const pending = [...timers.values()]
  a.stopEverything()
  a.resumeAutomations()
  for (const fn of pending) fn()
  await new Promise((r) => setImmediate(r))
  assert.equal(state.projects[0].deploy.runs.length, 0)
})

test('loop pending first preparation is invalidated by stop-all and cannot replace a newer loop', async () => {
  const a = await fresh(),
    gate = deferred<{ extra: string }>()
  let calls = 0
  a.setLoopRunner({
    send: () => {
      calls++
      return true
    },
    busy: () => false,
    projectOpen: (pid: string) => pid === state.projectId,
    say: () => {},
  })
  const spec = { task: 'Review greeting', max: 3, gap: 1000 }
  const old = a.loopStart('chat', 'A', spec, 'first', { title: 'Unit', before: () => gate.promise })
  a.stopEverything()
  a.resumeAutomations()
  assert.equal(await a.loopStart('chat', 'A', spec, 'second'), true)
  gate.resolve({ extra: 'old benign context' })
  assert.equal(await old, false)
  assert.equal(calls, 1)
  a.stopEverything()
})

test('loop first preparation cannot dispatch after selected project changes', async () => {
  const a = await fresh(),
    gate = deferred<{ extra: string }>()
  let calls = 0
  a.setLoopRunner({
    send: () => {
      calls++
      return true
    },
    busy: () => false,
    projectOpen: (pid: string) => pid === state.projectId,
    say: () => {},
  })
  const old = a.loopStart('chat', 'A', { task: 'Review greeting', max: 2, gap: 1000 }, 'first', {
    title: 'Unit',
    before: () => gate.promise,
  })
  state.projectId = 'B'
  gate.resolve({ extra: 'unit context' })
  assert.equal(await old, false)
  assert.equal(calls, 0)
  a.stopEverything()
})

test('scheduler startup records interrupted historical pipelines without resuming them', async () => {
  const a = await fresh()
  state.projects[0].deploy.runs.push({
    id: 'old',
    kind: 'preview',
    version: 0,
    at: Date.now(),
    status: 'running',
    steps: [{ name: 'Check', detail: 'echo greeting', state: 'run' }],
    log: [],
  })
  a.startScheduler()
  assert.equal(state.projects[0].deploy.runs[0].status, 'failed')
  assert.match(state.projects[0].deploy.runs[0].log[0], /перезапуском/)
  assert.equal(state.projects[0].deploy.runs.length, 1)
  a.stopEverything()
})

test('queued pipeline trigger is invalidated by project A-to-B-to-A selection', async () => {
  const a = await fresh()
  a.fireTrigger('A', 'version')
  const pending = [...timers.values()]
  state.projectId = 'B'
  for (const fn of listeners) fn(state)
  state.projectId = 'A'
  for (const fn of listeners) fn(state)
  for (const fn of pending) fn()
  await new Promise((r) => setImmediate(r))
  assert.equal(state.projects[0].deploy.runs.length, 0)
})

test('loop preparation cannot revive across project A-to-B-to-A selection', async () => {
  const a = await fresh(),
    gate = deferred<{ extra: string }>()
  let calls = 0
  a.setLoopRunner({
    send: () => {
      calls++
      return true
    },
    busy: () => false,
    projectOpen: (pid: string) => pid === state.projectId,
    say: () => {},
  })
  const old = a.loopStart('chat', 'A', { task: 'Review greeting', max: 2, gap: 1000 }, 'first', {
    title: 'Unit',
    before: () => gate.promise,
  })
  state.projectId = 'B'
  for (const fn of listeners) fn(state)
  state.projectId = 'A'
  for (const fn of listeners) fn(state)
  gate.resolve({ extra: 'unit context' })
  assert.equal(await old, false)
  assert.equal(calls, 0)
})

test('loop preparation can update its note without invalidating the same live session', async () => {
  const a = await fresh()
  let calls = 0
  a.setLoopRunner({
    send: () => {
      calls++
      return true
    },
    busy: () => false,
    projectOpen: () => true,
    say: () => {},
  })
  const ok = await a.loopStart('chat', 'A', { task: 'Review greeting', max: 2, gap: 1000 }, 'first', {
    title: 'Unit',
    before: async () => {
      a.loopNote('chat', 'Контекст подготовлен')
      return { extra: 'unit context' }
    },
  })
  assert.equal(ok, true)
  assert.equal(calls, 1)
  assert.equal(a.useLoops.getState().loops.chat.note, 'Контекст подготовлен')
  a.stopEverything()
})

test('clone loop controls/read/note/end are fail-closed outside the stored project', async () => {
  const a = await fresh()
  const sent: string[] = [],
    said: string[] = []
  a.setLoopRunner({
    send: (_chat: string, _opts: unknown, pid?: string) => {
      sent.push(pid!)
      return true
    },
    busy: () => false,
    projectOpen: (pid: string) => pid === state.projectId,
    say: (_chat: string, pid: string) => {
      said.push(pid)
    },
  })
  assert.equal(
    await a.loopStart('same-chat', 'A', { task: 'Review greeting', max: 3, gap: 1000 }, 'first'),
    true,
  )
  const original = a.loopFor(a.useLoops.getState(), 'A', 'same-chat')!
  assert.equal(a.loopFor(a.useLoops.getState(), 'B', 'same-chat'), undefined)
  assert.equal(a.loopActive('same-chat', 'B'), false)
  assert.equal(a.loopStop('same-chat', 'wrong origin', 'B'), false)
  a.loopNote('same-chat', 'foreign note', 'B')
  a.loopPassEnded('same-chat', 'LOOP_DONE', false, 'B')
  assert.equal(a.loopFor(a.useLoops.getState(), 'A', 'same-chat'), original)
  assert.deepEqual(said, [])
  state.projectId = 'B'
  for (const notify of listeners) notify(state)
  assert.equal(a.loopActive('same-chat', 'A'), false)
  assert.equal(
    await a.loopStart('same-chat', 'B', { task: 'Review greeting B', max: 2, gap: 1000 }, 'second'),
    true,
  )
  a.loopStop('same-chat', undefined, 'A')
  assert.equal(a.loopActive('same-chat', 'B'), true)
  a.stopEverything()
  assert.deepEqual(sent, ['A', 'B'])
})
