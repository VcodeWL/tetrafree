/* Тесты сервера аккаунтов: `npm test` (node:test, без зависимостей) */
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tf-test-'))
process.env.TF_RATE_MULT = '20'
process.env.TF_DATA = path.join(tmp, 'data')
process.env.TF_ROOT = path.join(tmp, 'projects')
const { start } = await import('./tetra-server.mjs')
const srv = start(0, '127.0.0.1')
await new Promise((r) => srv.once('listening', r))
const B = `http://127.0.0.1:${srv.address().port}`
test.after(() => {
  srv.close()
  fs.rmSync(tmp, { recursive: true, force: true })
})

const call = async (method, p, body, token) => {
  const r = await fetch(B + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  return { status: r.status, body: await r.json().catch(() => ({})) }
}
const lastCode = async (to, kind = 'код') => {
  const { body } = await call('GET', '/api/dev/outbox')
  const m = body.mails.find((x) => x.to === to && x.subject.includes(kind))
  return m?.subject.slice(0, 6)
}
const b32dec = (s) => {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const c of s) bits += A.indexOf(c).toString(2).padStart(5, '0')
  return Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)))
}
const totp = (secret, off = 0) => {
  const b = Buffer.alloc(8)
  b.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + off))
  const h = crypto.createHmac('sha1', b32dec(secret)).update(b).digest()
  const o = h[19] & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0')
}

const A = { name: 'Анна', email: 'anna@test.dev', password: 'Str0ng!Pass1' }
let tokenA

test('регистрация: слабые пароли и неверная почта отклоняются', async () => {
  assert.equal((await call('POST', '/api/auth/register', { ...A, password: 'password1' })).status, 400)
  assert.equal((await call('POST', '/api/auth/register', { ...A, password: 'short' })).status, 400)
  assert.equal((await call('POST', '/api/auth/register', { ...A, password: 'onlyletters' })).status, 400)
  assert.equal((await call('POST', '/api/auth/register', { ...A, email: 'not-an-email' })).status, 400)
  assert.equal(
    (await call('POST', '/api/auth/register', { ...A, password: 'anna@test!1' })).status,
    400,
    'пароль с частью почты',
  )
})

test('вход до подтверждения почты невозможен, неверный код тратит попытки', async () => {
  assert.equal((await call('POST', '/api/auth/register', A)).status, 201)
  assert.equal(
    (await call('POST', '/api/auth/register', A)).status,
    201,
    'повторная регистрация неподтверждённой почты разрешена',
  )
  const l = await call('POST', '/api/auth/login', { email: A.email, password: A.password })
  assert.equal(l.status, 403)
  assert.equal(l.body.need, 'verify')
  const bad = await call('POST', '/api/auth/verify', { email: A.email, code: '000000' })
  assert.equal(bad.status, 400)
  assert.match(bad.body.error.message, /Осталось попыток/)
  const ok = await call('POST', '/api/auth/verify', { email: A.email, code: await lastCode(A.email) })
  assert.equal(ok.status, 200)
  tokenA = ok.body.token
  assert.equal(ok.body.user.verified, true)
  assert.equal((await call('POST', '/api/auth/register', A)).status, 409, 'подтверждённая почта занята')
})

test('сессия: me, список, выход', async () => {
  assert.equal((await call('GET', '/api/auth/me', null, tokenA)).body.user.email, A.email)
  assert.equal((await call('GET', '/api/auth/me')).status, 401)
  const lg = await call('POST', '/api/auth/login', { email: A.email, password: A.password })
  assert.equal(lg.status, 200)
  assert.equal((await call('GET', '/api/auth/sessions', null, tokenA)).body.sessions.length, 2)
  await call('POST', '/api/auth/logout', {}, lg.body.token)
  assert.equal((await call('GET', '/api/auth/me', null, lg.body.token)).status, 401)
})

test('локальные функции требуют входа', async () => {
  assert.equal((await call('POST', '/api/exec', { cmd: 'echo hi' })).status, 401)
  assert.equal((await call('POST', '/api/proxy', { url: 'http://x' })).status, 401)
  assert.equal((await call('GET', '/api/fs/hashes?id=x&name=x')).status, 401)
  assert.equal((await call('GET', '/preview/00000000000000000000000000000000/x/')).status, 401)
})

test('2FA: настройка, вход по коду и по резервному коду', async () => {
  const s = await call('POST', '/api/auth/2fa/setup', {}, tokenA)
  assert.equal((await call('POST', '/api/auth/2fa/enable', { code: '123456' }, tokenA)).status, 400)
  const en = await call('POST', '/api/auth/2fa/enable', { code: totp(s.body.secret) }, tokenA)
  assert.equal(en.status, 200)
  assert.equal(en.body.recovery.length, 8)
  const l = await call('POST', '/api/auth/login', { email: A.email, password: A.password })
  assert.equal(l.body.need, '2fa')
  assert.equal(
    (await call('POST', '/api/auth/2fa/login', { ticket: l.body.ticket, code: '111111' })).status,
    400,
  )
  /* код того же 30-секундного окна уже использован при включении — берём следующее окно */
  const ok = await call('POST', '/api/auth/2fa/login', {
    ticket: l.body.ticket,
    code: totp(s.body.secret, 1),
  })
  assert.equal(ok.status, 200)
  const l2 = await call('POST', '/api/auth/login', { email: A.email, password: A.password })
  const rec = await call('POST', '/api/auth/2fa/login', { ticket: l2.body.ticket, code: en.body.recovery[0] })
  assert.equal(rec.status, 200)
  const l3 = await call('POST', '/api/auth/login', { email: A.email, password: A.password })
  assert.equal(
    (await call('POST', '/api/auth/2fa/login', { ticket: l3.body.ticket, code: en.body.recovery[0] })).status,
    400,
    'резервный код одноразовый',
  )
  const off = await call('POST', '/api/auth/2fa/disable', { password: A.password }, ok.body.token)
  assert.equal(off.body.user.twofa, false)
})

test('сброс пароля по коду завершает все сессии', async () => {
  assert.equal(
    (await call('POST', '/api/auth/forgot', { email: 'nobody@test.dev' })).status,
    200,
    'ответ одинаков для неизвестной почты',
  )
  await call('POST', '/api/auth/forgot', { email: A.email })
  const code = await lastCode(A.email, 'сброс')
  assert.equal(
    (await call('POST', '/api/auth/reset', { email: A.email, code, password: 'weak' })).status,
    400,
  )
  const r = await call('POST', '/api/auth/reset', { email: A.email, code, password: 'N3w!Passw0rd' })
  assert.equal(r.status, 200)
  assert.equal((await call('GET', '/api/auth/me', null, tokenA)).status, 401, 'старая сессия отозвана')
  assert.equal(
    (await call('POST', '/api/auth/login', { email: A.email, password: 'N3w!Passw0rd' })).status,
    200,
  )
  A.password = 'N3w!Passw0rd'
})

test('блокировка после 5 неверных паролей', async () => {
  const U = { name: 'Борис', email: 'boris@test.dev', password: 'B0ris!Pass9' }
  await call('POST', '/api/auth/register', U)
  await call('POST', '/api/auth/verify', { email: U.email, code: await lastCode(U.email) })
  for (let i = 0; i < 5; i++)
    assert.equal(
      (await call('POST', '/api/auth/login', { email: U.email, password: 'wrong' + i })).status,
      401,
    )
  const locked = await call('POST', '/api/auth/login', { email: U.email, password: U.password })
  assert.equal(locked.status, 423)
})

test('приглашение: только для своей почты, один раз, командная синхронизация с конфликтом', async () => {
  const owner = (await call('POST', '/api/auth/login', { email: A.email, password: A.password })).body.token
  const C = { name: 'Вера', email: 'vera@test.dev', password: 'V3ra!Pass77' }
  await call('POST', '/api/auth/register', C)
  const vt = (await call('POST', '/api/auth/verify', { email: C.email, code: await lastCode(C.email) })).body
    .token
  const inv = await call(
    'POST',
    '/api/invites',
    { pid: 'p-1', name: 'Демо', email: C.email, files: { 'a.txt': '1' }, dirs: [], meta: { docs: [] } },
    owner,
  )
  assert.equal(inv.status, 201)
  const token = inv.body.link.split('invite=')[1]
  assert.equal(
    (await call('POST', '/api/invites', { pid: 'p-1', name: 'Демо', email: A.email }, owner)).status,
    400,
    'нельзя пригласить себя',
  )
  const stranger = await call('POST', '/api/auth/login', { email: 'boris@test.dev', password: 'B0ris!Pass9' })
  assert.equal(stranger.status, 423)
  const acc = await call('POST', `/api/invites/${token}/accept`, {}, vt)
  assert.equal(acc.status, 200)
  assert.equal(acc.body.team.files['a.txt'], '1')
  assert.equal(
    (await call('POST', `/api/invites/${token}/accept`, {}, vt)).status,
    409,
    'повторно принять нельзя',
  )
  /* синхронизация: первая запись проходит, запись от устаревшей ревизии — конфликт */
  assert.equal((await call('PUT', '/api/team/p-1', { baseRev: 1, files: { 'a.txt': '2' } }, vt)).body.rev, 2)
  assert.equal(
    (await call('PUT', '/api/team/p-1', { baseRev: 1, files: { 'a.txt': '3' } }, owner)).status,
    409,
  )
  assert.equal((await call('GET', '/api/team/p-1?since=2', null, owner)).body.same, true)
  /* поток событий: правка и присутствие одного участника мгновенно доходят до другого; сам себе событий не шлёт */
  {
    const ac = new AbortController()
    const r = await fetch(`${B}/api/team/p-1/events`, {
      headers: { authorization: 'Bearer ' + owner },
      signal: ac.signal,
    })
    assert.equal(r.status, 200)
    assert.match(r.headers.get('content-type'), /text\/event-stream/)
    let got = ''
    const dec = new TextDecoder()
    const rd = r.body.getReader()
    const pump = (async () => {
      try {
        for (;;) {
          const { value, done } = await rd.read()
          if (done) break
          got += dec.decode(value)
        }
      } catch {
        /* abort */
      }
    })()
    assert.equal(
      (await call('PUT', '/api/team/p-1', { baseRev: 2, files: { 'a.txt': 'live' } }, vt)).body.rev,
      3,
    )
    await call('POST', '/api/team/p-1/presence', { where: 'a.txt', file: 'a.txt', line: 7 }, vt)
    for (let i = 0; i < 30 && !/presence/.test(got); i++) await new Promise((r) => setTimeout(r, 50))
    assert.match(got, /"t":"rev","rev":3/)
    assert.match(got, /"t":"presence"[^\n]*"line":7/)
    const mem = (await call('GET', '/api/team/p-1/members', null, owner)).body.members.find(
      (m) => m.online && m.file,
    )
    assert.equal(mem.file, 'a.txt')
    assert.equal(mem.line, 7)
    ac.abort()
    await pump
    assert.equal((await fetch(`${B}/api/team/p-1/events`)).status, 401, 'без токена поток не отдаётся')
    assert.equal(
      (await call('PUT', '/api/team/p-1', { baseRev: 3, files: { 'a.txt': '2' } }, vt)).body.rev,
      4,
    )
  }
  /* посторонний не видит проект */
  const D = { name: 'Глеб', email: 'gleb@test.dev', password: 'Gl3b!Pass88' }
  await call('POST', '/api/auth/register', D)
  const gt = (await call('POST', '/api/auth/verify', { email: D.email, code: await lastCode(D.email) })).body
    .token
  assert.equal((await call('GET', '/api/team/p-1', null, gt)).status, 404)
  assert.equal((await call('POST', `/api/invites/${token}/accept`, {}, gt)).status, 403)
  assert.equal(
    (await call('PUT', '/api/team/p-1', { baseRev: 4, files: 'oops' }, owner)).status,
    400,
    'неверный формат файлов отклоняется, а не стирает проект',
  )
  assert.equal((await call('PUT', '/api/team/p-1', { baseRev: 4 }, owner)).status, 400)
  /* владелец убирает участника */
  const vid = (await call('GET', '/api/auth/me', null, vt)).body.user.id
  assert.equal((await call('DELETE', `/api/team/p-1/members/${vid}`, null, owner)).status, 200)
  assert.equal((await call('GET', '/api/team/p-1', null, vt)).status, 404)
})

test('PTY: настоящий терминал отвечает на ввод и ресайз, чужой не подключится', async (t) => {
  const h = await (await fetch(B + '/api/health')).json()
  if (!h.pty) return t.skip('нет python3')
  const E = { name: 'Пётр', email: 'pyotr@test.dev', password: 'Pt3r!Pass99' }
  await call('POST', '/api/auth/register', E)
  const tk = (await call('POST', '/api/auth/verify', { email: E.email, code: await lastCode(E.email) })).body
    .token
  assert.equal((await call('POST', '/api/pty/open', { id: 'x', name: 'x' })).status, 401)
  const o = await call('POST', '/api/pty/open', { id: 'x', name: 'x', cols: 100, rows: 30 }, tk)
  assert.equal(o.status, 200)
  const sid = o.body.sid
  const ac = new AbortController()
  const r = await fetch(`${B}/api/pty/stream?sid=${sid}`, {
    headers: { authorization: 'Bearer ' + tk },
    signal: ac.signal,
  })
  let out = ''
  const dec = new TextDecoder()
  const rd = r.body.getReader()
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await rd.read()
        if (done) break
        for (const ln of dec.decode(value).split('\n'))
          if (ln) {
            const m = JSON.parse(ln)
            if (m.d) out += Buffer.from(m.d, 'base64').toString()
          }
      }
    } catch {
      /* abort */
    }
  })()
  const send = (s) => call('POST', '/api/pty/input', { sid, d: Buffer.from(s).toString('base64') }, tk)
  /* на Windows терминал — PowerShell (ConPTY): там нет && и stty, ширину спрашиваем у хоста */
  const win = process.platform === 'win32'
  const q = win ? '$Host.UI.RawUI.WindowSize.Width\r\n' : 'stty size\n'
  await send(
    win ? 'Write-Output ("{0}_ok" -f (6*7)); ' + q : 'echo $((6*7))_ok; test -t 0 && echo istty; ' + q,
  )
  const sz = (c, r) => (win ? new RegExp('(^|\\s)' + c + '(\\s|$)') : new RegExp(r + ' ' + c))
  for (let i = 0; i < 80 && !(/42_ok/.test(out) && sz(100, 30).test(out)); i++)
    await new Promise((r) => setTimeout(r, 100))
  assert.match(out, /42_ok/)
  if (!win) assert.match(out, /istty/)
  assert.match(out, sz(100, 30))
  await call('POST', '/api/pty/resize', { sid, cols: 120, rows: 40 }, tk)
  await send(q)
  for (let i = 0; i < 80 && !sz(120, 40).test(out); i++) await new Promise((r) => setTimeout(r, 100))
  assert.match(out, sz(120, 40))
  await call('POST', '/api/pty/close', { sid }, tk)
  ac.abort()
  await pump
})

test('health: версия сервера берётся из package.json, а не зашита', async () => {
  const h = await (await fetch(B + '/api/health')).json()
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(h.version, pkg.version)
})

test('удаление аккаунта владельца передаёт проект участнику, а пустой проект убирает из облака', async () => {
  const reg = async (name, email, password) => {
    await call('POST', '/api/auth/register', { name, email, password })
    return (await call('POST', '/api/auth/verify', { email, code: await lastCode(email) })).body.token
  }
  const it = await reg('Ира', 'ira@test.dev', 'Ir4!Pass1234')
  const pt = await reg('Павел', 'pavel@test.dev', 'P4vel!Pass55')
  const inv = await call(
    'POST',
    '/api/invites',
    { pid: 'p-own', name: 'Свой', email: 'pavel@test.dev', files: { 'a.txt': '1' }, dirs: [] },
    it,
  )
  assert.equal(inv.status, 201)
  await call('POST', `/api/invites/${inv.body.link.split('invite=')[1]}/accept`, {}, pt)
  const pid = (await call('GET', '/api/auth/me', null, pt)).body.user.id
  assert.equal((await call('DELETE', '/api/auth/account', { password: 'Ir4!Pass1234' }, it)).status, 200)
  const m = await call('GET', '/api/team/p-own/members', null, pt)
  assert.equal(m.status, 200)
  assert.equal(m.body.owner, pid)
  /* единственный участник удаляется — проекта в облаке больше нет */
  assert.equal((await call('DELETE', '/api/auth/account', { password: 'P4vel!Pass55' }, pt)).status, 200)
})

test('gcDb: просроченные сессии и коды удаляются, живые остаются', async () => {
  const { gcDb } = await import('./auth.mjs')
  const U = { name: 'Глеб', email: 'gc-user2@test.dev', password: 'G1eb!Pass-77' }
  assert.equal((await call('POST', '/api/auth/register', U)).status, 201)
  const code = await lastCode(U.email)
  const v = await call('POST', '/api/auth/verify', { email: U.email, code })
  assert.equal(v.status, 200)
  assert.equal(gcDb(Date.now() + 1000), 0)
  assert.equal((await call('GET', '/api/auth/me', null, v.body.token)).status, 200)
  assert.ok(gcDb(Date.now() + 60 * 24 * 3600e3) >= 1)
  assert.equal((await call('GET', '/api/auth/me', null, v.body.token)).status, 401)
})

test('битый JSON и null вместо тела — 400/понятная ошибка, а не 500 с текстом исключения', async () => {
  const send = (body) =>
    fetch(B + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body })
  const r1 = await send('{bad json')
  assert.ok(r1.status < 500)
  const r2 = await fetch(B + '/api/editors/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{bad',
  })
  assert.notEqual(r2.status, 500)
  const r3 = await fetch(B + '/api/editors/check', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'null',
  })
  assert.notEqual(r3.status, 500)
})
