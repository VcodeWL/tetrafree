/* Клиент настоящего PTY (server/pty.mjs): сеанс живёт на сервере, пока не закрыт — панель можно скрывать и открывать. */
import { authHeader } from './token'
import { useBackend, isAbsPath } from './backend'

const sessions = new Map<string, string>() // ключ сеанса (см. termtabs.sessionKey) -> sid
const base = () => useBackend.getState().base
const post = (path: string, body: unknown) =>
  fetch(base() + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader() },
    body: JSON.stringify(body),
  })

const b64 = (s: string) => {
  const u = new TextEncoder().encode(s)
  let r = ''
  for (let i = 0; i < u.length; i += 0x8000) r += String.fromCharCode(...u.subarray(i, i + 0x8000))
  return btoa(r)
}
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export interface PtyHandle {
  write(d: string): void
  resize(c: number, r: number): void
  close(): void
  detach(): void
  kill(): void
}

/** Подключает вывод сеанса проекта к onData. Если сеанса нет или он завершился — открывает новый. */
export async function attachPty(
  p: { id: string; name: string; path?: string; key?: string },
  size: { cols: number; rows: number },
  onData: (d: Uint8Array) => void,
  onExit: (code: number) => void,
): Promise<PtyHandle> {
  const key = p.key ?? p.id
  let sid = sessions.get(key)
  const open = async () => {
    const r = await post('/api/pty/open', {
      id: p.id,
      name: p.name,
      ...(isAbsPath(p.path) ? { folder: p.path } : {}),
      ...size,
    })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) throw new Error(j.error?.message || 'HTTP ' + r.status)
    sessions.set(key, j.sid)
    return j.sid as string
  }
  if (!sid) sid = await open()
  const ac = new AbortController()
  let dead = false
  const stream = async (id: string): Promise<boolean> => {
    const r = await fetch(`${base()}/api/pty/stream?sid=${encodeURIComponent(id)}`, {
      headers: authHeader(),
      signal: ac.signal,
    })
    if (r.status === 404) return false
    if (!r.ok || !r.body) throw new Error('HTTP ' + r.status)
    const rd = r.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { value, done } = await rd.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        const ln = buf.slice(0, i)
        buf = buf.slice(i + 1)
        if (!ln) continue
        let m: { d?: string; x?: number }
        try {
          m = JSON.parse(ln)
        } catch {
          continue
        }
        if (m.d) onData(unb64(m.d))
        else if (typeof m.x === 'number') {
          dead = true
          sessions.delete(key)
          onExit(m.x)
        }
      }
    }
    return true
  }
  let cur = sid
  void (async () => {
    try {
      if (!(await stream(cur))) {
        cur = await open()
        sessions.set(key, cur)
        await stream(cur)
      }
    } catch (e) {
      if (!ac.signal.aborted)
        onData(
          new TextEncoder().encode(
            `\r\n\x1b[31mСоединение с терминалом потеряно: ${(e as Error).message}\x1b[0m\r\n`,
          ),
        )
    }
  })()
  // ввод склеиваем в пачки, чтобы вставка и быстрый набор не порождали сотни запросов
  let q = '',
    sending = false
  const flush = async () => {
    if (sending || !q || dead) return
    sending = true
    while (q && !dead) {
      const d = q
      q = ''
      try {
        await post('/api/pty/input', { sid: cur, d: b64(d) })
      } catch {
        /* сеть моргнула */
      }
    }
    sending = false
  }
  return {
    write: (d) => {
      q += d
      void flush()
    },
    resize: (cols, rows) => {
      if (!dead) void post('/api/pty/resize', { sid: cur, cols, rows }).catch(() => {})
    },
    detach: () => ac.abort(),
    close: () => ac.abort(),
    kill: () => {
      ac.abort()
      sessions.delete(key)
      void post('/api/pty/close', { sid: cur }).catch(() => {})
    },
  }
}
export const hasPtySession = (key: string) => sessions.has(key)
/** Закрыть сеанс по ключу (вкладка закрыта): сервер убьёт shell */
export function killPty(key: string) {
  const sid = sessions.get(key)
  if (!sid) return
  sessions.delete(key)
  void post('/api/pty/close', { sid }).catch(() => {})
}
