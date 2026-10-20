import test from 'node:test'
import assert from 'node:assert/strict'
import { automationModules } from './test-helpers/automation-module'

const storage = new Map<string, string>()
let failWrite = false
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => {
      if (failWrite) throw Error('unit quota')
      storage.set(k, v)
    },
  },
})
const events: unknown[] = []
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { dispatchEvent: (event: Event) => events.push(event) },
})
const project = 'a'.repeat(64),
  identity = 'b'.repeat(64),
  approval = 'c'.repeat(64)
async function fresh() {
  storage.clear()
  failWrite = false
  events.length = 0
  return automationModules()
}

test('journal is bounded, whitelisted, separate monthly reservations survive history pruning', async () => {
  const a = await fresh()
  for (let n = 0; n < 120; n++) {
    const id = a.beginAutomation(project, identity, approval, 'sonnet')
    assert.ok(id)
    assert.equal(a.reserveAutomation(id, 0.5, { month: 100 }), null)
    a.finishAutomation(id, 'succeeded', 'complete', 0.01)
  }
  assert.equal(a.useAutomationJournal.getState().runs.length, 100)
  const j = JSON.parse(storage.get(a.JOURNAL_KEY)!)
  assert.equal(j.totals[identity], 60)
  assert.deepEqual(
    Object.keys(j.runs[0]).sort(),
    [
      'approval',
      'at',
      'ended',
      'estimate',
      'id',
      'identity',
      'model',
      'outcome',
      'project',
      'reason',
      'reserved',
    ].sort(),
  )
  assert.equal(a.beginAutomation(project, identity, approval, 'benign private model label'), null)
  const id = a.beginAutomation(project, identity, approval, 'sonnet')
  assert.equal(a.reserveAutomation(id, 0.5, { month: 60 }), 'budget')
})

test('restart marks in-flight runs interrupted, retains reservations, never auto retries', async () => {
  const a = await fresh()
  const id = a.beginAutomation(project, identity, approval, 'sonnet')
  a.reserveAutomation(id, 0.4, { run: 1 })
  const b = await automationModules()
  const r = b.useAutomationJournal.getState().runs[0]
  assert.equal(r.id, id)
  assert.equal(r.outcome, 'interrupted')
  assert.equal(r.reason, 'restart')
  assert.equal(r.estimate, null)
  assert.equal(b.useAutomationJournal.getState().totals[identity], 0.4)
})

test('unknown tariff is blocked only when a configured limit needs checking', async () => {
  const a = await fresh()
  const id = a.beginAutomation(project, identity, approval, 'другая модель')
  for (const limits of [{ run: 1 }, { month: 1 }, { global: 1 }])
    assert.equal(a.reserveAutomation(id, null, limits), 'tariff')
  assert.equal(a.reserveAutomation(id, null, {}), null)
  a.finishAutomation(id, 'succeeded', 'complete', null)
  assert.equal(a.useAutomationJournal.getState().runs[0].estimate, null)
})

test('per-run, per-automation monthly and global conservative budget reservations block before dispatch', async () => {
  const a = await fresh()
  const id = a.beginAutomation(project, identity, approval, 'gpt-4')
  assert.equal(a.reserveAutomation(id, 0.3, { run: 0.4, month: 1, global: 2 }), null)
  assert.equal(a.reserveAutomation(id, 0.2, { run: 0.4 }), 'budget')
  assert.equal(a.reserveAutomation(id, 0.2, { month: 0.4 }), 'budget')
  assert.equal(a.reserveAutomation(id, 0.2, { global: 2, spent: 1.9 }), 'budget')
  assert.equal(a.useAutomationJournal.getState().runs[0].reserved, 0.3)
})

test('corrupt/future journal fails closed without destroying original data', async () => {
  await fresh()
  const raw = '{"version":9,"privateFixture":"ordinary text"}'
  storage.set('tf-automation-journal-v1', raw)
  const a = await automationModules()
  assert.equal(a.useAutomationJournal.getState().unavailable, true)
  assert.equal(a.beginAutomation(project, identity, approval, 'sonnet'), null)
  assert.equal(storage.get(a.JOURNAL_KEY), raw)
})

test('write failure blocks execution, does not report success, leaves old durable entry intact', async () => {
  const a = await fresh()
  const id = a.beginAutomation(project, identity, approval, 'sonnet')
  failWrite = true
  assert.equal(a.reserveAutomation(id, 0.1, {}), 'dispatch')
  assert.equal(a.useAutomationJournal.getState().unavailable, true)
  a.finishAutomation(id, 'succeeded', 'complete', 0.1)
  assert.equal(JSON.parse(storage.get(a.JOURNAL_KEY)!).runs[0].outcome, 'running')
  failWrite = false
})

test('stop-all invokes every cancellation, invalidates pending epochs and persists pause across restart', async () => {
  const a = await fresh()
  let cancelled = 0
  a.registerAutomationStopper(() => {
    throw Error('unit listener')
  })
  a.registerAutomationStopper(() => {
    cancelled++
  })
  const epoch = a.automationEpoch()
  a.beginAutomation(project, identity, approval, 'sonnet')
  a.stopEverything()
  assert.equal(cancelled, 1)
  assert.equal(a.automationAllowed(epoch), false)
  assert.equal(a.useAutomationJournal.getState().runs[0].outcome, 'cancelled')
  const b = await automationModules()
  assert.equal(b.automationAllowed(), false)
  b.resumeAutomations()
  assert.equal(b.automationAllowed(), true)
  assert.equal(a.automationAllowed(epoch), false)
})

test('notifications are opt-in and carry generic bounded text, never project content', async () => {
  const a = await fresh()
  a.notifyAutomation('succeeded')
  assert.equal(events.length, 0)
  a.setAutomationNotifications(true)
  a.notifyAutomation('succeeded')
  a.notifyAutomation('failed')
  assert.equal(events.length, 2)
  for (const event of events as CustomEvent[]) {
    assert.equal(event.type, 'tetrafree:automation-notification')
    assert.deepEqual(Object.keys(event.detail).sort(), ['outcome', 'title'])
    assert.ok(event.detail.title.length < 80)
  }
})

test('notification preference persistence failure is fail-closed', async () => {
  const a = await fresh()
  failWrite = true
  a.setAutomationNotifications(true)
  assert.equal(a.automationAllowed(), false)
  assert.equal(a.useAutomationControl.getState().storageError, true)
  failWrite = false
})

test('invalid reservation cannot poison the durable ledger with non-finite numbers', async () => {
  const a = await fresh()
  const id = a.beginAutomation(project, identity, approval, 'sonnet')
  for (const value of [NaN, Infinity, -1]) assert.equal(a.reserveAutomation(id, value, {}), 'tariff')
  assert.equal(a.useAutomationJournal.getState().runs[0].reserved, 0)
  assert.deepEqual(a.useAutomationJournal.getState().totals, {})
})

test('throwing control observers do not prevent independent stop-all cancellations', async () => {
  const a = await fresh()
  let stopped = false
  a.useAutomationControl.subscribe(() => {
    throw Error('unit observer')
  })
  a.registerAutomationStopper(() => {
    stopped = true
  })
  assert.doesNotThrow(() => a.stopEverything())
  assert.equal(stopped, true)
  assert.equal(a.automationAllowed(), false)
  assert.equal(JSON.parse(storage.get('tf-automation-control-v1')!).paused, true)
})

test('a full live journal refuses another run rather than evicting an active run', async () => {
  const a = await fresh()
  for (let n = 0; n < a.HISTORY_LIMIT; n++)
    assert.ok(a.beginAutomation(project, identity, approval, 'sonnet'))
  assert.equal(a.beginAutomation(project, identity, approval, 'sonnet'), null)
  assert.equal(a.useAutomationJournal.getState().runs.length, a.HISTORY_LIMIT)
})
