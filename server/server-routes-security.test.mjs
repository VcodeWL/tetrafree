/* Direct middleware fixtures, no listen()/start(), HTTP/browser or external targets. */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { EventEmitter } from 'node:events'

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-route-safe-'))
process.env.TF_DATA = path.join(temp, 'data')
process.env.TF_ROOT = path.join(temp, 'projects')
process.env.TF_RATE_MULT = '20'
delete process.env.TF_SERVE
delete process.env.SMTP_URL
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
fs.mkdirSync(process.env.TF_DATA)
const fixtureUser = {
  id: 'u_fixture',
  email: 'fixture@unit.invalid',
  name: 'Fixture',
  verified: true,
  totp: { enabled: true, secret: 'JBSWY3DPEHPK3PXP' },
}
fs.writeFileSync(
  path.join(process.env.TF_DATA, 'db.json'),
  JSON.stringify({
    users: { u_fixture: fixtureUser },
    sessions: {
      [sha('unit-token')]: {
        id: sha('unit-token'),
        userId: 'u_fixture',
        exp: Date.now() + 600000,
        lastAt: Date.now(),
      },
    },
  }),
)
const { accountRoutes, flushDb, postAuthentication } = await import('./auth.mjs')
const { tetraMiddleware, fnv } = await import('./tetra-server.mjs')
const { outbox } = await import('./mail.mjs')
const account = async (url, body) => {
  let result
  await accountRoutes(
    {
      method: 'POST',
      headers: { host: '127.0.0.1', origin: 'http://127.0.0.1' },
      socket: { remoteAddress: '127.0.0.1' },
    },
    {},
    new URL('http://unit.invalid' + url),
    {
      isLocal: true,
      readBody: async () => body,
      json: (_res, status, data) => {
        result = { status, data }
      },
    },
  )
  return result
}
const route = async (url, body = {}, method = 'POST') => {
  const req = new EventEmitter()
  req.url = url
  req.method = method
  req.headers = { host: '127.0.0.1', authorization: 'Bearer unit-token' }
  req.socket = { remoteAddress: '127.0.0.1' }
  req.setEncoding = () => {}
  req.destroy = () => {}
  const res = new EventEmitter()
  res.writeHead = (status, headers) => {
    res.status = status
    res.headers = headers
    res.headersSent = true
  }
  let resolve
  const result = new Promise((r) => {
    resolve = r
  })
  res.end = (data) => {
    resolve({ status: res.status, data: data ? JSON.parse(data) : null })
  }
  tetraMiddleware()(req, res, () => {
    resolve({ status: 404 })
  })
  await new Promise((r) => setImmediate(r))
  req.emit('data', JSON.stringify(body))
  req.emit('end')
  return result
}

test.after(async () => {
  flushDb()
  process.removeListener('exit', flushDb)
  await fsp.rm(temp, { recursive: true, force: true })
})

test('pending registration retains original credentials and challenge ownership', async () => {
  const input = { name: 'Original Name', email: 'pending@unit.invalid', password: 'Str0ng!Pass7' }
  assert.equal((await account('/api/auth/register', input)).status, 201)
  flushDb()
  const before = JSON.parse(fs.readFileSync(path.join(process.env.TF_DATA, 'db.json')))
  const user = Object.values(before.users).find((u) => u.email === input.email)
  assert.equal(
    (await account('/api/auth/register', { ...input, name: 'Different Name', password: 'OtherStr0ng!Pass9' }))
      .status,
    409,
  )
  assert.equal((await account('/api/auth/register', { ...input, name: 'Different Name' })).status, 201)
  flushDb()
  const after = JSON.parse(fs.readFileSync(path.join(process.env.TF_DATA, 'db.json')))
  assert.equal(after.users[user.id].passHash, user.passHash)
  assert.equal(after.users[user.id].name, input.name)
  assert.equal(after.codes['verify:' + input.email].owner, sha(user.id + ':' + user.passHash))
  const code = outbox.find((m) => m.to === input.email).subject.slice(0, 6)
  assert.equal((await account('/api/auth/verify', { email: input.email, code })).status, 200)
})

test('unified local MFA returns only limited challenge, no session', () => {
  flushDb()
  const before = JSON.parse(fs.readFileSync(path.join(process.env.TF_DATA, 'db.json')))
  const result = postAuthentication(fixtureUser, { headers: {}, socket: {} }, true)
  assert.equal(result.need, '2fa')
  assert.equal(typeof result.ticket, 'string')
  assert.equal(result.token, undefined)
  assert.equal(result.user, undefined)
  flushDb()
  const after = JSON.parse(fs.readFileSync(path.join(process.env.TF_DATA, 'db.json')))
  assert.deepEqual(after.sessions, before.sessions)
  const source = fs.readFileSync(new URL('./auth.mjs', import.meta.url), 'utf8')
  const exchange = source.slice(
    source.indexOf("if (p === '/api/auth/oauth/exchange'"),
    source.indexOf('/* ——— дальше нужен вход'),
  )
  assert.match(exchange, /postAuthentication\(user, req, true, t\.epoch\)/)
  assert.ok(!exchange.includes('newSession('))
})

test('batch CAS rejects stale write/delete and missing expectation without touching file', async () => {
  const root = path.join(temp, 'cas')
  await fsp.mkdir(root)
  await fsp.writeFile(path.join(root, 'a.txt'), 'fresh')
  let result = await route('/api/fs/batch', {
    folder: root,
    write: { 'a.txt': 'replacement' },
    expectedHashes: { 'a.txt': fnv('stale') },
  })
  assert.equal(result.status, 200)
  assert.equal(result.data.failed[0].code, 'CONFLICT')
  assert.equal(await fsp.readFile(path.join(root, 'a.txt'), 'utf8'), 'fresh')
  result = await route('/api/fs/batch', {
    folder: root,
    remove: ['a.txt'],
    expectedHashes: { 'a.txt': null },
  })
  assert.equal(result.data.failed[0].code, 'CONFLICT')
  assert.equal(fs.existsSync(path.join(root, 'a.txt')), true)
  result = await route('/api/fs/batch', {
    folder: root,
    write: { 'a.txt': 'replacement', 'new.txt': 'new' },
    expectedHashes: { 'a.txt': fnv('fresh'), 'new.txt': null },
  })
  assert.deepEqual(result.data.failed, [])
  assert.equal(await fsp.readFile(path.join(root, 'a.txt'), 'utf8'), 'replacement')
})

test('rmdirs and read reject symlink-parent, explicit old preview failure', async () => {
  const root = path.join(temp, 'link-project'),
    other = path.join(temp, 'benign-other')
  await fsp.mkdir(root)
  await fsp.mkdir(other)
  await fsp.mkdir(path.join(other, 'empty'))
  await fsp.writeFile(path.join(other, 'fixture.txt'), 'fixture')
  try {
    await fsp.symlink(other, path.join(root, 'link'), 'junction')
  } catch (e) {
    if (e.code === 'EPERM') return
    throw e
  }
  const result = await route('/api/fs/batch', { folder: root, rmdirs: ['link/empty'] })
  assert.equal(result.data.failed.length, 1)
  assert.equal(fs.existsSync(path.join(other, 'empty')), true)
  assert.equal(
    (await route('/api/fs/read', { folder: root, paths: ['link/fixture.txt'] })).data.files[
      'link/fixture.txt'
    ],
    null,
  )
  assert.equal((await route('/preview/00000000000000000000000000000000/project/', {}, 'GET')).status, 410)
})

test('Git file routes reject resolved external parent before diff/discard', async () => {
  const root = path.join(temp, 'git-fixture'),
    other = path.join(temp, 'git-other')
  await fsp.mkdir(root)
  await fsp.mkdir(other)
  await fsp.writeFile(path.join(other, 'fixture.txt'), 'benign fixture')
  try {
    await fsp.symlink(other, path.join(root, 'link'), 'junction')
  } catch (e) {
    if (e.code === 'EPERM') return
    throw e
  }
  for (const op of ['diff', 'discard', 'blame']) {
    const r = await route('/api/git/' + op, { folder: root, path: 'link/fixture.txt' })
    if (r.data?.reason === 'git не установлен') continue
    assert.equal(r.status, 400)
  }
  assert.equal(await fsp.readFile(path.join(other, 'fixture.txt'), 'utf8'), 'benign fixture')
})

test('exec middleware decodes split UTF8, sanitized env and returned cwd/status on fake child', async () => {
  const cp = (await import('node:child_process')).default
  const { syncBuiltinESMExports } = await import('node:module')
  const { PassThrough } = await import('node:stream')
  const root = path.join(temp, 'exec-fixture')
  await fsp.mkdir(path.join(root, 'sub'), { recursive: true })
  const previous = cp.spawn
  let seenEnv
  cp.spawn = (exe, args, options) => {
    if (exe === 'taskkill.exe') {
      assert.deepEqual(args, ['/PID', '99999999', '/T', '/F'])
      const task = new EventEmitter()
      queueMicrotask(() => {
        task.emit('exit', 0)
        task.emit('close', 0)
      })
      return task
    }
    seenEnv = options.env
    const child = new EventEmitter()
    child.stdin = new PassThrough()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.pid = 99999999
    const script = options.env.TF_EXEC_WRAPPER
      ? fs.readFileSync(options.env.TF_EXEC_WRAPPER, 'utf8')
      : args.join(' ')
    const marker = script.match(/__TF_CWD_[a-f0-9]+__/)[0]
    if (options.env.TF_EXEC_COMMAND)
      assert.equal(fs.readFileSync(options.env.TF_EXEC_COMMAND, 'utf8'), 'unit-fixture-not-executed\r\n')
    queueMicrotask(() => {
      const bytes = Buffer.from('Привет😀')
      for (const byte of bytes) child.stdout.write(Buffer.from([byte]))
      child.stderr.write(Buffer.from('Ошибка').subarray(0, 1))
      child.stderr.write(Buffer.from('Ошибка').subarray(1))
      child.stdout.write(`\n${marker}${path.join(root, 'sub')}\n`)
      child.stdout.end()
      child.stderr.end()
      child.emit('close', 7, null)
    })
    return child
  }
  syncBuiltinESMExports()
  try {
    const req = new EventEmitter()
    Object.assign(req, {
      url: '/api/exec',
      method: 'POST',
      headers: { host: '127.0.0.1', authorization: 'Bearer unit-token' },
      socket: { remoteAddress: '127.0.0.1' },
      setEncoding() {},
    })
    const res = new EventEmitter()
    let output = '',
      resolve
    const done = new Promise((r) => {
      resolve = r
    })
    Object.assign(res, {
      writableLength: 0,
      writeHead(status) {
        this.status = status
      },
      write(line) {
        output += line
        return true
      },
      end() {
        resolve()
      },
    })
    tetraMiddleware()(req, res, () => assert.fail('exec handler expected'))
    await new Promise((r) => setImmediate(r))
    req.emit('data', JSON.stringify({ folder: root, cmd: 'unit-fixture-not-executed', runId: 'fixture' }))
    req.emit('end')
    await done
    assert.equal(res.status, 200)
    const records = output.trim().split('\n').map(JSON.parse)
    assert.equal(
      records
        .filter((r) => r.t === 'o')
        .map((r) => r.d)
        .join(''),
      'Привет😀',
    )
    assert.equal(
      records
        .filter((r) => r.t === 'e')
        .map((r) => r.d)
        .join(''),
      'Ошибка',
    )
    assert.deepEqual(records.at(-1), { t: 'x', code: 7, cwd: 'sub', treeStopped: true })
    assert.equal(seenEnv.TF_DATA, undefined)
    assert.equal(seenEnv.SMTP_URL, undefined)
    if (seenEnv.TF_EXEC_WRAPPER) assert.equal(fs.existsSync(seenEnv.TF_EXEC_WRAPPER), false)
  } finally {
    cp.spawn = previous
    syncBuiltinESMExports()
  }
})

test('exec cancellation accepted before request prevents spawning', async () => {
  const root = path.join(temp, 'cancel-before')
  await fsp.mkdir(root)
  const cp = (await import('node:child_process')).default
  const { syncBuiltinESMExports } = await import('node:module')
  const original = cp.spawn
  let launches = 0
  cp.spawn = () => {
    launches++
    throw new Error('Must not launch cancelled command')
  }
  syncBuiltinESMExports()
  try {
    const kill = await route('/api/exec/kill', { runId: 'prelaunch-fixture' })
    assert.equal(kill.status, 200)
    assert.equal(kill.data.cancelled, true)
    const result = await route('/api/exec', { folder: root, cmd: 'not-executed', runId: 'prelaunch-fixture' })
    assert.equal(result.status, 200)
    assert.equal(result.data.t, 'x')
    assert.equal(result.data.code, 130)
    assert.equal(launches, 0)
  } finally {
    cp.spawn = original
    syncBuiltinESMExports()
  }
})

test('kill during async preparation sets persistent pending cancellation bit', async () => {
  const root = path.join(temp, 'cancel-preparing')
  await fsp.mkdir(root)
  const cp = (await import('node:child_process')).default
  const { syncBuiltinESMExports } = await import('node:module')
  const originalSpawn = cp.spawn,
    originalStat = fsp.stat
  let release,
    entered,
    launches = 0,
    first = true
  const gate = new Promise((r) => {
      release = r
    }),
    started = new Promise((r) => {
      entered = r
    })
  fsp.stat = async (...args) => {
    if (args[0] === root && first) {
      first = false
      entered()
      await gate
    }
    return originalStat(...args)
  }
  cp.spawn = () => {
    launches++
    throw new Error('Cancelled preparation must not launch')
  }
  syncBuiltinESMExports()
  try {
    const execution = route('/api/exec', { folder: root, cmd: 'not-executed', runId: 'preparing-fixture' })
    await started
    assert.equal((await route('/api/exec/kill', { runId: 'preparing-fixture' })).status, 200)
    release()
    const result = await execution
    assert.equal(result.data.code, 130)
    assert.equal(launches, 0)
  } finally {
    release()
    cp.spawn = originalSpawn
    fsp.stat = originalStat
    syncBuiltinESMExports()
  }
})
