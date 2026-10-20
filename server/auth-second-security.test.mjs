/* Synthetic auth fixtures and a controlled scrypt wait; no sockets or providers. */
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-auth-second-'))
process.env.GITHUB_CLIENT_ID = 'fixture-id'
process.env.GITHUB_CLIENT_SECRET = 'fixture-secret'
process.env.TF_DATA = dir
process.env.TF_RATE_MULT = '20'
delete process.env.SMTP_URL
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex')
const password = 'FixtureStr0ng!PW7',
  salt = Buffer.alloc(16, 7)
const stored = `s1$${salt.toString('base64')}$${crypto.scryptSync(password, salt, 64).toString('base64')}`
const users = {},
  sessions = {},
  secret = 'synthetic-database-secret'
for (const id of ['password', 'oauth', 'email', 'inflight', 'tickets', 'reset', 'oauthcontinuation']) {
  users[id] = {
    id,
    name: 'Fixture',
    email: id + '@unit.invalid',
    verified: true,
    ...(['password', 'inflight', 'reset'].includes(id)
      ? { passHash: stored }
      : { oauth: { github: 'fixture-' + id } }),
    ...(['password', 'oauth', 'tickets', 'reset'].includes(id)
      ? { totp: { enabled: true, secret: 'JBSWY3DPEHPK3PXP', recovery: [sha('aaaaa-bbbbb' + secret)] } }
      : {}),
  }
  const sid = sha('token-' + id)
  sessions[sid] = { id: sid, userId: id, exp: Date.now() + 600000, lastAt: Date.now() }
}
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users, sessions, secret }))
let block = false,
  entered,
  release
const originalScrypt = crypto.scrypt
crypto.scrypt = (...args) => {
  if (block && args[0] === password) {
    block = false
    entered()
    void new Promise((r) => {
      release = r
    }).then(() => originalScrypt(...args))
  } else originalScrypt(...args)
}
const { accountRoutes, flushDb, authed, postAuthentication } = await import('./auth.mjs')
crypto.scrypt = originalScrypt
const { outbox } = await import('./mail.mjs')
const request = (id) => ({
  method: 'POST',
  headers: { authorization: 'Bearer token-' + id, host: '127.0.0.1' },
  socket: { remoteAddress: '127.0.0.1' },
})
const call = async (url, body = {}, id = 'email', method = 'POST') => {
  let result
  const req = request(id)
  req.method = method
  await accountRoutes(req, {}, new URL('http://unit.invalid' + url), {
    isLocal: true,
    readBody: async () => body,
    json: (_r, status, data) => {
      result = { status, data }
    },
  })
  return result
}
test.after(async () => {
  flushDb()
  process.removeListener('exit', flushDb)
  await fsp.rm(dir, { recursive: true, force: true })
})

test('in-flight password verification is invalidated by revocation epoch', async () => {
  let mark
  const started = new Promise((r) => {
    mark = r
  })
  entered = mark
  block = true
  const login = call('/api/auth/login', { email: users.inflight.email, password }, 'inflight')
  await started
  assert.equal((await call('/api/auth/sessions/revoke', { all: true }, 'inflight')).status, 200)
  release()
  const result = await login
  assert.equal(result.status, 409)
  assert.equal(result.data.token, undefined)
  assert.equal(result.data.ticket, undefined)
})

test('OAuth-only and password accounts both require fresh current factor to disable MFA', async () => {
  for (const id of ['oauth', 'password']) {
    const current = authed(request(id)).user
    const ticket = postAuthentication(current, request(id), true).ticket
    assert.equal((await call('/api/auth/2fa/disable', { password }, id)).status, 403)
    assert.equal((await call('/api/auth/2fa/disable', { stepupCode: 'aaaaa-bbbbb' }, id)).status, 200)
    const invalid = await call('/api/auth/2fa/login', { ticket, code: '000000' }, id)
    assert.equal(invalid.status, 400)
    assert.equal(invalid.data.token, undefined)
    assert.ok(!JSON.stringify(invalid).includes('TypeError'))
  }
})

test('MFA and OAuth continuation epochs are invalid after password/security rotation', async () => {
  const a = authed(request('tickets'))
  const ticket = postAuthentication(a.user, request('tickets'), true).ticket
  await call('/api/auth/sessions/revoke', { all: true }, 'tickets')
  const result = await call('/api/auth/2fa/login', { ticket, code: '000000' }, 'tickets')
  assert.equal(result.status, 400)
  assert.equal(result.data.token, undefined)
  const source = fs.readFileSync(new URL('./auth.mjs', import.meta.url), 'utf8')
  assert.match(source, /tickets\.set\('o:' \+ tk, \{ uid: user\.id, epoch: epoch\(user\), kind: 'oauth'/)
  assert.match(source, /t\.kind !== 'oauth' \|\| t\.epoch !== epoch\(user\)/)
})

test('OAuth-only no-factor setup requires functional one-time session-bound email proof', async () => {
  assert.equal((await call('/api/auth/2fa/setup', {}, 'email')).status, 403)
  assert.equal((await call('/api/auth/stepup/email', {}, 'email')).status, 200)
  const message = outbox.find((m) => m.to === users.email.email)
  assert.ok(message)
  const code = message.subject.slice(0, 6)
  const setup = await call('/api/auth/2fa/setup', { emailCode: code }, 'email')
  assert.equal(setup.status, 200)
  assert.equal(typeof setup.data.secret, 'string')
  assert.equal((await call('/api/auth/2fa/setup', { emailCode: code }, 'email')).status, 403)
})

test('public auth failures do not return unexpected exception contents', async () => {
  const logs = [],
    original = console.error
  console.error = (...args) => logs.push(args.join(' '))
  try {
    const result = await call(
      '/api/auth/profile',
      {
        name: {
          toString() {
            throw new Error('SYNTHETIC_PRIVATE_DETAIL')
          },
        },
      },
      'email',
      'PATCH',
    )
    assert.equal(result.status, 500)
    assert.match(result.data.error.correlationId, /^[0-9a-f]{16}$/)
    assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE_DETAIL'))
    assert.ok(!logs.join(' ').includes('SYNTHETIC_PRIVATE_DETAIL'))
  } finally {
    console.error = original
  }
})

test('password reset bumps epoch, rejects prior MFA ticket, permits fresh continuation', async () => {
  const first = await call('/api/auth/login', { email: users.reset.email, password }, 'reset')
  assert.equal(first.data.need, '2fa')
  await call('/api/auth/forgot', { email: users.reset.email }, 'reset')
  const message = outbox.find((m) => m.to === users.reset.email)
  const reset = await call(
    '/api/auth/reset',
    { email: users.reset.email, code: message.subject.slice(0, 6), password: 'NewStr0ng!Value8' },
    'reset',
  )
  assert.equal(reset.data.need, '2fa')
  assert.notEqual(reset.data.ticket, first.data.ticket)
  assert.equal(
    (await call('/api/auth/2fa/login', { ticket: first.data.ticket, code: 'aaaaa-bbbbb' }, 'reset')).status,
    400,
  )
  const fresh = await call('/api/auth/2fa/login', { ticket: reset.data.ticket, code: 'aaaaa-bbbbb' }, 'reset')
  assert.equal(fresh.status, 200)
  assert.equal(typeof fresh.data.token, 'string')
})

test('mocked OAuth continuation is invalidated by a subsequent security epoch', async () => {
  const original = globalThis.fetch
  globalThis.fetch = async (url) =>
    new Response(
      JSON.stringify(
        String(url).includes('access_token')
          ? { access_token: 'dummy-provider-token' }
          : String(url).endsWith('/emails')
            ? [{ email: users.oauthcontinuation.email, primary: true, verified: true }]
            : { id: 'fixture-oauthcontinuation', name: 'Fixture' },
      ),
      { headers: { 'content-type': 'application/json' } },
    )
  const redirect = async (url) => {
    let location
    await accountRoutes(
      { ...request('oauthcontinuation'), method: 'GET' },
      {
        writeHead(_status, headers) {
          location = headers.location
        },
        end() {},
      },
      new URL('http://unit.invalid' + url),
      {
        isLocal: true,
        readBody: async () => ({}),
        json() {
          assert.fail('Expected redirect')
        },
      },
    )
    return new URL(location)
  }
  try {
    const start = await redirect('/api/auth/oauth/github/start')
    const callback = await redirect(
      '/api/auth/oauth/github/callback?state=' + start.searchParams.get('state') + '&code=fixture',
    )
    const ticket = callback.searchParams.get('oauth')
    assert.equal(typeof ticket, 'string')
    assert.ok(ticket)
    await call('/api/auth/sessions/revoke', { all: true }, 'oauthcontinuation')
    const result = await call('/api/auth/oauth/exchange', { ticket }, 'oauthcontinuation')
    assert.equal(result.status, 400)
    assert.equal(result.data.token, undefined)
  } finally {
    globalThis.fetch = original
  }
})
