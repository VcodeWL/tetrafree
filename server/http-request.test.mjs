import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import {
  readBody,
  json,
  failRequest,
  requestAccess,
  responseHeaders,
  requestScope,
  runRequest,
  assertRequestActive,
  streamResponse,
} from './http-request.mjs'
import { publicError } from './public-errors.mjs'

function request() {
  return Object.assign(new EventEmitter(), {
    headers: {},
    socket: { remoteAddress: '127.0.0.1' },
    pause() {
      this.paused = true
    },
    destroy() {
      this.destroyed = true
    },
  })
}
function response() {
  return Object.assign(new EventEmitter(), {
    headers: {},
    chunks: [],
    setHeader(key, value) {
      this.headers[key] = value
    },
    writeHead(status, headers) {
      this.status = status
      this.headersSent = true
      Object.assign(this.headers, headers)
    },
    write(chunk) {
      this.chunks.push(Buffer.from(chunk))
      return true
    },
    end(body) {
      this.body = body
      this.writableEnded = true
      this.emit('finish')
    },
    destroy() {
      this.destroyed = true
      this.emit('close')
    },
  })
}
function end(req, body) {
  req.emit('data', body)
  req.complete = true
  req.emit('end')
}
const status = (expected) => (error) => error.status === expected
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('UTF8 limit counts bytes and leaves response transport alive for 413', async () => {
  const req = request()
  const pending = readBody(req, { limit: 32 })
  const rejected = assert.rejects(pending, status(413))
  end(req, JSON.stringify({ text: 'я'.repeat(15) }))
  await rejected
  assert.equal(req.destroyed, undefined)
  assert.equal(req.paused, true)
  assert.equal(req.listenerCount('data'), 0)
})
test('split UTF8 buffers, empty bodies and JSON null retain API semantics', async () => {
  for (const text of ['', 'null', '{"text":"Привет"}']) {
    const req = request()
    const pending = readBody(req)
    for (const byte of Buffer.from(text)) req.emit('data', Buffer.from([byte]))
    req.complete = true
    req.emit('end')
    assert.deepEqual(await pending, text && text !== 'null' ? JSON.parse(text) : {})
    assert.equal(req.listenerCount('data'), 0)
    assert.equal(req.listenerCount('end'), 0)
    assert.equal(req.listenerCount('error'), 0)
  }
})
test('malformed body is 400 and cannot settle twice', async () => {
  const req = request()
  const pending = readBody(req)
  const rejected = assert.rejects(pending, status(400))
  end(req, '{')
  await rejected
  req.emit('data', '{}')
  req.emit('end')
  assert.equal(req.listenerCount('end'), 0)
})
test('JSON root must be an object, not an array or primitive', async () => {
  for (const text of ['[]', '1', 'true', '"text"']) {
    const req = request()
    const pending = readBody(req)
    const rejected = assert.rejects(pending, status(400))
    end(req, text)
    await rejected
  }
})
test('aborted, premature-close and pre-aborted bodies settle with 499', async () => {
  for (const event of ['aborted', 'close']) {
    const req = request()
    const pending = readBody(req)
    const rejected = assert.rejects(pending, status(499))
    req.emit(event)
    await rejected
    assert.equal(req.listenerCount('data'), 0)
  }
  const req = request()
  req.aborted = true
  await assert.rejects(readBody(req), status(499))
})
test('upstream signal cancels body and listeners are released', async () => {
  const controller = new AbortController()
  const req = request()
  const pending = readBody(req, { signal: controller.signal })
  const rejected = assert.rejects(pending, status(499))
  controller.abort()
  await rejected
  assert.equal(req.eventNames().length, 0)
})
test('body deadline is 408, and oversized content length is rejected before read', async () => {
  const req = request()
  const rejected = assert.rejects(readBody(req, { timeout: 5 }), status(408))
  await Promise.all([rejected, delay(10)])
  const oversized = request()
  oversized.headers['content-length'] = '50000001'
  await assert.rejects(readBody(oversized), status(413))
  assert.equal(oversized.listenerCount('data'), 0)
})
test('request read errors are public 400; repeated consumers share a single promise', async () => {
  const req = request()
  const first = readBody(req)
  assert.equal(first, readBody(req))
  const rejected = assert.rejects(first, status(400))
  req.emit('error', new Error('synthetic private detail'))
  await rejected
  assert.equal(req.listenerCount('data'), 0)
})
test('response helpers normalize status and avoid writes after completion', () => {
  const res = response()
  json(res, 700, { ok: true })
  assert.equal(res.status, 500)
  assert.equal(json(res, 200, {}), false)
  for (const invalid of [200, 0, 700, NaN]) {
    const r = response()
    failRequest(r, publicError(invalid, 'Проверка'))
    assert.equal(r.status, 500)
  }
  const closed = response()
  closed.destroy()
  failRequest(closed, publicError(400, 'Проверка'))
  assert.equal(closed.headersSent, undefined)
})
test('body budget failure retains 413 public message and connection-close response', async () => {
  const req = request(),
    res = response()
  const pending = readBody(req, { limit: 1 }).catch((error) => failRequest(res, error))
  end(req, '{}')
  await pending
  assert.equal(res.status, 413)
  assert.equal(res.headers.connection, 'close')
  assert.equal(JSON.parse(res.body).error.message, 'Слишком большой запрос')
})
test('CORS allows trusted Vite/Tauri origins and rejects opaque/untrusted origins', () => {
  for (const origin of [
    'http://localhost:3000',
    'http://127.0.0.1:3001',
    'https://tauri.localhost',
    'tauri://localhost',
    'http://[::1]:3000',
  ]) {
    const req = request(),
      res = response()
    req.headers = { host: 'localhost:3001', origin }
    assert.deepEqual(requestAccess(req, res, ''), { allowed: true, isLocal: true })
    assert.equal(responseHeaders(res)['access-control-allow-origin'], origin)
    assert.equal(responseHeaders(res).vary, 'Origin')
  }
  for (const origin of [
    'null',
    'https://untrusted.unit.invalid',
    'http://localhost/path',
    'http://user@localhost',
    'file://localhost',
  ]) {
    const req = request(),
      res = response()
    req.headers = { host: 'localhost', origin }
    assert.equal(requestAccess(req, res, '').allowed, false)
    assert.equal(responseHeaders(res)['access-control-allow-origin'], undefined)
  }
})
test('extra hosts do not become local; socket address is required and parsed', () => {
  const req = request(),
    res = response()
  req.headers = { host: 'team.unit.invalid:3001', origin: 'https://team.unit.invalid' }
  assert.deepEqual(requestAccess(req, res, 'team.unit.invalid'), { allowed: true, isLocal: false })
  req.headers.origin = 'https://other.unit.invalid'
  assert.equal(requestAccess(req, res, 'team.unit.invalid,other.unit.invalid').allowed, false)
  req.headers = { host: 'LOCALHOST:3001' }
  for (const address of ['', '192.0.2.1', '::ffff:127.invalid']) {
    req.socket.remoteAddress = address
    assert.equal(requestAccess(req, response(), '').isLocal, false)
  }
  for (const address of ['::ffff:127.0.0.1', '::ffff:7f00:1', '::1', '127.0.0.2']) {
    req.socket.remoteAddress = address
    assert.equal(requestAccess(req, response(), '').isLocal, true)
  }
})
test('request context follows response lifetime and cleans only its own listeners', async () => {
  const req = request(),
    res = response()
  let signal
  const unrelated = () => {}
  req.on('close', unrelated)
  await runRequest(
    req,
    res,
    async () => {
      signal = requestScope.getStore()
    },
    () => assert.fail('not routed'),
  )
  assert.equal(signal.aborted, false)
  req.complete = true
  req.emit('close')
  assert.equal(signal.aborted, false)
  res.end()
  assert.equal(req.listenerCount('close'), 1)
  assert.equal(res.listenerCount('close'), 0)
  assert.equal(res.listenerCount('error'), 0)
  res.emit('close')
  assert.equal(signal.aborted, false)
})
test('incomplete upload terminal error remains observed until request close', async () => {
  const req = request(),
    res = response()
  await runRequest(
    req,
    res,
    async () => {
      res.end()
    },
    () => {},
  )
  assert.doesNotThrow(() => req.emit('error', new Error('synthetic transport error')))
  req.closed = true
  req.emit('close')
  assert.equal(req.listenerCount('error'), 0)
})
test('disconnect cancels context; contexts remain isolated across async work', async () => {
  const a = request(),
    b = request(),
    ar = response(),
    br = response()
  let as, bs
  await Promise.all([
    runRequest(
      a,
      ar,
      async () => {
        as = requestScope.getStore()
        await delay(2)
        assert.equal(requestScope.getStore(), as)
      },
      () => {},
    ),
    runRequest(
      b,
      br,
      async () => {
        bs = requestScope.getStore()
        await delay(2)
        assert.equal(requestScope.getStore(), bs)
      },
      () => {},
    ),
  ])
  assert.notEqual(as, bs)
  ar.destroy()
  assert.equal(as.aborted, true)
  assert.equal(bs.aborted, false)
  requestScope.run(as, () => assert.throws(assertRequestActive, status(499)))
  br.end()
})
test('already aborted context cannot dispatch handler', async () => {
  const req = request(),
    res = response()
  req.aborted = true
  await runRequest(
    req,
    res,
    () => assert.fail('must not dispatch'),
    () => {},
  )
  assert.equal(res.status, 499)
})
test('stream splits large provider chunk into bounded writes preserving bytes', async () => {
  const res = response()
  const data = Buffer.alloc(150000, 7)
  await streamResponse(
    res,
    (async function* () {
      yield data
    })(),
  )
  assert.ok(res.chunks.every((chunk) => chunk.length <= 65536))
  assert.deepEqual(Buffer.concat(res.chunks), data)
  assert.equal(res.writableEnded, true)
})
test('blocked streaming cancels or times out and closes iterator/listeners', async () => {
  for (const mode of ['abort', 'timeout', 'close']) {
    const res = response(),
      controller = new AbortController()
    res.write = () => false
    let closed = false
    const pending = streamResponse(
      res,
      (async function* () {
        try {
          yield Buffer.from('fixture')
          assert.fail('must not pull next')
        } finally {
          closed = true
        }
      })(),
      { signal: controller.signal, drainTimeout: mode === 'timeout' ? 5 : 1000 },
    )
    const rejected = assert.rejects(pending, status(mode === 'timeout' ? 504 : 499))
    await delay(1)
    if (mode === 'abort') controller.abort()
    if (mode === 'close') res.destroy()
    await Promise.all([rejected, delay(10)])
    assert.equal(closed, true)
    assert.equal(res.listenerCount('drain'), 0)
    assert.equal(res.listenerCount('close'), 0)
  }
})
