/* MCP synthetic config/stream fixtures only; no subprocesses/listeners/network. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { McpClient, createPool, mcpRoutes, approvals, overrideSummary } from './mcp.mjs'
const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tf-mcp-second-'))
await fsp.mkdir(path.join(dir, '.tetra'))
const configFile = path.join(dir, '.tetra/mcp.json'),
  apFile = path.join(dir, 'approvals.json')
const config = (arg) =>
  fs.writeFileSync(
    configFile,
    JSON.stringify({
      mcpServers: {
        fixture: {
          command: 'fixture-not-executed',
          args: [arg],
          env: { TOKEN: 'SYNTHETIC_SECRET', COLOR: '${COLOR}' },
        },
      },
    }),
  )
const call = async (pool, endpoint, body = {}) => {
  let result
  await mcpRoutes(
    { method: 'POST' },
    {},
    new URL('http://unit.invalid/api/mcp/' + endpoint),
    {
      readBody: async () => body,
      projectDir: async () => dir,
      json: (_r, status, data) => {
        result = { status, data }
      },
    },
    { pool, approvalsFile: apFile },
  )
  return result
}
test.after(async () => {
  await fsp.rm(dir, { recursive: true, force: true })
})

test('approval confirms displayed exact hash; owner slot stops old version after disk change', async () => {
  const pool = createPool()
  config('first')
  try {
    const first = (await call(pool, 'status')).data.servers[0]
    assert.match(first.hash, /^[0-9a-f]{64}$/)
    assert.ok(!JSON.stringify(first).includes('SYNTHETIC_SECRET'))
    config('second')
    assert.equal((await call(pool, 'approve', { server: 'fixture', expectedHash: first.hash })).status, 409)
    const second = (await call(pool, 'status')).data.servers[0]
    assert.equal(approvals(apFile).has(second.hash), false)
    assert.equal((await call(pool, 'approve', { server: 'fixture', expectedHash: second.hash })).status, 200)
    const owner = JSON.stringify([fs.realpathSync(dir), 'fixture'])
    let closed = false
    await pool.get(
      first.hash,
      () => ({
        closed: false,
        lastUse: Date.now(),
        cfg: { type: 'stdio', command: 'fixture', args: [] },
        start: async () => {},
        close() {
          closed = true
          this.closed = true
        },
      }),
      owner,
    )
    assert.equal((await call(pool, 'status')).data.servers[0].runningHash, first.hash)
    fs.unlinkSync(configFile)
    assert.equal((await call(pool, 'status')).data.servers[0].missing, true)
    assert.equal((await call(pool, 'stop', { server: 'fixture', expectedHash: first.hash })).status, 200)
    assert.equal(closed, true)
    assert.equal(pool.pool.size, 0)
  } finally {
    await pool.closeAll()
  }
})

const transport = ({ write, stopResult = { stopped: true } } = {}) => {
  const child = new EventEmitter()
  child.pid = 12345
  child.stdin = new EventEmitter()
  child.stdin.writable = true
  child.stdin.writableLength = 0
  child.stdin.end = () => {}
  child.stdin.write = write || (() => false)
  child.stdout = new EventEmitter()
  child.stdout.setEncoding = () => {}
  child.stderr = new EventEmitter()
  child.stderr.setEncoding = () => {}
  let stops = 0
  const client = new McpClient(
    { type: 'stdio', command: 'fixture-not-executed', args: [], env: {} },
    {
      cwd: dir,
      launch: () => child,
      processes: {
        available: () => true,
        own: () => ({
          stop: async () => {
            stops++
            return stopResult
          },
        }),
      },
    },
  )
  return { child, client, stops: () => stops }
}

test('stdin error rejects pending initialization and closes ownership without unhandled EPIPE', async () => {
  const { child, client, stops } = transport()
  const pending = assert.rejects(client.start(), /Связь с сервером MCP прервана/)
  child.stdin.emit('error', Object.assign(new Error('SYNTHETIC_PRIVATE_DETAIL'), { code: 'EPIPE' }))
  await pending
  await client.close()
  assert.equal(client.waits.size, 0)
  assert.equal(client.closed, true)
  assert.equal(stops(), 1)
})

test('request and outgoing byte bounds reject without stale waits, close clears queue', async () => {
  const { client } = transport()
  const init = client.start().catch(() => {})
  const oversized = client.request('fixture', { text: 'a'.repeat(256 * 1024) })
  await assert.rejects(oversized, /очередь/)
  assert.equal(client.waits.size, 1)
  const requests = Array.from({ length: 31 }, () => client.request('fixture', {}).catch(() => {}))
  await assert.rejects(client.request('fixture', {}), /Слишком много/)
  assert.ok(client.outgoingBytes <= 256 * 1024)
  await client.close()
  await Promise.all([init, ...requests])
  assert.equal(client.waits.size, 0)
  assert.equal(client.outgoingBytes, 0)
})

test('stdio writes wait for callback and drain; synchronous write failure cleans waits', async () => {
  let callback,
    writes = 0
  const fixture = transport({
    write: (_line, cb) => {
      writes++
      callback = cb
      return false
    },
  })
  const init = fixture.client.start().catch(() => {})
  const notify = fixture.client.notify('fixture').catch(() => {})
  assert.equal(writes, 1)
  callback()
  await Promise.resolve()
  assert.equal(writes, 1)
  fixture.child.stdin.emit('drain')
  await Promise.resolve()
  assert.equal(writes, 2)
  await fixture.client.close()
  await Promise.all([init, notify])
  const broken = transport({
    write: () => {
      throw new Error('SYNTHETIC_PRIVATE_DETAIL')
    },
  })
  await assert.rejects(broken.client.start(), /Связь|отправки/)
  await broken.client.close()
  assert.equal(broken.client.waits.size, 0)
})

test('root exit still awaits descendant cleanup, unconfirmed stop remains retryable', async () => {
  const fixture = transport({ stopResult: { stopped: false, reason: 'fixture-unconfirmed' } })
  const init = fixture.client.start().catch(() => {})
  fixture.child.emit('exit', 0)
  const first = await fixture.client.close()
  assert.equal(first.stopped, false)
  assert.equal(fixture.stops(), 1)
  await fixture.client.close()
  assert.equal(fixture.stops(), 2)
  await init
})

test('remote diagnostics and source values are not exposed by MCP error routes', async () => {
  config('safe')
  const real = createPool(),
    item = (await call(real, 'status')).data.servers[0]
  await call(real, 'approve', { server: 'fixture', expectedHash: item.hash })
  const logs = [],
    old = console.error
  console.error = (...args) => logs.push(args.join(' '))
  const pool = {
    ...real,
    get: async () => {
      throw new Error('SYNTHETIC_PRIVATE_DETAIL')
    },
  }
  try {
    const result = await call(pool, 'tools', { server: 'fixture' })
    assert.equal(result.status, 502)
    assert.match(result.data.error.correlationId, /^[0-9a-f]{16}$/)
    assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE_DETAIL'))
    assert.ok(!logs.join(' ').includes('SYNTHETIC_PRIVATE_DETAIL'))
    assert.deepEqual(overrideSummary({ type: 'http', headers: { Authorization: 'dummy-value' } }), [
      'Authorization=[скрыто]',
    ])
  } finally {
    console.error = old
    await real.closeAll()
  }
})
