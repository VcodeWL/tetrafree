/* Настоящий интерактивный терминал (PTY) без нативных зависимостей.
   Linux/macOS: python3 -c "pty.fork()" — оболочка получает настоящий терминал (vim, htop, ssh, npm create, ввод паролей).
   Транспорт — обычный HTTP: вывод стримится (ndjson, base64), ввод и ресайз — POST. Windows: ConPTY через помощник на C# (conpty-win.mjs). Без PTY клиент откатывается на обычный режим. */
import { spawn, execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { StringDecoder } from 'node:string_decoder'
import { ensureConPty } from './conpty-win.mjs'
import { childEnv, serverProcesses } from './process-safety.mjs'
import { publicError, publicFailure } from './public-errors.mjs'

const WIN = process.platform === 'win32'
/* PowerShell 5.1 на русской Windows по умолчанию в кодировке 866 — кириллица в терминале превращается в «кракозябры» */
export const WIN_SHELL =
  'powershell.exe -NoLogo -NoExit -Command "[Console]::OutputEncoding=[Text.Encoding]::UTF8;[Console]::InputEncoding=[Text.Encoding]::UTF8;$OutputEncoding=[Text.Encoding]::UTF8"'
let PY = null
let WIN_EXE = null
export let PTY_WHY = ''
if (WIN) {
  /* Windows: ConPTY через собственный помощник на C# (без Python) */
  /* компиляция помощника — в фоне: сервер сразу начинает отвечать, терминал станет доступен через пару секунд */
  PTY_WHY = 'помощник терминала ещё собирается, повтори через несколько секунд'
  ensureConPty()
    .then((exe) => {
      WIN_EXE = exe
      PTY_WHY = ''
    })
    .catch((e) => {
      PTY_WHY = e.message
    })
} else {
  for (const c of ['python3', 'python']) {
    try {
      execFileSync(c, ['-c', 'import pty,fcntl,termios'], { stdio: 'ignore' })
      PY = c
      break
    } catch {
      /* нет */
    }
  }
  if (!PY) PTY_WHY = 'нужен Python 3'
}
export const hasPty = () => (WIN ? !!WIN_EXE : !!PY)

const HELPER = `
import os, pty, sys, select, fcntl, termios, struct, signal
cols, rows, shell = int(sys.argv[1]), int(sys.argv[2]), sys.argv[3]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(shell, [shell, '-i'])
def setsz(c, r):
    try: fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack('HHHH', r, c, 0, 0))
    except Exception: pass
setsz(cols, rows)
code = 0
try:
    while True:
        r, _, _ = select.select([fd, 0, 3], [], [])
        if fd in r:
            try: d = os.read(fd, 65536)
            except OSError: break
            if not d: break
            os.write(1, d)
        if 0 in r:
            d = os.read(0, 65536)
            if not d: break
            os.write(fd, d)
        if 3 in r:
            d = os.read(3, 4096)
            if not d: pass
            else:
                for ln in d.decode().split('\\n'):
                    p = ln.split()
                    if len(p) == 2: setsz(int(p[0]), int(p[1])); os.kill(pid, signal.SIGWINCH)
finally:
    try: os.kill(pid, signal.SIGHUP)
    except Exception: pass
    try:
        _, st = os.waitpid(pid, 0); code = os.waitstatus_to_exitcode(st)
    except Exception: pass
sys.exit(code if code >= 0 else 1)
`

const sessions = new Map()
const closedSessions = new Map()
const CLOSED_LIMIT = 12
const RING = 256 * 1024
const BACKLOG = 512 * 1024
const SUBSCRIBERS = 4
let lastFailure = null
let runtime = 'unproven'
let shuttingDown = false
let unconfirmedClosedTrees = 0
let lastTreeStop = null

export const ptyDiagnostics = () => ({
  helperAvailable: hasPty(),
  runtime,
  lastFailure,
  treeStop: { unconfirmedClosedTrees, last: lastTreeStop },
})

export function ptyDimensions(cols, rows) {
  const dimension = (value, fallback, min, max) => {
    if (value === undefined) return fallback
    if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value))
      throw new Error('Размер терминала должен быть конечным целым числом')
    return Math.max(min, Math.min(max, value))
  }
  return [dimension(cols, 80, 20, 500), dimension(rows, 24, 5, 200)]
}

/* A slow response is disconnected, not allowed to block all terminal readers.
   Reconnect replays the bounded ring; no per-subscriber application queue. */
export function ptyWrite(res, record) {
  const packet = JSON.stringify(record) + '\n'
  if (res.destroyed || res.writableEnded) return false
  if (res.writableLength + Buffer.byteLength(packet) > BACKLOG) {
    res.destroy()
    return false
  }
  try {
    res.write(packet)
    return true
  } catch {
    res.destroy()
    return false
  }
}

function diagnostic(text) {
  for (const key of ['SMTP_URL', 'GITHUB_CLIENT_SECRET', 'GOOGLE_CLIENT_SECRET']) {
    if (process.env[key]) text = text.split(process.env[key]).join('[redacted]')
  }
  return text.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').slice(-4096)
}

/* Root-close permits releasing only our session buffers/handles, NOT a tree
   success claim. Keep at most 12 short-lived replay snapshots without child/PID
   references; registry's bounded aggregate owns the unresolved app-Job duty. */
function retire(s) {
  if (!s.treeStopped && !s.rootClosed) return
  sessions.delete(s.id)
  if (s.closeRequested) {
    for (const res of s.subs) res.destroy()
    s.subs.clear()
  } else if (s.exit !== null && !closedSessions.has(s.id)) {
    const id = s.id
    const snapshot = {
      id,
      ring: s.ring,
      exit: s.exit,
      treeStopped: s.treeStopped,
      subs: new Set(),
      last: s.last,
      retention: setTimeout(() => closedSessions.delete(id), 60000),
    }
    snapshot.retention.unref()
    closedSessions.set(id, snapshot)
    while (closedSessions.size > CLOSED_LIMIT) {
      const oldest = closedSessions.keys().next().value
      clearTimeout(closedSessions.get(oldest).retention)
      closedSessions.delete(oldest)
    }
  }
}

function open(dir, name, cols, rows) {
  const env = childEnv({
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TETRA_PROJECT: name,
    LANG: process.env.LANG || 'en_US.UTF-8',
  })
  /* PSModulePath от PowerShell 7 ломает Windows PowerShell 5.1 (PSReadLine, модули) */
  if (WIN) delete env.PSModulePath
  if (shuttingDown || !serverProcesses.available('pty'))
    throw publicError(503, 'Достигнут лимит фоновых процессов или сервер останавливается')
  let s
  const child = WIN
    ? spawn(WIN_EXE, [String(cols), String(rows), process.env.TETRA_WIN_SHELL || WIN_SHELL], {
        cwd: dir,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      })
    : spawn(
        PY,
        [
          '-c',
          HELPER,
          String(cols),
          String(rows),
          process.env.SHELL && !process.env.SHELL.endsWith('fish') ? process.env.SHELL : 'bash',
        ],
        { cwd: dir, detached: true, stdio: ['pipe', 'pipe', 'pipe', 'pipe'], env },
      )
  // own() synchronously observes close before any child events; no await after spawn.
  const owned = serverProcesses.own(child, 'pty', ({ treeStopped, rootClosed }) => {
    s.treeStopped = treeStopped
    s.rootClosed = rootClosed
    lastTreeStop = { treeStopped, rootClosed, at: new Date().toISOString() }
    if (rootClosed && !treeStopped)
      unconfirmedClosedTrees = Math.min(Number.MAX_SAFE_INTEGER, unconfirmedClosedTrees + 1)
    retire(s)
  })
  s = {
    id: crypto.randomBytes(9).toString('base64url'),
    child,
    owned,
    treeStopped: false,
    rootClosed: false,
    closeRequested: false,
    subs: new Set(),
    ring: Buffer.alloc(0),
    exit: null,
    last: Date.now(),
    dir,
  }
  child.stdout.on('data', (d) => {
    s.last = Date.now()
    s.ring = Buffer.concat([s.ring, d])
    if (s.ring.length > RING) s.ring = s.ring.subarray(s.ring.length - RING)
    for (const r of s.subs) if (!ptyWrite(r, { d: d.toString('base64') })) s.subs.delete(r)
    runtime = 'output-observed'
  })
  const decoder = new StringDecoder('utf8')
  let stderr = ''
  child.stderr.on('data', (d) => {
    stderr = (stderr + decoder.write(d)).slice(-4096)
  })
  /* запись в завершившийся процесс даёт EPIPE: без обработчика это необработанная ошибка и падение сервера */
  child.stdin.on('error', () => {})
  child.stdio[3]?.on('error', () => {})
  child.stdout.on('error', () => {})
  child.stderr.on('error', () => {})
  const finish = (code, error = '') => {
    if (s.exit !== null) return
    s.exit = code
    stderr = diagnostic(stderr + decoder.end() + error)
    if (stderr || code !== 0) {
      lastFailure = {
        code,
        at: new Date().toISOString(),
        message: 'Помощник терминала завершился с ошибкой; подробности в журнале сервера',
      }
      runtime = 'failed'
      console.error(`[pty] helper exit=${code}: ${stderr || 'no stderr'}`)
    }
    for (const r of s.subs) {
      if (ptyWrite(r, { x: code })) r.end()
    }
    s.subs.clear()
    retire(s)
  }
  child.on('error', (e) => finish(127, e.message))
  child.on('close', (code) => finish(code ?? 1))
  sessions.set(s.id, s)
  return s
}
setInterval(() => {
  const t = Date.now()
  for (const s of sessions.values()) {
    if (!s.subs.size && t - s.last > 60 * 60e3) {
      s.closeRequested = true
      void s.owned.stop() // live false stays owned; closed roots transfer to the ledger
    }
  }
}, 5 * 60e3).unref()
// Async tree cleanup cannot be completed by a synchronous process 'exit' hook.
// Graceful owners must await shutdownPty()/serverProcesses.shutdown(); desktop
// abrupt exit is additionally protected by Rust's enclosing Job Object.

export async function ptyRoutes(req, res, u, io) {
  if (!u.pathname.startsWith('/api/pty/')) return false
  const out = (c, b) => io.json(res, c, b)
  if (u.pathname === '/api/pty/status') {
    out(200, ptyDiagnostics())
    return true
  }
  if (!hasPty()) {
    out(501, {
      error: {
        message:
          'Терминал недоступен: ' + (PTY_WHY || 'нет поддержки PTY') + ' — работает обычный режим команд',
      },
    })
    return true
  }
  const p = u.pathname
  const dimensions = (b) => {
    try {
      return ptyDimensions(b.cols, b.rows)
    } catch (e) {
      out(400, { error: { message: e.message } })
      return null
    }
  }
  if (p === '/api/pty/open' && req.method === 'POST') {
    const b = await io.readBody(req)
    const size = dimensions(b)
    if (!size) return true
    const [cols, rows] = size
    const dir = await io.projectDir(b.id, b.name, b.folder)
    if (sessions.size >= 12) {
      out(429, { error: { message: 'Слишком много открытых терминалов' } })
      return true
    }
    try {
      const s = open(fs.existsSync(dir) ? dir : process.cwd(), b.name, cols, rows)
      out(200, { sid: s.id })
    } catch (error) {
      const failure = publicFailure(error, 'Не удалось открыть терминал', 500, 'pty')
      out(failure.status, { error: failure.error })
    }
    return true
  }
  if (p === '/api/pty/stream') {
    const sid = u.searchParams.get('sid')
    const s = sessions.get(sid) || closedSessions.get(sid)
    if (!s) {
      out(404, { error: { message: 'Сеанс терминала не найден' } })
      return true
    }
    if (s.subs.size >= SUBSCRIBERS) {
      out(429, { error: { message: 'Слишком много подписчиков терминала' } })
      return true
    }
    res.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
    })
    if (s.ring.length && !ptyWrite(res, { d: s.ring.toString('base64') })) return true
    if (s.exit !== null) {
      if (ptyWrite(res, { x: s.exit })) res.end()
      return true
    }
    s.subs.add(res)
    res.on('error', () => {
      s.subs.delete(res)
      res.destroy()
    })
    res.on('close', () => {
      s.subs.delete(res)
      s.last = Date.now()
    })
    return true
  }
  const b = await io.readBody(req)
  const s = sessions.get(b.sid) || closedSessions.get(b.sid)
  if (!s) {
    out(404, { error: { message: 'Сеанс терминала не найден' } })
    return true
  }
  s.last = Date.now()
  if (!s.child) {
    if (p === '/api/pty/close') {
      if (!s.treeStopped) {
        out(503, {
          error: { message: 'Дерево закрытого терминала не подтверждено; повторный PID kill не выполняется' },
        })
        return true
      }
      clearTimeout(s.retention)
      closedSessions.delete(s.id)
      out(200, { ok: true })
    } else if (p === '/api/pty/resize') {
      if (!dimensions(b)) return true
      out(200, { ok: true })
    } else if (p === '/api/pty/input') {
      if (typeof b.d !== 'string' || b.d.length > 88000) {
        out(429, { error: { message: 'Ввод терминала слишком большой или некорректный' } })
        return true
      }
      out(200, { ok: true })
    } else out(404, { error: { message: 'Нет такого метода' } })
    return true
  }
  if (p === '/api/pty/input') {
    if (typeof b.d !== 'string' || b.d.length > 88000 || s.child.stdin.writableLength > 128 * 1024) {
      out(429, { error: { message: 'Очередь ввода терминала заполнена или ввод слишком большой' } })
      return true
    }
    if (s.exit === null) s.child.stdin.write(Buffer.from(b.d, 'base64'))
    out(200, { ok: true })
    return true
  }
  if (p === '/api/pty/resize') {
    const size = dimensions(b)
    if (!size) return true
    if (s.exit === null) {
      const sz = `${size[0]} ${size[1]}\n`
      if (WIN) s.child.stdin.write('\x00TFRSZ ' + sz)
      else s.child.stdio[3].write(sz)
    }
    out(200, { ok: true })
    return true
  }
  if (p === '/api/pty/close') {
    s.closeRequested = true
    const result = await s.owned.stop()
    if (!result.stopped) {
      const failure = publicFailure(
        publicError(503, 'Остановка дерева терминала не подтверждена'),
        undefined,
        503,
        'pty',
      )
      out(failure.status, { error: failure.error })
      return true
    }
    retire(s)
    out(200, { ok: true })
    return true
  }
  out(404, { error: { message: 'Нет такого метода' } })
  return true
}

/* Called by the parent-controlled shutdown path before Node exits. */
export async function shutdownPty() {
  shuttingDown = true
  for (const snapshot of closedSessions.values()) clearTimeout(snapshot.retention)
  closedSessions.clear()
  const results = await Promise.all(
    [...sessions.values()].map(async (s) => {
      s.closeRequested = true
      for (const res of s.subs) res.destroy()
      s.subs.clear()
      // No early EOF race; shared strategy controls stop ordering. Live failed
      // stops stay owned. Retired roots are not targeted again by numeric PID.
      const result = await s.owned.stop()
      if (result.stopped) retire(s)
      return { sid: s.id, ...result }
    }),
  )
  if (unconfirmedClosedTrees)
    results.push({
      stopped: false,
      reason: 'closed-root-obligations',
      unconfirmedClosedTrees,
    })
  return results
}
