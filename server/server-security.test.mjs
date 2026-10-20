/* Defensive unit fixtures only: no listeners, no live network, no exploit chain. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { StringDecoder } from 'node:string_decoder'
import { inside, realInside, finalFile, matchesExpected, fnv, withProjectLock } from './fs-safety.mjs'
import { childEnv, winScripts, boundedSend } from './process-safety.mjs'
import { isPrivateIp, checkUrl } from './web.mjs'
import { createPool, rpcResult, McpClient } from './mcp.mjs'
import { createPreview, PREVIEW_CSP } from './preview.mjs'

const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tf-safe-'))
test.after(async () => {
  await fsp.rm(dir, { recursive: true, force: true })
})

test('final-file containment and metadata exclusion', async () => {
  const root = path.join(dir, 'project'),
    sibling = path.join(dir, 'sibling')
  await fsp.mkdir(root)
  await fsp.mkdir(sibling)
  await fsp.mkdir(path.join(root, 'site'))
  await fsp.writeFile(path.join(sibling, 'fixture.html'), 'benign fixture')
  await fsp.writeFile(path.join(root, 'ok.html'), '<p>OK</p>')
  assert.equal(await finalFile(root, 'ok.html'), path.join(root, 'ok.html'))
  assert.throws(() => inside(root, '../sibling/fixture.html'))
  try {
    await fsp.symlink(path.join(sibling, 'fixture.html'), path.join(root, 'site/index.html'))
  } catch (e) {
    if (e.code === 'EPERM') return
    throw e
  }
  await assert.rejects(finalFile(root, 'site'), /за пределы/)
  await fsp.mkdir(path.join(root, '.tetra'))
  await fsp.writeFile(path.join(root, '.tetra/config.json'), '{}')
  await assert.rejects(finalFile(root, '.tetra/config.json', { preview: true }))
  await realInside(root, path.join(root, 'new/sub/file'))
})

test('CAS hash/null checks; serialized own writers', async () => {
  const root = path.join(dir, 'cas')
  await fsp.mkdir(root)
  assert.equal(await matchesExpected(root, 'a.txt', null), true)
  await fsp.writeFile(path.join(root, 'a.txt'), 'Привет')
  assert.equal(await matchesExpected(root, 'a.txt', fnv('Привет')), true)
  assert.equal(await matchesExpected(root, 'a.txt', null), false)
  assert.equal(await matchesExpected(root, 'a.txt', fnv('old')), false)
  let unblock
  const gate = new Promise((r) => {
    unblock = r
  })
  const order = []
  const first = withProjectLock(root, async () => {
    order.push(1)
    await gate
    order.push(2)
  })
  await new Promise((r) => setTimeout(r, 10))
  const second = withProjectLock(root, async () => {
    order.push(3)
  })
  await new Promise((r) => setTimeout(r, 10))
  assert.deepEqual(order, [1])
  unblock()
  await Promise.all([first, second])
  assert.deepEqual(order, [1, 2, 3])
})

test('semantic IP equivalents, no network', () => {
  for (const ip of [
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    '0:0:0:0:0:ffff:7f00:1',
    '::',
    'ff02::1',
    '2002:7f00:1::',
    '64:ff9b::7f00:1',
    'invalid',
  ])
    assert.equal(isPrivateIp(ip), true, ip)
  for (const ip of ['8.8.8.8', '::ffff:808:808', '2606:4700::1111']) assert.equal(isPrivateIp(ip), false, ip)
  assert.throws(() => checkUrl('http://[::ffff:7f00:1]/'))
})

test('environment strips server-only secrets case-insensitively, explicit env retained', () => {
  const env = childEnv(
    { PROJECT_VALUE: 'yes' },
    {
      PATH: '/fixture',
      SMTP_URL: 'dummy',
      github_client_secret: 'dummy',
      TF_DATA: 'dummy',
      GIT_DIR: 'dummy',
      PROJECT_VALUE: 'old',
    },
  )
  assert.deepEqual(env, { PATH: '/fixture', PROJECT_VALUE: 'yes' })
})

test('Windows wrapper separates command, late cwd and preserved status; UTF8 decoder', () => {
  const s = winScripts('cd sub\necho Привет', 'marker')
  assert.match(s.command, /cd sub\r\n/)
  assert.match(s.wrapper, /call "%TF_EXEC_COMMAND%"\r\nset "TF_EXEC_STATUS=%ERRORLEVEL%"\r\n/)
  assert.match(s.wrapper, /echo marker%CD%\r\nexit \/b %TF_EXEC_STATUS%/)
  assert.ok(!s.wrapper.includes('delayedexpansion'))
  const decoder = new StringDecoder('utf8'),
    bytes = Buffer.from('Привет😀')
  let text = ''
  for (const byte of bytes) text += decoder.write(Buffer.from([byte]))
  text += decoder.end()
  assert.equal(text, 'Привет😀')
})

test('bounded response queue disconnects slow consumer without further writes', () => {
  let stopped = 0,
    writes = 0
  const res = {
    writableLength: 20,
    destroyed: false,
    write: () => {
      writes++
      return false
    },
    destroy() {
      this.destroyed = true
    },
  }
  const send = boundedSend(
    res,
    () => {
      stopped++
    },
    80,
  )
  assert.equal(send({ d: 'small' }), false)
  assert.equal(writes, 1)
  res.writableLength = 75
  assert.equal(send({ d: 'small' }), false)
  assert.equal(stopped, 1)
  assert.equal(send({ d: 'small' }), false)
  assert.equal(writes, 1)
})

test('MCP parallel consumers await one initialization and rejection is shared', async () => {
  const pool = createPool()
  let resolve,
    started = 0,
    made = 0
  const gate = new Promise((r) => {
    resolve = r
  })
  const make = () => {
    made++
    return {
      lastUse: Date.now(),
      closed: false,
      start: () => {
        started++
        return gate
      },
      close() {
        this.closed = true
      },
    }
  }
  try {
    const a = pool.get('a', make)
    let ready = false
    const b = pool.get('a', make).then((x) => {
      ready = true
      return x
    })
    await Promise.resolve()
    assert.equal(ready, false)
    assert.equal(started, 1)
    assert.equal(made, 1)
    resolve()
    assert.equal(await a, await b)
    const fail = () => ({
      lastUse: Date.now(),
      closed: false,
      start: async () => {
        throw new Error('fixture failure')
      },
      close() {
        this.closed = true
      },
    })
    const results = await Promise.allSettled([pool.get('bad', fail), pool.get('bad', fail)])
    assert.ok(results.every((r) => r.status === 'rejected'))
    assert.equal(pool.pool.has('bad'), false)
  } finally {
    pool.closeAll()
  }
})

test('MCP revocation rejects starting waiters, does not delete replacement generation', async () => {
  const pool = createPool()
  let release
  const first = pool.get('x', () => ({
    lastUse: Date.now(),
    closed: false,
    start: () =>
      new Promise((r) => {
        release = r
      }),
    close() {
      this.closed = true
    },
  }))
  const settled = assert.rejects(first, /закрыто/)
  await Promise.resolve()
  pool.stop('x')
  const next = await pool.get('x', () => ({
    lastUse: Date.now(),
    closed: false,
    start: async () => {},
    close() {
      this.closed = true
    },
  }))
  await settled
  release()
  await Promise.resolve()
  assert.equal(pool.pool.get('x'), next)
  pool.closeAll()
})

test('JSON-RPC matching ID/version/result/error and HTTP transport fake', async () => {
  assert.deepEqual(rpcResult({ jsonrpc: '2.0', id: 7, result: {} }, 7), {})
  for (const r of [
    { jsonrpc: '2.0', id: 8, result: {} },
    { id: 7, result: {} },
    { jsonrpc: '2.0', id: 7, result: {}, error: {} },
    { jsonrpc: '2.0', id: 7, error: { message: 'bad' } },
  ])
    assert.throws(() => rpcResult(r, 7))
  const previous = globalThis.fetch
  globalThis.fetch = async (_url, opts) => {
    const m = JSON.parse(opts.body)
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: m.id + 1, result: {} }), {
      headers: { 'content-type': 'application/json' },
    })
  }
  try {
    const c = new McpClient({ type: 'http', url: 'https://unit.invalid/mcp', headers: {} })
    await assert.rejects(c.request('fixture', {}), /ID/)
  } finally {
    globalThis.fetch = previous
  }
})

class Reply extends EventEmitter {
  headers = {}
  body = ''
  status = 0
  writeHead(status, headers) {
    this.status = status
    this.headers = headers || {}
    return this
  }
  end(body = '') {
    this.body += body
    this.emit('done')
  }
  destroy() {
    this.destroyed = true
  }
}

test('preview fake listener serves only capability/project content with opaque sandbox', async () => {
  const root = path.join(dir, 'preview')
  await fsp.mkdir(root)
  await fsp.writeFile(path.join(root, 'index.html'), '<button>interactive</button>')
  let handler,
    active = true
  const fake = new EventEmitter()
  fake.address = () => ({ port: 45678 })
  fake.listen = (_port, _host, cb) => cb()
  fake.unref = () => {}
  fake.close = () => {}
  const preview = createPreview({
    sessionValid: () => active,
    createServer: (fn) => {
      handler = fn
      return fake
    },
  })
  try {
    const issued = await preview.issue(root, 'fixture-session')
    assert.equal(new URL(issued.url).origin, 'http://127.0.0.1:45678')
    assert.ok(issued.expiresAt > Date.now())
    assert.match(PREVIEW_CSP, /sandbox allow-scripts allow-forms/)
    assert.ok(!PREVIEW_CSP.includes('allow-same-origin'))
    const request = async (url) => {
      const res = new Reply(),
        done = new Promise((r) => res.once('done', r))
      handler(
        { method: 'HEAD', url, headers: { host: '127.0.0.1:45678' }, socket: { remoteAddress: '127.0.0.1' } },
        res,
      )
      await done
      return res
    }
    const res = await request(new URL(issued.url).pathname)
    assert.equal(res.status, 200)
    assert.equal(res.headers['content-security-policy'], PREVIEW_CSP)
    assert.equal((await request('/api/auth/me')).status, 401)
    active = false
    assert.equal((await request(new URL(issued.url).pathname)).status, 401)
  } finally {
    preview.close()
  }
})

test('Windows cancellation requests taskkill tree, without launching a process', async () => {
  const { killTree } = await import('./process-safety.mjs')
  let seen
  const mock = (_exe, args, options) => {
    seen = { exe: _exe, args, options }
    const child = new EventEmitter()
    child.unref = () => {}
    return child
  }
  killTree({ pid: 12345 }, 'SIGTERM', 'win32', mock)
  assert.equal(seen.exe, 'taskkill.exe')
  assert.deepEqual(seen.args, ['/PID', '12345', '/T', '/F'])
  assert.equal(seen.options.windowsHide, true)
})

test('bounded parent-control parses split shutdown once, EOF idempotent', async () => {
  const { parentControl } = await import('./process-safety.mjs')
  const input = new EventEmitter()
  input.setEncoding = () => {}
  let stopped = 0
  parentControl(input, async () => {
    stopped++
  })
  input.emit('data', '{"type":"tetra-')
  input.emit('data', 'shutdown"}\n{"type":"tetra-shutdown"}\n')
  input.emit('end')
  assert.equal(stopped, 1)
})
