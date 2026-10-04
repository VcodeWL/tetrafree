/* Настоящий интерактивный терминал (PTY) без нативных зависимостей.
   Linux/macOS: python3 -c "pty.fork()" — оболочка получает настоящий терминал (vim, htop, ssh, npm create, ввод паролей).
   Транспорт — обычный HTTP: вывод стримится (ndjson, base64), ввод и ресайз — POST. Windows: ConPTY через помощник на C# (conpty-win.mjs). Без PTY клиент откатывается на обычный режим. */
import { spawn, execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import { ensureConPty } from './conpty-win.mjs'

const WIN = process.platform === 'win32'
let PY = null
let WIN_EXE = null
export let PTY_WHY = ''
if (WIN) {
  /* Windows: ConPTY через собственный помощник на C# (без Python) */
  try {
    WIN_EXE = ensureConPty()
  } catch (e) {
    PTY_WHY = e.message
  }
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
export const HAS_PTY = WIN ? !!WIN_EXE : !!PY

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
const RING = 256 * 1024

function open(dir, name, cols, rows) {
  const env = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    TETRA_PROJECT: name,
    LANG: process.env.LANG || 'en_US.UTF-8',
  }
  const child = WIN
    ? spawn(WIN_EXE, [String(cols), String(rows), process.env.TETRA_WIN_SHELL || 'powershell.exe -NoLogo'], {
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
  const s = {
    id: crypto.randomBytes(9).toString('base64url'),
    child,
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
    for (const r of s.subs) r.write(JSON.stringify({ d: d.toString('base64') }) + '\n')
  })
  child.stderr.on('data', () => {})
  child.on('error', () => {
    s.exit = 127
    for (const r of s.subs) {
      r.write(JSON.stringify({ x: 127 }) + '\n')
      r.end()
    }
  })
  child.on('close', (code) => {
    s.exit = code ?? 1
    for (const r of s.subs) {
      try {
        r.write(JSON.stringify({ x: s.exit }) + '\n')
        r.end()
      } catch {
        /* закрыт */
      }
    }
    setTimeout(() => sessions.delete(s.id), 60000).unref()
  })
  sessions.set(s.id, s)
  return s
}
const kill = (s) => {
  try {
    if (WIN)
      spawn('taskkill', ['/PID', String(s.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    else process.kill(-s.child.pid, 'SIGHUP')
  } catch {
    /* завершён */
  }
}
setInterval(() => {
  const t = Date.now()
  for (const s of sessions.values()) if (s.exit === null && !s.subs.size && t - s.last > 60 * 60e3) kill(s)
}, 5 * 60e3).unref()
process.on('exit', () => {
  for (const s of sessions.values()) kill(s)
})

export async function ptyRoutes(req, res, u, io) {
  if (!u.pathname.startsWith('/api/pty/')) return false
  const out = (c, b) => io.json(res, c, b)
  if (!HAS_PTY) {
    out(501, {
      error: {
        message:
          'Терминал недоступен: ' + (PTY_WHY || 'нет поддержки PTY') + ' — работает обычный режим команд',
      },
    })
    return true
  }
  const p = u.pathname
  if (p === '/api/pty/open' && req.method === 'POST') {
    const b = await io.readBody(req)
    const dir = await io.projectDir(b.id, b.name, b.folder)
    const cols = Math.max(20, Math.min(500, +b.cols || 80)),
      rows = Math.max(5, Math.min(200, +b.rows || 24))
    if (sessions.size >= 12) {
      out(429, { error: { message: 'Слишком много открытых терминалов' } })
      return true
    }
    const s = open(fs.existsSync(dir) ? dir : process.cwd(), b.name, cols, rows)
    out(200, { sid: s.id })
    return true
  }
  if (p === '/api/pty/stream') {
    const s = sessions.get(u.searchParams.get('sid'))
    if (!s) {
      out(404, { error: { message: 'Сеанс терминала не найден' } })
      return true
    }
    res.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache',
      'x-accel-buffering': 'no',
    })
    if (s.ring.length) res.write(JSON.stringify({ d: s.ring.toString('base64') }) + '\n')
    if (s.exit !== null) {
      res.write(JSON.stringify({ x: s.exit }) + '\n')
      res.end()
      return true
    }
    s.subs.add(res)
    res.on('close', () => {
      s.subs.delete(res)
      s.last = Date.now()
    })
    return true
  }
  const b = await io.readBody(req)
  const s = sessions.get(b.sid)
  if (!s) {
    out(404, { error: { message: 'Сеанс терминала не найден' } })
    return true
  }
  s.last = Date.now()
  if (p === '/api/pty/input') {
    if (s.exit === null && typeof b.d === 'string') s.child.stdin.write(Buffer.from(b.d, 'base64'))
    out(200, { ok: true })
    return true
  }
  if (p === '/api/pty/resize') {
    if (s.exit === null) {
      const sz = `${Math.max(20, Math.min(500, +b.cols || 80))} ${Math.max(5, Math.min(200, +b.rows || 24))}\n`
      if (WIN) s.child.stdin.write('\x00TFRSZ ' + sz)
      else s.child.stdio[3].write(sz)
    }
    out(200, { ok: true })
    return true
  }
  if (p === '/api/pty/close') {
    kill(s)
    sessions.delete(s.id)
    out(200, { ok: true })
    return true
  }
  out(404, { error: { message: 'Нет такого метода' } })
  return true
}
