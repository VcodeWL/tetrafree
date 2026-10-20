import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { ptyDimensions, ptyWrite, ptyRoutes, shutdownPty, hasPty, ptyDiagnostics } from './pty.mjs'
import { CONPTY_CS } from './conpty-win.mjs'

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
    this.writableLength += Buffer.byteLength(data)
    return false
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

test('dimensions strictly reject fractional/non-finite/coerced values for both axes', () => {
  assert.deepEqual(ptyDimensions(), [80, 24])
  assert.deepEqual(ptyDimensions(1, 10000), [20, 200])
  for (const value of [80.5, NaN, Infinity, -Infinity, '80', null, true, {}, []]) {
    assert.throws(() => ptyDimensions(value, 24))
    assert.throws(() => ptyDimensions(80, value))
  }
})

test('slow subscriber is disconnected at finite backlog, never unbounded queued', () => {
  const res = new Response()
  const payload = { d: Buffer.alloc(65536).toString('base64') }
  let writes = 0
  while (ptyWrite(res, payload)) writes++
  assert.ok(writes > 0 && writes < 10)
  assert.ok(res.writableLength <= 512 * 1024)
  assert.equal(res.destroyed, true)
  assert.equal(ptyWrite(res, payload), false)
})

test('closed stream and thrown write do not escape into server', () => {
  const res = new Response()
  res.write = () => {
    throw new Error('socket closed')
  }
  assert.equal(ptyWrite(res, { x: 1 }), false)
  assert.equal(res.destroyed, true)
})

test('native source preserves std handles, fails closed on job ownership and keeps 32-bit status (static)', () => {
  assert.match(CONPTY_CS, /dwFlags = 0x00000100/)
  assert.match(CONPTY_CS, /false, 0x00080000 \| 0x00000004/)
  assert.match(CONPTY_CS, /AssignProcessToJobObject\(job, hProc\)/)
  assert.match(CONPTY_CS, /ResumeThread\(pi.hThread\)/)
  assert.match(CONPTY_CS, /Environment.Exit\(unchecked\(\(int\)code\)\)/)
  assert.doesNotMatch(CONPTY_CS, /code & 0xFF/)
  assert.match(CONPTY_CS, /cols < 20 \|\| cols > 500/)
  assert.match(CONPTY_CS, /r >= 5 && r <= 200/)
})

test('authenticated route status distinguishes helper availability from observed runtime', async () => {
  const res = new Response()
  await ptyRoutes({ method: 'GET' }, res, new URL('http://localhost/api/pty/status'), {
    json: (target, status, body) => {
      target.status = status
      target.body = body
    },
  })
  assert.equal(res.status, 200)
  assert.equal(typeof res.body.helperAvailable, 'boolean')
  assert.ok(['unproven', 'output-observed', 'failed'].includes(res.body.runtime))
  assert.ok('lastFailure' in res.body)
})

test('actual routes: open/resize reject fractions; cap live subscribers; cleanup', async (t) => {
  const deadline = Date.now() + 65000
  while (!hasPty() && process.platform === 'win32' && Date.now() < deadline)
    await new Promise((r) => setTimeout(r, 100))
  if (!hasPty()) return t.skip('native PTY helper unavailable')
  const route = async (pathname, body = {}, res = new Response(), sid) => {
    await ptyRoutes(
      { method: 'POST' },
      res,
      new URL(`http://localhost${pathname}${sid ? '?sid=' + sid : ''}`),
      {
        readBody: async () => body,
        projectDir: async () => process.cwd(),
        json: (target, status, value) => {
          target.status = status
          target.body = value
        },
      },
    )
    return res
  }
  let sid
  try {
    assert.equal((await route('/api/pty/open', { cols: 80.5, rows: 24 })).status, 400)
    const opened = await route('/api/pty/open', { name: 'pty-regression', cols: 80, rows: 24 })
    assert.equal(opened.status, 200)
    sid = opened.body.sid
    assert.equal((await route('/api/pty/resize', { sid, cols: 80, rows: 24.5 })).status, 400)
    for (let i = 0; i < 4; i++)
      assert.equal((await route('/api/pty/stream', {}, new Response(), sid)).status, 200)
    const overflow = await route('/api/pty/stream', {}, new Response(), sid)
    assert.equal(overflow.status, 429)
    assert.equal((await route('/api/pty/input', { sid, d: 'A'.repeat(88001) })).status, 429)
    assert.equal((await route('/api/pty/close', { sid })).status, 200)
    assert.equal((await route('/api/pty/stream', {}, new Response(), sid)).status, 404)
    assert.equal(ptyDiagnostics().helperAvailable, true)
  } finally {
    await shutdownPty()
  }
})
