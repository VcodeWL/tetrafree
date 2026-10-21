/* In-memory request/response fixtures only: no listen, browser, shell or provider. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'
import childProcess from 'node:child_process'
import http from 'node:http'
import { syncBuiltinESMExports } from 'node:module'
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-http-boundary-'))
process.env.TF_DATA = path.join(temp, 'data')
process.env.TF_ROOT = path.join(temp, 'projects')
delete process.env.TF_SERVE
delete process.env.SMTP_URL
const token = crypto.createHash('sha256').update('http-unit-token').digest('hex')
fs.mkdirSync(process.env.TF_DATA)
fs.writeFileSync(
  path.join(process.env.TF_DATA, 'db.json'),
  JSON.stringify({
    users: { fixture: { id: 'fixture', email: 'fixture@unit.invalid', verified: true } },
    sessions: { [token]: { id: token, userId: 'fixture', exp: Date.now() + 600000, lastAt: Date.now() } },
  }),
)
let launches = 0,
  listeners = 0
const originalSpawn = childProcess.spawn,
  originalCreateServer = http.createServer
childProcess.spawn = () => {
  launches++
  throw new Error('Unexpected child launch in HTTP fixture')
}
http.createServer = () => {
  listeners++
  throw new Error('Unexpected HTTP server in fixture')
}
syncBuiltinESMExports()
const { authed, flushDb } = await import('./auth.mjs')
const { tetraMiddleware } = await import('./tetra-server.mjs')
const tick = () => new Promise((r) => setImmediate(r))
function fixture(url, headers = {}) {
  const req = new EventEmitter()
  Object.assign(req, {
    url,
    method: 'POST',
    headers: { host: '127.0.0.1', authorization: 'Bearer http-unit-token', ...headers },
    socket: { remoteAddress: '127.0.0.1' },
    setEncoding() {},
    pause() {},
    destroy() {
      this.destroyed = true
    },
  })
  const res = new EventEmitter()
  let resolve
  const done = new Promise((r) => {
    resolve = r
  })
  Object.assign(res, {
    headers: {},
    writeHead(status, headers) {
      this.status = status
      this.headers = { ...this.headers, ...headers }
      this.headersSent = true
    },
    setHeader(k, v) {
      this.headers[k] = v
    },
    write() {
      return true
    },
    end(body) {
      this.writableEnded = true
      this.emit('finish')
      resolve({ status: this.status, body: body ? JSON.parse(body) : null })
    },
    destroy() {
      this.destroyed = true
      this.emit('close')
      resolve({ status: this.status })
    },
  })
  tetraMiddleware()(req, res, () => resolve({ status: 404 }))
  return {
    req,
    res,
    done,
    async body(body) {
      await tick()
      req.emit('data', Buffer.from(JSON.stringify(body)))
      req.complete = true
      req.emit('end')
      return done
    },
  }
}
test.after(() => {
  flushDb()
  process.removeListener('exit', flushDb)
  fs.rmSync(temp, { recursive: true, force: true })
  childProcess.spawn = originalSpawn
  http.createServer = originalCreateServer
  syncBuiltinESMExports()
  assert.equal(launches, 0)
  assert.equal(listeners, 0)
})
test('exec rejects session invalidated while body was in flight, without launch', async () => {
  const f = fixture('/api/exec')
  await tick()
  const user = authed(f.req).user
  const previous = user.securityEpoch
  user.securityEpoch = 1
  try {
    const result = await f.body({ runId: 'unit-run', cmd: '', folder: temp })
    assert.equal(result.status, 401)
  } finally {
    user.securityEpoch = previous
  }
})
test('preview rejects revoked in-flight body before capability issuance', async () => {
  const f = fixture('/api/preview')
  await tick()
  const user = authed(f.req).user,
    previous = user.securityEpoch
  user.securityEpoch = 1
  try {
    const result = await f.body({ folder: temp, path: 'index.html' })
    assert.equal(result.status, 401)
  } finally {
    user.securityEpoch = previous
  }
  assert.equal(listeners, 0)
})
test('trusted preflight reflects exact Origin; denied and opaque origins do not get CORS', async () => {
  const req = new EventEmitter(),
    res = new EventEmitter()
  Object.assign(req, {
    url: '/api/health',
    method: 'OPTIONS',
    headers: { host: '127.0.0.1', origin: 'http://localhost:3000' },
    socket: { remoteAddress: '127.0.0.1' },
  })
  let result
  res.setHeader = () => {}
  res.writeHead = (status, headers) => {
    result = { status, headers }
  }
  res.end = () => {
    res.writableEnded = true
    res.emit('finish')
  }
  await tetraMiddleware()(req, res, () => assert.fail('unexpected next'))
  assert.equal(result.status, 204)
  assert.equal(result.headers['access-control-allow-origin'], 'http://localhost:3000')
  for (const origin of ['null', 'https://untrusted.unit.invalid']) {
    const denied = fixture('/api/preview', { origin })
    const response = await denied.done
    assert.equal(response.status, 403)
    assert.equal(denied.res.headers['access-control-allow-origin'], undefined)
  }
})
test('proxy waits for response drain before pulling another upstream chunk', async () => {
  const oldFetch = globalThis.fetch
  let pulled = 0
  let release
  const finished = new Promise((r) => {
    release = r
  })
  globalThis.fetch = async () => ({
    status: 200,
    headers: new Map(),
    body: (async function* () {
      yield Buffer.from('one')
      pulled++
      yield Buffer.from('two')
      pulled++
    })(),
  })
  const f = fixture('/api/proxy')
  f.res.write = () => false
  const originalEnd = f.res.end
  f.res.end = function () {
    this.writableEnded = true
    this.emit('finish')
    release()
  }
  try {
    await tick()
    f.req.emit('data', JSON.stringify({ url: 'https://provider.unit.invalid' }))
    f.req.complete = true
    f.req.emit('end')
    await tick()
    assert.equal(pulled, 0, 'producer must remain suspended after first write(false)')
    f.res.write = () => true
    f.res.emit('drain')
    await finished
    assert.equal(pulled, 2)
  } finally {
    f.res.end = originalEnd
    f.res.destroy()
    globalThis.fetch = oldFetch
  }
})
