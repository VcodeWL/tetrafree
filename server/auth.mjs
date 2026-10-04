/* Аккаунты, сессии, приглашения и командные проекты TetraFree.
   Хранилище — JSON-файл (TF_DATA или ~/TetraFree/data/db.json), запись атомарная.
   Безопасность: scrypt для паролей, случайные токены (в базе только sha256), лимиты попыток, блокировка после серии ошибок,
   одноразовые коды с TTL, TOTP (RFC 6238) + резервные коды, журнал безопасности, письма об изменениях аккаунта. */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { sendMail, tpl, outbox, mailMode } from './mail.mjs'

const scrypt = promisify(crypto.scrypt)
const DATA = path.resolve(process.env.TF_DATA || path.join(os.homedir(), 'TetraFree', 'data'))
const FILE = path.join(DATA, 'db.json')
const MIN = 60e3,
  HOUR = 3600e3,
  DAY = 24 * HOUR
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex')
const rnd = (n = 32) => crypto.randomBytes(n).toString('base64url')
const now = () => Date.now()

/* ───────── база ───────── */
let db = { users: {}, sessions: {}, codes: {}, invites: {}, teams: {}, audit: {}, secret: rnd(32) }
try {
  db = { ...db, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }
} catch {
  /* первый запуск */
}
let saveT = null
function save() {
  clearTimeout(saveT)
  saveT = setTimeout(() => {
    try {
      fs.mkdirSync(DATA, { recursive: true, mode: 0o700 })
      const tmp = FILE + '.tmp'
      fs.writeFileSync(tmp, JSON.stringify(db), { mode: 0o600 })
      fs.renameSync(tmp, FILE)
    } catch (e) {
      console.error('[db] не удалось сохранить:', e.message)
    }
  }, 150)
}
export const flushDb = () => {
  clearTimeout(saveT)
  try {
    fs.mkdirSync(DATA, { recursive: true, mode: 0o700 })
    fs.writeFileSync(FILE, JSON.stringify(db), { mode: 0o600 })
  } catch {
    /* ignore */
  }
}
process.on('exit', flushDb)

const err = (status, message, extra = {}) => Object.assign(new Error(message), { status, extra })

/* ───────── лимиты ───────── */
const hits = new Map()
const RATE = +(process.env.TF_RATE_MULT || 1)
function limit(key, max, win, msg = 'Слишком много попыток') {
  max *= RATE
  const t = now()
  const h = hits.get(key)
  if (!h || h.reset < t) {
    hits.set(key, { n: 1, reset: t + win })
    return
  }
  if (++h.n > max)
    throw err(429, `${msg}. Подожди ${Math.ceil((h.reset - t) / 1000)} с`, {
      retryAfter: Math.ceil((h.reset - t) / 1000),
    })
}
setInterval(() => {
  const t = now()
  for (const [k, v] of hits) if (v.reset < t) hits.delete(k)
  for (const [k, v] of tickets) if (v.exp < t) tickets.delete(k)
}, 5 * MIN).unref()

/* ───────── валидация ───────── */
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/
const normEmail = (e) =>
  String(e || '')
    .trim()
    .toLowerCase()
const COMMON = new Set([
  'password',
  'password1',
  '12345678',
  '123456789',
  '1234567890',
  'qwertyui',
  'qwerty123',
  'qwertyuiop',
  '11111111',
  '00000000',
  'iloveyou',
  'admin123',
  'letmein1',
  'welcome1',
  'йцукенгш',
  'пароль123',
  'secret12x',
])
function checkPassword(pw, email = '', name = '') {
  if (typeof pw !== 'string' || pw.length < 8) throw err(400, 'Пароль: минимум 8 символов')
  if (pw.length > 128) throw err(400, 'Пароль: максимум 128 символов')
  if (COMMON.has(pw.toLowerCase())) throw err(400, 'Этот пароль слишком распространён — придумай другой')
  const local = email.split('@')[0]
  if (local.length >= 4 && pw.toLowerCase().includes(local))
    throw err(400, 'Пароль не должен содержать часть почты')
  if (name.length >= 4 && pw.toLowerCase().includes(name.toLowerCase()))
    throw err(400, 'Пароль не должен содержать имя')
  if (!/[a-zа-я]/i.test(pw) || !/[\d\W_]/.test(pw))
    throw err(400, 'Пароль: добавь хотя бы одну цифру или символ')
}
async function hashPw(pw) {
  const salt = crypto.randomBytes(16)
  const h = await scrypt(pw, salt, 64)
  return `s1$${salt.toString('base64')}$${h.toString('base64')}`
}
async function verifyPw(pw, stored) {
  const [v, s, h] = String(stored || '').split('$')
  if (v !== 's1') return false
  const calc = await scrypt(pw, Buffer.from(s, 'base64'), 64)
  const want = Buffer.from(h, 'base64')
  return calc.length === want.length && crypto.timingSafeEqual(calc, want)
}

/* ───────── аудит ───────── */
function audit(uid, kind, req, extra = '') {
  const a = (db.audit[uid] ||= [])
  a.unshift({ at: now(), kind, ip: ip(req), ua: uaShort(req), extra })
  a.length = Math.min(a.length, 100)
  save()
}
const ip = (req) => String(req.socket?.remoteAddress || '').replace('::ffff:', '')
const uaShort = (req) => {
  const u = String(req.headers['user-agent'] || '')
  const b = /Edg\//.test(u)
    ? 'Edge'
    : /Chrome\//.test(u)
      ? 'Chrome'
      : /Firefox\//.test(u)
        ? 'Firefox'
        : /Safari\//.test(u)
          ? 'Safari'
          : /Tauri|TetraFree/i.test(u)
            ? 'TetraFree Desktop'
            : 'Браузер'
  const o = /Windows/.test(u)
    ? 'Windows'
    : /Mac OS/.test(u)
      ? 'macOS'
      : /Linux/.test(u)
        ? 'Linux'
        : /Android/.test(u)
          ? 'Android'
          : /iPhone|iPad/.test(u)
            ? 'iOS'
            : ''
  return o ? `${b} · ${o}` : b
}

/* ───────── пользователи/сессии ───────── */
const byEmail = (e) => Object.values(db.users).find((u) => u.email === e)
const pub = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  verified: u.verified,
  twofa: !!u.totp?.enabled,
  createdAt: u.createdAt,
  hue: u.hue,
  providers: Object.keys(u.oauth || {}),
  hasPassword: !!u.passHash,
})
function newSession(u, req, remember) {
  const token = rnd(32)
  const id = sha(token)
  const t = now()
  db.sessions[id] = {
    id,
    userId: u.id,
    createdAt: t,
    lastAt: t,
    exp: t + (remember ? 30 * DAY : 12 * HOUR),
    remember: !!remember,
    ua: uaShort(req),
    ip: ip(req),
  }
  const mine = Object.values(db.sessions)
    .filter((s) => s.userId === u.id)
    .sort((a, b) => a.createdAt - b.createdAt)
  while (mine.length > 20) delete db.sessions[mine.shift().id]
  save()
  return token
}
export function authed(req) {
  const h = String(req.headers.authorization || '')
  const tok = h.startsWith('Bearer ') ? h.slice(7) : ''
  if (!tok) return null
  const s = db.sessions[sha(tok)]
  const t = now()
  if (!s || s.exp < t) {
    if (s) {
      delete db.sessions[s.id]
      save()
    }
    return null
  }
  const u = db.users[s.userId]
  if (!u) return null
  if (t - s.lastAt > 5 * MIN) {
    s.lastAt = t
    s.exp = Math.max(s.exp, t + (s.remember ? 30 * DAY : 12 * HOUR))
    s.ip = ip(req)
    save()
  }
  return { user: u, session: s }
}
/** токен для <iframe> превью: привязан к сессии, не раскрывает сам Bearer */
export const previewToken = (session) =>
  crypto.createHmac('sha256', db.secret).update(session.id).digest('hex').slice(0, 32)
export function previewValid(tok) {
  return !!tok && Object.values(db.sessions).some((s) => s.exp > now() && previewToken(s) === tok)
}

/* ───────── коды ───────── */
async function issueCode(kind, email, ttl = 15 * MIN) {
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0')
  db.codes[kind + ':' + email] = { hash: sha(code + db.secret), exp: now() + ttl, tries: 0, sentAt: now() }
  save()
  return code
}
function checkCode(kind, email, code) {
  const k = kind + ':' + email
  const c = db.codes[k]
  if (!c || c.exp < now()) throw err(400, 'Код истёк — запроси новый')
  if (++c.tries > 5) {
    delete db.codes[k]
    save()
    throw err(429, 'Слишком много неверных попыток — запроси новый код')
  }
  const ok = sha(String(code || '').replace(/\s/g, '') + db.secret) === c.hash
  if (!ok) {
    save()
    throw err(400, `Неверный код. Осталось попыток: ${5 - c.tries}`)
  }
  delete db.codes[k]
  save()
}
const appUrl = (req) =>
  (process.env.APP_URL || String(req.headers.origin || '') || `http://${req.headers.host}`).replace(
    /\/+$/,
    '',
  )

async function mailCode(kind, u, req) {
  const code = await issueCode(kind, u.email)
  const ver = kind === 'verify'
  const link = `${appUrl(req)}/?${ver ? 'verify' : 'reset'}=${encodeURIComponent(u.email)}&code=${code}`
  const m = tpl({
    title: ver ? 'Подтверди почту' : 'Сброс пароля',
    lines: [
      `Привет, ${u.name}!`,
      ver
        ? 'Введи этот код в TetraFree, чтобы подтвердить почту. Код действует 15 минут.'
        : 'Кто-то запросил сброс пароля. Введи код в TetraFree или нажми кнопку. Код действует 15 минут.',
    ],
    code,
    button: { label: ver ? 'Подтвердить почту' : 'Задать новый пароль', url: link },
  })
  await sendMail({
    to: u.email,
    subject: ver ? `${code} — код подтверждения TetraFree` : `${code} — сброс пароля TetraFree`,
    ...m,
  })
}
async function notify(u, title, lines) {
  try {
    const m = tpl({
      title,
      lines: [`Привет, ${u.name}!`, ...lines],
      foot: 'Если это сделали не вы — сразу смените пароль и завершите все сессии в Настройки → Аккаунт.',
    })
    await sendMail({ to: u.email, subject: title + ' · TetraFree', ...m })
  } catch {
    /* письмо-уведомление не критично */
  }
}

/* ───────── TOTP ───────── */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const b32enc = (buf) => {
  let bits = '',
    out = ''
  for (const b of buf) bits += b.toString(2).padStart(8, '0')
  for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]
  return out
}
const b32dec = (s) => {
  let bits = ''
  for (const c of s.replace(/=+$/, '')) bits += B32.indexOf(c).toString(2).padStart(5, '0')
  const out = []
  for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(out)
}
function hotp(secret, step) {
  const b = Buffer.alloc(8)
  b.writeBigUInt64BE(BigInt(step))
  const h = crypto.createHmac('sha1', b32dec(secret)).update(b).digest()
  const o = h[19] & 15
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0')
}
function totpOk(u, code) {
  const step = Math.floor(now() / 30000)
  const c = String(code || '').replace(/\s/g, '')
  if (!/^\d{6}$/.test(c)) return false
  for (const d of [0, -1, 1])
    if (hotp(u.totp.secret, step + d) === c && step + d > (u.totp.last || 0)) {
      u.totp.last = step + d
      save()
      return true
    }
  return false
}
const tickets = new Map()

function useRecovery(u, code) {
  const h = sha(String(code).trim().toLowerCase().replace(/\s/g, '') + db.secret)
  const i = (u.totp?.recovery || []).indexOf(h)
  if (i < 0) return false
  u.totp.recovery.splice(i, 1)
  save()
  return true
}

/* ───────── OAuth (включается переменными окружения) ───────── */
const OAUTH = {
  github: {
    id: process.env.GITHUB_CLIENT_ID,
    secret: process.env.GITHUB_CLIENT_SECRET,
    auth: 'https://github.com/login/oauth/authorize',
    scope: 'read:user user:email',
  },
  google: {
    id: process.env.GOOGLE_CLIENT_ID,
    secret: process.env.GOOGLE_CLIENT_SECRET,
    auth: 'https://accounts.google.com/o/oauth2/v2/auth',
    scope: 'openid email profile',
  },
}
const oauthStates = new Map()
async function oauthProfile(p, code, redirect) {
  const o = OAUTH[p]
  if (p === 'github') {
    const t = await (
      await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ client_id: o.id, client_secret: o.secret, code, redirect_uri: redirect }),
      })
    ).json()
    if (!t.access_token) throw err(400, 'GitHub не принял код авторизации')
    const h = {
      authorization: 'Bearer ' + t.access_token,
      'user-agent': 'TetraFree',
      accept: 'application/vnd.github+json',
    }
    const me = await (await fetch('https://api.github.com/user', { headers: h })).json()
    const em = await (await fetch('https://api.github.com/user/emails', { headers: h })).json()
    const primary = Array.isArray(em)
      ? em.find((e) => e.primary && e.verified) || em.find((e) => e.verified)
      : null
    if (!primary) throw err(400, 'У аккаунта GitHub нет подтверждённой почты')
    return { sub: String(me.id), email: normEmail(primary.email), name: me.name || me.login }
  }
  const t = await (
    await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: o.id,
        client_secret: o.secret,
        redirect_uri: redirect,
        grant_type: 'authorization_code',
      }),
    })
  ).json()
  if (!t.access_token) throw err(400, 'Google не принял код авторизации')
  const me = await (
    await fetch('https://openidconnect.googleapis.com/v1/userinfo', {
      headers: { authorization: 'Bearer ' + t.access_token },
    })
  ).json()
  if (!me.email || !me.email_verified) throw err(400, 'У аккаунта Google нет подтверждённой почты')
  return { sub: String(me.sub), email: normEmail(me.email), name: me.name || me.email.split('@')[0] }
}

/* ───────── приглашения / команды ───────── */
const teamOf = (pid) => db.teams[pid]
const isMember = (t, uid) => t && (t.ownerId === uid || t.members.includes(uid))
const personOf = (uid) => {
  const u = db.users[uid]
  return u
    ? { id: u.id, name: u.name, email: u.email, hue: u.hue }
    : { id: uid, name: 'Удалённый аккаунт', email: '', hue: 0 }
}
const inviteView = (i) => ({
  id: i.id,
  pid: i.pid,
  projectName: i.projectName,
  email: i.email,
  by: personOf(i.by),
  at: i.at,
  exp: i.exp,
  status: i.status,
})
const TEAM_MAX = 25 * 1024 * 1024

/* ───────── поток событий команды (SSE): правки и присутствие доезжают мгновенно ───────── */
const streams = new Map() // pid -> Set<{ res, req, uid }>
const emit = (pid, msg, exceptUid) => {
  const line = 'data: ' + JSON.stringify(msg) + '\n\n'
  for (const c of streams.get(pid) || []) if (c.uid !== exceptUid) c.res.write(line)
}
const dropStreams = (pid, uid) => {
  for (const c of [...(streams.get(pid) || [])])
    if (!uid || c.uid === uid) {
      c.res.end()
      streams.get(pid).delete(c)
    }
}
setInterval(() => {
  for (const [pid, set] of streams)
    for (const c of [...set]) {
      const a = authed(c.req),
        t = teamOf(pid)
      if (!a || !t || !isMember(t, c.uid)) {
        c.res.end()
        set.delete(c)
      } else c.res.write(': ♥\n\n')
    }
}, 20000).unref()

/* ───────── роутер ───────── */
export async function accountRoutes(req, res, u, io) {
  const p = u.pathname
  if (
    !p.startsWith('/api/auth') &&
    !p.startsWith('/api/invites') &&
    !p.startsWith('/api/team') &&
    !p.startsWith('/api/dev/outbox')
  )
    return false
  const body =
    req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH' || req.method === 'DELETE'
      ? await io.readBody(req).catch(() => ({}))
      : {}
  const out = (b, code = 200) => io.json(res, code, b)
  const me = () => {
    const a = authed(req)
    if (!a) throw err(401, 'Нужно войти в аккаунт')
    return a
  }

  try {
    /* конфиг для экрана входа */
    if (p === '/api/auth/config')
      return (
        out({
          mail: mailMode(),
          oauth: Object.keys(OAUTH).filter((k) => OAUTH[k].id && OAUTH[k].secret),
          hasUsers: Object.keys(db.users).length > 0,
        }),
        true
      )

    /* dev-ящик: только с этого компьютера и только без SMTP */
    if (p === '/api/dev/outbox') {
      if (mailMode() !== 'dev' || !io.isLocal) throw err(403, 'Dev-ящик доступен только локально и без SMTP')
      if (req.method === 'DELETE') {
        outbox.length = 0
        return (out({ ok: true }), true)
      }
      return (out({ mails: outbox }), true)
    }

    if (p === '/api/auth/register' && req.method === 'POST') {
      const email = normEmail(body.email),
        name = String(body.name || '')
          .trim()
          .replace(/\s+/g, ' ')
      limit('reg:' + ip(req), 10, HOUR, 'Слишком много регистраций с этого адреса')
      if (name.length < 2 || name.length > 60) throw err(400, 'Имя: от 2 до 60 символов')
      if (!EMAIL.test(email) || email.length > 254) throw err(400, 'Проверь адрес почты')
      checkPassword(body.password, email, name)
      const ex = byEmail(email)
      if (ex && ex.verified) throw err(409, 'Эта почта уже зарегистрирована — войди или восстанови пароль')
      const user = ex || { id: 'u_' + rnd(9), email, createdAt: now(), hue: Math.floor(Math.random() * 360) }
      Object.assign(user, { name, passHash: await hashPw(body.password), verified: false })
      db.users[user.id] = user
      save()
      await mailCode('verify', user, req).catch((e) => {
        throw err(502, e.message + ' Аккаунт создан — нажми «Отправить ещё раз».')
      })
      audit(user.id, 'register', req)
      return (out({ ok: true, email, mail: mailMode() }, 201), true)
    }

    if (p === '/api/auth/resend' && req.method === 'POST') {
      const email = normEmail(body.email)
      limit('rs:' + email, 5, HOUR, 'Слишком много писем')
      const user = byEmail(email)
      const kind = body.kind === 'reset' ? 'reset' : 'verify'
      const c = db.codes[kind + ':' + email]
      if (c && now() - c.sentAt < 30000)
        throw err(429, `Повторная отправка через ${Math.ceil((30000 - (now() - c.sentAt)) / 1000)} с`)
      if (user && (kind === 'reset' || !user.verified)) await mailCode(kind, user, req)
      return (out({ ok: true }), true)
    }

    if (p === '/api/auth/verify' && req.method === 'POST') {
      const email = normEmail(body.email)
      limit('vf:' + email, 12, 15 * MIN)
      const user = byEmail(email)
      if (!user) throw err(400, 'Неверный код')
      checkCode('verify', email, body.code)
      user.verified = true
      save()
      audit(user.id, 'verified', req)
      return (out({ token: newSession(user, req, true), user: pub(user) }), true)
    }

    if (p === '/api/auth/login' && req.method === 'POST') {
      const email = normEmail(body.email)
      limit('li:' + ip(req), 30, 15 * MIN)
      limit('lu:' + email, 15, 15 * MIN)
      const user = byEmail(email)
      const bad = () => err(401, 'Неверная почта или пароль')
      if (user?.lockUntil > now())
        throw err(
          423,
          `Аккаунт временно заблокирован из-за неверных паролей. Попробуй через ${Math.ceil((user.lockUntil - now()) / MIN)} мин или сбрось пароль`,
        )
      if (!user || !user.passHash) {
        await verifyPw('x', 's1$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(64).toString('base64'))
        throw bad()
      }
      if (!(await verifyPw(String(body.password || ''), user.passHash))) {
        user.failed = (user.failed || 0) + 1
        if (user.failed >= 5) {
          user.lockUntil = now() + 15 * MIN
          user.failed = 0
          audit(user.id, 'locked', req)
          void notify(user, 'Аккаунт временно заблокирован', [
            'Было 5 неверных попыток входа подряд. Вход заблокирован на 15 минут.',
          ])
        }
        audit(user.id, 'login_fail', req)
        save()
        throw bad()
      }
      user.failed = 0
      user.lockUntil = 0
      if (!user.verified) {
        await mailCode('verify', user, req).catch(() => {})
        return (out({ need: 'verify', email }, 403), true)
      }
      if (user.totp?.enabled) {
        const tk = rnd(18)
        tickets.set(tk, { uid: user.id, exp: now() + 5 * MIN, tries: 0, remember: !!body.remember })
        return (out({ need: '2fa', ticket: tk }), true)
      }
      audit(user.id, 'login', req)
      save()
      return (out({ token: newSession(user, req, !!body.remember), user: pub(user) }), true)
    }

    if (p === '/api/auth/2fa/login' && req.method === 'POST') {
      const t = tickets.get(body.ticket)
      if (!t || t.exp < now()) throw err(400, 'Время подтверждения истекло — войди заново')
      if (++t.tries > 6) {
        tickets.delete(body.ticket)
        throw err(429, 'Слишком много попыток — войди заново')
      }
      const user = db.users[t.uid]
      const code = String(body.code || '')
      const ok = /^\d[\d\s]{5,}$/.test(code) ? totpOk(user, code) : useRecovery(user, code)
      if (!ok) {
        audit(user.id, '2fa_fail', req)
        throw err(400, 'Неверный код')
      }
      tickets.delete(body.ticket)
      audit(user.id, 'login', req, '2FA')
      return (out({ token: newSession(user, req, t.remember), user: pub(user) }), true)
    }

    if (p === '/api/auth/forgot' && req.method === 'POST') {
      const email = normEmail(body.email)
      limit('fg:' + ip(req), 10, HOUR)
      limit('fg:' + email, 4, HOUR, 'Слишком много запросов')
      const user = byEmail(email)
      if (user) await mailCode('reset', user, req).catch(() => {})
      return (out({ ok: true, mail: mailMode() }), true) /* ответ одинаков, есть ли такая почта */
    }

    if (p === '/api/auth/reset' && req.method === 'POST') {
      const email = normEmail(body.email)
      limit('rp:' + email, 12, 15 * MIN)
      const user = byEmail(email)
      if (!user) throw err(400, 'Неверный код')
      checkPassword(body.password, email, user.name)
      checkCode('reset', email, body.code)
      user.passHash = await hashPw(body.password)
      user.verified = true
      user.failed = 0
      user.lockUntil = 0
      for (const s of Object.values(db.sessions)) if (s.userId === user.id) delete db.sessions[s.id]
      audit(user.id, 'password_reset', req)
      save()
      void notify(user, 'Пароль изменён', [
        'Пароль был сброшен по коду из письма. Все прежние сессии завершены.',
      ])
      if (user.totp?.enabled) {
        const tk = rnd(18)
        tickets.set(tk, { uid: user.id, exp: now() + 5 * MIN, tries: 0, remember: true })
        return (out({ need: '2fa', ticket: tk }), true)
      }
      return (out({ token: newSession(user, req, true), user: pub(user) }), true)
    }

    /* OAuth */
    let m
    if ((m = p.match(/^\/api\/auth\/oauth\/(github|google)\/start$/))) {
      const o = OAUTH[m[1]]
      if (!o.id) throw err(404, 'Провайдер не настроен')
      const state = rnd(16)
      oauthStates.set(state, { exp: now() + 10 * MIN, back: appUrl(req) })
      const redirect = `${appUrl(req)}/api/auth/oauth/${m[1]}/callback`
      res.writeHead(302, {
        location: `${o.auth}?${new URLSearchParams({ client_id: o.id, redirect_uri: redirect, scope: o.scope, state, response_type: 'code' })}`,
      })
      res.end()
      return true
    }
    if ((m = p.match(/^\/api\/auth\/oauth\/(github|google)\/callback$/))) {
      const st = oauthStates.get(u.searchParams.get('state'))
      oauthStates.delete(u.searchParams.get('state'))
      const back = st?.back || appUrl(req)
      const go = (q) => {
        res.writeHead(302, { location: `${back}/?${q}` })
        res.end()
        return true
      }
      if (!st || st.exp < now()) return go('oauth_error=' + encodeURIComponent('Сессия входа устарела'))
      try {
        const prof = await oauthProfile(
          m[1],
          u.searchParams.get('code'),
          `${back}/api/auth/oauth/${m[1]}/callback`,
        )
        let user = Object.values(db.users).find((x) => x.oauth?.[m[1]] === prof.sub) || byEmail(prof.email)
        if (!user) {
          user = {
            id: 'u_' + rnd(9),
            email: prof.email,
            name: prof.name,
            createdAt: now(),
            hue: Math.floor(Math.random() * 360),
            verified: true,
          }
          db.users[user.id] = user
        }
        user.verified = true
        ;(user.oauth ||= {})[m[1]] = prof.sub
        save()
        audit(user.id, 'login', req, m[1])
        const tk = rnd(18)
        tickets.set('o:' + tk, { uid: user.id, exp: now() + 2 * MIN })
        return go('oauth=' + tk)
      } catch (e) {
        return go('oauth_error=' + encodeURIComponent(e.message))
      }
    }
    if (p === '/api/auth/oauth/exchange' && req.method === 'POST') {
      const t = tickets.get('o:' + body.ticket)
      tickets.delete('o:' + body.ticket)
      if (!t || t.exp < now()) throw err(400, 'Ссылка входа устарела')
      const user = db.users[t.uid]
      return (out({ token: newSession(user, req, true), user: pub(user) }), true)
    }

    /* ——— дальше нужен вход ——— */
    if (p === '/api/auth/me') {
      const a = me()
      return (
        out({ user: pub(a.user), sessionId: a.session.id, previewToken: previewToken(a.session) }),
        true
      )
    }
    if (p === '/api/auth/logout' && req.method === 'POST') {
      const a = me()
      delete db.sessions[a.session.id]
      save()
      return (out({ ok: true }), true)
    }
    if (p === '/api/auth/sessions' && req.method === 'GET') {
      const a = me()
      return (
        out({
          sessions: Object.values(db.sessions)
            .filter((s) => s.userId === a.user.id)
            .sort((x, y) => y.lastAt - x.lastAt)
            .map((s) => ({
              id: s.id,
              ua: s.ua,
              ip: s.ip,
              createdAt: s.createdAt,
              lastAt: s.lastAt,
              current: s.id === a.session.id,
            })),
        }),
        true
      )
    }
    if (p === '/api/auth/sessions/revoke' && req.method === 'POST') {
      const a = me()
      for (const s of Object.values(db.sessions))
        if (s.userId === a.user.id && (body.all ? s.id !== a.session.id : s.id === body.id))
          delete db.sessions[s.id]
      audit(a.user.id, 'sessions_revoked', req, body.all ? 'все остальные' : '')
      save()
      return (out({ ok: true }), true)
    }
    if (p === '/api/auth/audit') {
      const a = me()
      return (out({ events: db.audit[a.user.id] || [] }), true)
    }
    if (p === '/api/auth/profile' && req.method === 'PATCH') {
      const a = me()
      const name = String(body.name || '')
        .trim()
        .replace(/\s+/g, ' ')
      if (name.length < 2 || name.length > 60) throw err(400, 'Имя: от 2 до 60 символов')
      a.user.name = name
      save()
      return (out({ user: pub(a.user) }), true)
    }
    if (p === '/api/auth/password' && req.method === 'POST') {
      const a = me()
      limit('pw:' + a.user.id, 8, 15 * MIN)
      if (a.user.passHash && !(await verifyPw(String(body.old || ''), a.user.passHash)))
        throw err(400, 'Текущий пароль неверен')
      checkPassword(body.password, a.user.email, a.user.name)
      a.user.passHash = await hashPw(body.password)
      for (const s of Object.values(db.sessions))
        if (s.userId === a.user.id && s.id !== a.session.id) delete db.sessions[s.id]
      audit(a.user.id, 'password_change', req)
      save()
      void notify(a.user, 'Пароль изменён', [
        'Пароль вашего аккаунта был изменён. Остальные сессии завершены.',
      ])
      return (out({ ok: true }), true)
    }
    if (p === '/api/auth/2fa/setup' && req.method === 'POST') {
      const a = me()
      if (a.user.totp?.enabled) throw err(400, '2FA уже включена')
      const secret = b32enc(crypto.randomBytes(20))
      a.user.totp = { secret, enabled: false }
      save()
      return (
        out({
          secret,
          uri: `otpauth://totp/TetraFree:${encodeURIComponent(a.user.email)}?secret=${secret}&issuer=TetraFree&digits=6&period=30`,
        }),
        true
      )
    }
    if (p === '/api/auth/2fa/enable' && req.method === 'POST') {
      const a = me()
      limit('2e:' + a.user.id, 10, 15 * MIN)
      if (!a.user.totp?.secret || a.user.totp.enabled) throw err(400, 'Сначала начни настройку 2FA')
      if (!totpOk(a.user, body.code)) throw err(400, 'Код не подходит — проверь время на устройстве')
      const codes = Array.from({ length: 8 }, () => {
        const r = crypto.randomBytes(5).toString('hex')
        return r.slice(0, 5) + '-' + r.slice(5)
      })
      a.user.totp.enabled = true
      a.user.totp.recovery = codes.map((c) => sha(c + db.secret))
      audit(a.user.id, '2fa_on', req)
      save()
      void notify(a.user, 'Включена двухфакторная защита', [
        'Теперь при входе нужен код из приложения-аутентификатора.',
      ])
      return (out({ recovery: codes, user: pub(a.user) }), true)
    }
    if (p === '/api/auth/2fa/disable' && req.method === 'POST') {
      const a = me()
      limit('2d:' + a.user.id, 6, 15 * MIN)
      if (a.user.passHash && !(await verifyPw(String(body.password || ''), a.user.passHash)))
        throw err(400, 'Пароль неверен')
      a.user.totp = undefined
      audit(a.user.id, '2fa_off', req)
      save()
      void notify(a.user, 'Двухфакторная защита отключена', ['2FA для вашего аккаунта выключена.'])
      return (out({ user: pub(a.user) }), true)
    }
    if (p === '/api/auth/account' && req.method === 'DELETE') {
      const a = me()
      if (a.user.passHash && !(await verifyPw(String(body.password || ''), a.user.passHash)))
        throw err(400, 'Пароль неверен')
      for (const s of Object.values(db.sessions)) if (s.userId === a.user.id) delete db.sessions[s.id]
      for (const t of Object.values(db.teams)) {
        t.members = t.members.filter((x) => x !== a.user.id)
      }
      delete db.users[a.user.id]
      delete db.audit[a.user.id]
      save()
      return (out({ ok: true }), true)
    }

    /* ——— приглашения ——— */
    if (p === '/api/invites' && req.method === 'POST') {
      const a = me()
      limit('iv:' + a.user.id, 30, HOUR, 'Слишком много приглашений')
      const email = normEmail(body.email)
      const pid = String(body.pid || '')
      if (!EMAIL.test(email)) throw err(400, 'Проверь адрес почты')
      if (email === a.user.email) throw err(400, 'Это твоя собственная почта')
      if (!pid || !body.name) throw err(400, 'Не указан проект')
      let t = teamOf(pid)
      if (t && !isMember(t, a.user.id)) throw err(403, 'Нет доступа к проекту')
      if (!t) {
        if (JSON.stringify([body.files, body.meta]).length > TEAM_MAX)
          throw err(413, 'Проект слишком большой для облака (25 МБ)')
        t = db.teams[pid] = {
          id: pid,
          ownerId: a.user.id,
          name: body.name,
          members: [],
          rev: 1,
          files: body.files || {},
          dirs: body.dirs || [],
          meta: body.meta || null,
          updatedAt: now(),
          updatedBy: a.user.id,
          presence: {},
        }
      } else if (t.ownerId !== a.user.id) throw err(403, 'Приглашать может только владелец проекта')
      const target = byEmail(email)
      if (target && isMember(t, target.id)) throw err(409, 'Этот человек уже в проекте')
      let inv = Object.values(db.invites).find(
        (i) => i.pid === pid && i.email === email && i.status === 'pending',
      )
      const token = rnd(24)
      if (inv) {
        inv.tokenHash = sha(token)
        inv.exp = now() + 7 * DAY
        inv.at = now()
      } else {
        inv = {
          id: 'i_' + rnd(8),
          tokenHash: sha(token),
          pid,
          projectName: t.name,
          email,
          by: a.user.id,
          at: now(),
          exp: now() + 7 * DAY,
          status: 'pending',
        }
        db.invites[inv.id] = inv
      }
      save()
      const link = `${appUrl(req)}/?invite=${token}`
      const msg = tpl({
        title: `${a.user.name} приглашает в «${t.name}»`,
        lines: [
          `${a.user.name} (${a.user.email}) зовёт вас в проект «${t.name}» в TetraFree — совместную разработку с ИИ-агентами.`,
          target
            ? 'Войдите в свой аккаунт и примите приглашение.'
            : 'Создайте аккаунт с этой почтой — приглашение подтянется автоматически.',
          'Ссылка действует 7 дней.',
        ],
        button: { label: 'Открыть приглашение', url: link },
        foot: 'Если вы не знаете отправителя — просто проигнорируйте письмо.',
      })
      let mailErr = null
      await sendMail({
        to: email,
        subject: `${a.user.name} приглашает вас в «${t.name}» · TetraFree`,
        ...msg,
      }).catch((e) => {
        mailErr = e.message
      })
      audit(a.user.id, 'invite', req, email)
      return (
        out(
          {
            invite: inviteView(inv),
            mail: mailMode(),
            mailError: mailErr,
            link: mailMode() === 'dev' ? link : undefined,
          },
          201,
        ),
        true
      )
    }
    if (p === '/api/invites' && req.method === 'GET') {
      const a = me()
      const pid = u.searchParams.get('pid')
      const list = Object.values(db.invites).filter((i) =>
        pid
          ? i.pid === pid && i.by === a.user.id
          : i.email === a.user.email && i.status === 'pending' && i.exp > now(),
      )
      return (out({ invites: list.map(inviteView) }), true)
    }
    if ((m = p.match(/^\/api\/invites\/([^/]+)$/)) && req.method === 'GET' && m[1] !== 'accept') {
      const i = Object.values(db.invites).find((x) => x.tokenHash === sha(m[1]))
      if (!i) throw err(404, 'Приглашение не найдено или ссылка устарела')
      const st = i.status === 'pending' && i.exp < now() ? 'expired' : i.status
      const mask = i.email.replace(/^(.).*(@.*)$/, '$1•••$2')
      return (
        out({
          projectName: i.projectName,
          by: personOf(i.by).name,
          email: i.email,
          emailMasked: mask,
          status: st,
          exp: i.exp,
        }),
        true
      )
    }
    if ((m = p.match(/^\/api\/invites\/([^/]+)\/(accept|decline)$/)) && req.method === 'POST') {
      const a = me()
      const i = Object.values(db.invites).find((x) => x.tokenHash === sha(m[1]) || x.id === m[1])
      if (!i) throw err(404, 'Приглашение не найдено')
      if (i.email !== a.user.email)
        throw err(
          403,
          `Приглашение выписано на ${i.email.replace(/^(.).*(@.*)$/, '$1•••$2')} — войди в этот аккаунт`,
        )
      if (i.status !== 'pending')
        throw err(
          409,
          i.status === 'accepted' ? 'Приглашение уже принято' : 'Приглашение отозвано или отклонено',
        )
      if (i.exp < now()) throw err(410, 'Срок приглашения истёк — попроси отправить новое')
      const t = teamOf(i.pid)
      if (!t) {
        i.status = 'revoked'
        save()
        throw err(410, 'Проект больше не существует')
      }
      if (m[2] === 'decline') {
        i.status = 'declined'
        save()
        return (out({ ok: true }), true)
      }
      if (!t.members.includes(a.user.id) && t.ownerId !== a.user.id) t.members.push(a.user.id)
      i.status = 'accepted'
      i.acceptedAt = now()
      audit(a.user.id, 'invite_accept', req, t.name)
      save()
      return (
        out({
          team: {
            id: t.id,
            name: t.name,
            rev: t.rev,
            files: t.files,
            dirs: t.dirs,
            meta: t.meta,
            ownerId: t.ownerId,
          },
          members: [t.ownerId, ...t.members].map(personOf),
        }),
        true
      )
    }
    if ((m = p.match(/^\/api\/invites\/([^/]+)$/)) && req.method === 'DELETE') {
      const a = me()
      const i = db.invites[m[1]]
      if (!i || i.by !== a.user.id) throw err(404, 'Приглашение не найдено')
      if (i.status === 'pending') i.status = 'revoked'
      save()
      return (out({ ok: true }), true)
    }

    /* ——— команда ——— */
    if ((m = p.match(/^\/api\/team\/([^/]+)(?:\/(members|presence|events)(?:\/([^/]+))?)?$/))) {
      const a = me()
      const t = teamOf(decodeURIComponent(m[1]))
      if (!t || !isMember(t, a.user.id)) throw err(404, 'Облачный проект не найден или нет доступа')
      if (!m[2]) {
        if (req.method === 'GET') {
          const since = +u.searchParams.get('since') || 0
          return (
            out(
              since === t.rev
                ? { rev: t.rev, same: true }
                : {
                    rev: t.rev,
                    files: t.files,
                    dirs: t.dirs,
                    meta: t.meta,
                    updatedAt: t.updatedAt,
                    by: personOf(t.updatedBy),
                  },
            ),
            true
          )
        }
        if (req.method === 'PUT') {
          limit('tp:' + a.user.id, 120, MIN, 'Слишком частая синхронизация')
          const size = JSON.stringify([body.files, body.meta]).length
          if (size > TEAM_MAX) throw err(413, 'Проект больше 25 МБ — облако его не принимает')
          if (+body.baseRev !== t.rev) return (out({ conflict: true, rev: t.rev }, 409), true)
          t.files = body.files || {}
          t.dirs = body.dirs || t.dirs
          if (body.meta) t.meta = body.meta
          t.rev++
          t.updatedAt = now()
          t.updatedBy = a.user.id
          save()
          emit(t.id, { t: 'rev', rev: t.rev, by: a.user.id }, a.user.id)
          return (out({ rev: t.rev }), true)
        }
        if (req.method === 'DELETE') {
          if (t.ownerId !== a.user.id) throw err(403, 'Удалить из облака может только владелец')
          dropStreams(t.id)
          delete db.teams[t.id]
          for (const i of Object.values(db.invites))
            if (i.pid === t.id && i.status === 'pending') i.status = 'revoked'
          save()
          return (out({ ok: true }), true)
        }
      }
      if (m[2] === 'members') {
        if (req.method === 'GET') {
          const t0 = now()
          return (
            out({
              owner: t.ownerId,
              rev: t.rev,
              members: [t.ownerId, ...t.members].map((id) => ({
                ...personOf(id),
                owner: id === t.ownerId,
                online: (t.presence[id]?.at || 0) > t0 - 40000,
                where: t.presence[id]?.where || '',
                file: t.presence[id]?.file || '',
                line: t.presence[id]?.line || 0,
                lastSeen: t.presence[id]?.at || 0,
              })),
            }),
            true
          )
        }
        if (req.method === 'DELETE') {
          const uid = decodeURIComponent(m[3] || '')
          if (uid === t.ownerId) throw err(400, 'Владельца убрать нельзя')
          if (t.ownerId !== a.user.id && uid !== a.user.id)
            throw err(403, 'Убирать участников может только владелец')
          t.members = t.members.filter((x) => x !== uid)
          delete t.presence[uid]
          save()
          dropStreams(t.id, uid)
          emit(t.id, { t: 'members' })
          return (out({ ok: true }), true)
        }
      }
      if (m[2] === 'presence' && req.method === 'POST') {
        limit('pr:' + a.user.id, 240, MIN, 'Слишком частые обновления присутствия')
        const pr = (t.presence[a.user.id] = {
          at: now(),
          where: String(body.where || '').slice(0, 120),
          file: String(body.file || '').slice(0, 300),
          line: Math.max(0, Math.min(1e6, body.line | 0)),
        })
        emit(t.id, { t: 'presence', uid: a.user.id, ...pr }, a.user.id)
        return (out({ ok: true }), true)
      }
      if (m[2] === 'events' && req.method === 'GET') {
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        })
        res.write('retry: 3000\n\n: ok\n\n')
        const c = { res, req, uid: a.user.id }
        if (!streams.has(t.id)) streams.set(t.id, new Set())
        streams.get(t.id).add(c)
        res.on('close', () => streams.get(t.id)?.delete(c))
        return true
      }
    }
    throw err(404, 'Нет такого метода')
  } catch (e) {
    out({ error: { message: e.message, ...(e.extra || {}) } }, e.status || 500)
    return true
  }
}
