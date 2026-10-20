/* Portable adapter tests execute the actual pty.mjs source with only OS process
   creation substituted. Registry implementation is real; stop outcomes controlled.
   These are NOT native tree-reap or ConPTY runtime tests. */
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { StringDecoder } from 'node:string_decoder'
import { createProcessRegistry, childEnv } from './process-safety.mjs'
import { publicError, publicFailure } from './public-errors.mjs'

class Response extends EventEmitter {
  writableLength = 0
  destroyed = false
  writableEnded = false
  records = []
  writeHead(status) {
    this.status = status
  }
  write(data) {
    this.records.push(data)
    return true
  }
  end() {
    this.writableEnded = true
    this.emit('close')
  }
  destroy() {
    this.destroyed = true
    this.emit('close')
  }
}

function harness({ limit = 64, stop = async () => ({ stopped: true }) } = {}) {
  const registry = createProcessRegistry({ limit, stop })
  const children = []
  const launch = () => {
    const child = new EventEmitter()
    child.pid = 1000 + children.length
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.stdio = [child.stdin, child.stdout, child.stderr, new PassThrough()]
    children.push(child)
    return child
  }
  const context = vm.createContext({
    spawn: launch,
    execFileSync: () => {},
    crypto,
    fs,
    StringDecoder,
    childEnv,
    serverProcesses: registry,
    publicError,
    publicFailure,
    ensureConPty: async () => 'unused-in-portable-test',
    process: { platform: 'linux', env: {}, cwd: () => process.cwd() },
    Buffer,
    console: { error() {} },
    setTimeout,
    clearTimeout,
    setInterval: () => ({ unref() {} }),
  })
  const source = fs
    .readFileSync(new URL('./pty.mjs', import.meta.url), 'utf8')
    .replace(/^import .* from .*\n/gm, '')
    .replace(/^export /gm, '')
  vm.runInContext(source + '\nglobalThis.api = { ptyRoutes, shutdownPty };', context)
  const route = async (path, body = {}, sid) => {
    const response = new Response()
    await context.api.ptyRoutes(
      { method: 'POST' },
      response,
      new URL(`http://localhost${path}${sid ? '?sid=' + sid : ''}`),
      {
        readBody: async () => body,
        projectDir: async () => process.cwd(),
        json: (res, status, value) => {
          res.status = status
          res.body = value
        },
      },
    )
    return response
  }
  return { registry, children, route, shutdown: context.api.shutdownPty }
}

test('capacity checked before spawn, shared public 503, zero unowned processes', async () => {
  const h = harness({ limit: 1 })
  h.registry.own(new EventEmitter(), 'fixture')
  const response = await h.route('/api/pty/open', { name: 'portable' })
  assert.equal(response.status, 503)
  assert.match(response.body.error.message, /лимит/)
  assert.equal(h.children.length, 0)
  assert.equal(h.registry.entries.size, 1)
})

test('130 naturally closed roots free active slots, bound replay to12 and never claim false tree proof', async () => {
  let calls = 0
  const h = harness({
    stop: async () => {
      calls++
      return { stopped: false, reason: 'unconfirmed' }
    },
  })
  const ids = [],
    owned = []
  for (let i = 0; i < 130; i++) {
    const opened = await h.route('/api/pty/open', { name: 'portable' })
    assert.equal(opened.status, 200, `natural close must not exhaust PTY capacity at ${i}`)
    const child = h.children[i]
    const entry = h.registry.entries.get(child)
    assert.equal(entry.kind, 'pty')
    assert.ok(child.listenerCount('close') >= 3)
    ids.push(opened.body.sid)
    owned.push(entry)
    child.exitCode = 0
    child.emit('close', 0)
    await entry.stopping
    assert.equal(h.registry.entries.size, 0)
    assert.equal(entry.lastResult.stopped, false)
  }
  assert.equal(h.registry.closedRootObligations.total, 130)
  assert.ok(h.registry.recentClosed.length <= 64)
  let replayCount = 0
  for (const sid of ids) if ((await h.route('/api/pty/stream', {}, sid)).status === 200) replayCount++
  assert.equal(replayCount, 12, 'closed replay memory is explicitly bounded independently of active slots')
  const status = await h.route('/api/pty/status')
  assert.equal(status.body.treeStop.unconfirmedClosedTrees, 130)
  assert.equal(status.body.treeStop.last.treeStopped, false)
  const before = calls
  for (const entry of owned) assert.equal((await entry.stop()).stopped, false)
  assert.equal(calls, before, 'retired roots must not be re-killed by reused numeric PID')
  const closed = await h.route('/api/pty/close', { sid: ids.at(-1) })
  assert.equal(closed.status, 503)
  assert.equal(calls, before)
  const results = await h.shutdown()
  assert.equal(results.length, 1)
  assert.equal(results[0].stopped, false)
  assert.equal(results[0].reason, 'closed-root-obligations')
  assert.equal(calls, before, 'shutdown reports aggregate rather than retrying retired PIDs')
})

test('live failed stop keeps capacity; close/shutdown await stop and retry only the live entry', async () => {
  let resolveStop,
    calls = 0
  let next = new Promise((resolve) => {
    resolveStop = resolve
  })
  const h = harness({
    limit: 1,
    stop: async () => {
      calls++
      return next
    },
  })
  const opened = await h.route('/api/pty/open', { name: 'portable' })
  const child = h.children[0],
    sid = opened.body.sid
  let returned = false
  const close = h.route('/api/pty/close', { sid }).then((value) => {
    returned = true
    return value
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(returned, false, 'HTTP success cannot precede stop confirmation')
  resolveStop({ stopped: false })
  assert.equal((await close).status, 503)
  assert.equal(h.registry.entries.has(child), true)
  assert.equal((await h.route('/api/pty/open', { name: 'saturated' })).status, 503)
  assert.equal(h.children.length, 1, 'failed live stop still blocks capacity before spawn')
  assert.equal((await h.route('/api/pty/stream', {}, sid)).status, 200)
  const before = calls
  next = new Promise((resolve) => {
    resolveStop = resolve
  })
  let shutdownReturned = false
  const shutdown = h.shutdown().then((value) => {
    shutdownReturned = true
    return value
  })
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(shutdownReturned, false)
  assert.ok(calls > before)
  resolveStop({ stopped: true, reason: 'confirmed' })
  const results = await shutdown
  assert.equal(results[0].stopped, true)
  assert.equal(h.registry.entries.has(child), false)
  assert.equal((await h.route('/api/pty/stream', {}, sid)).status, 404)
  assert.equal((await h.route('/api/pty/open', { name: 'after-shutdown' })).status, 503)
  assert.equal(h.children.length, 1)
})
