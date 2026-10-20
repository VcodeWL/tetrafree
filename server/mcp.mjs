/* Клиент MCP (Model Context Protocol): подключает агента к внешним инструментам.
   Серверы описаны в `.tetra/mcp.json` (или `.mcp.json` — формат Claude Code):
     { "mcpServers": { "fs": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "."] },
                       "docs": { "url": "https://example.com/mcp", "headers": { "Authorization": "Bearer ${TOKEN}" } } } }
   Транспорты: stdio (процесс, JSON по строкам) и Streamable HTTP (POST, ответ JSON или SSE).
   Безопасность: конфиг может прийти из чужого репозитория, поэтому сервер запускается только после явного «Разрешить»
   пользователя; разрешение привязано к хешу (папка + имя + конфиг) — любое изменение команды требует нового. */
import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { childEnv, killTree, serverProcesses } from './process-safety.mjs'
import { realInsideSync } from './fs-safety.mjs'
import { publicError, publicFailure } from './public-errors.mjs'

const PROTOCOL = '2025-06-18'
export const CONFIG_FILES = ['.tetra/mcp.json', '.mcp.json']
const NAME = /^[\w.-]{1,40}$/
const IDLE_MS = 5 * 60 * 1000
const MAX_CLIENTS = 8
const MAX_RESULT = 60000
const MAX_INBOUND = 2 * 1024 * 1024
const MAX_OUTBOUND = 256 * 1024
const MAX_PENDING = 32
export function rpcResult(reply, id) {
  if (
    !reply ||
    Array.isArray(reply) ||
    reply.jsonrpc !== '2.0' ||
    reply.id !== id ||
    Object.hasOwn(reply, 'result') === Object.hasOwn(reply, 'error')
  )
    throw new Error('Некорректный ответ MCP или несовпадающий ID')
  if (Object.hasOwn(reply, 'error')) {
    if (!reply.error || !Number.isInteger(reply.error.code) || typeof reply.error.message !== 'string')
      throw new Error('Некорректная ошибка MCP')
    throw new Error(reply.error.message)
  }
  if (!reply.result || typeof reply.result !== 'object' || Array.isArray(reply.result))
    throw new Error('Некорректный результат MCP')
  return reply.result
}

/* ------------------------------------------------------------------ конфиг */

const expand = (s, env) =>
  String(s).replace(/\$\{([A-Za-z_][\w]*)(?::-([^}]*))?\}/g, (_, k, d) =>
    env[k] !== undefined && env[k] !== '' ? env[k] : (d ?? ''),
  )

/** Текст конфига → { servers: {имя: cfg}, errors: [строка] }. Разворачивает ${VAR} только при запуске (см. resolve). */
export function parseConfig(text) {
  const out = { servers: {}, errors: [] }
  let j
  try {
    j = JSON.parse(text)
  } catch (e) {
    out.errors.push('Файл MCP не разобрать: проверь синтаксис JSON')
    return out
  }
  const list = j && typeof j === 'object' ? j.mcpServers || j.servers : null
  if (!list || typeof list !== 'object' || Array.isArray(list)) {
    out.errors.push('Нужен объект "mcpServers": { "имя": { … } }')
    return out
  }
  for (const [name, c] of Object.entries(list)) {
    if (!NAME.test(name)) {
      out.errors.push(`Имя «${name}»: только латиница, цифры, _ . - (до 40 знаков)`)
      continue
    }
    if (!c || typeof c !== 'object') {
      out.errors.push(`${name}: ожидался объект`)
      continue
    }
    const strs = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string')
    const rec = (v) =>
      v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => typeof x === 'string')
    if (typeof c.command === 'string' && c.command.trim()) {
      if (c.args !== undefined && !strs(c.args)) out.errors.push(`${name}: args — массив строк`)
      else if (c.env !== undefined && !rec(c.env)) out.errors.push(`${name}: env — объект «ключ: строка»`)
      else
        out.servers[name] = {
          type: 'stdio',
          command: c.command.trim(),
          args: c.args || [],
          env: c.env || {},
          ...(c.disabled ? { disabled: true } : {}),
        }
    } else if (typeof c.url === 'string') {
      let u
      try {
        u = new URL(c.url)
      } catch {
        out.errors.push(`${name}: некорректный url`)
        continue
      }
      if (u.protocol !== 'http:' && u.protocol !== 'https:')
        out.errors.push(`${name}: url должен быть http(s)`)
      else if (c.headers !== undefined && !rec(c.headers))
        out.errors.push(`${name}: headers — объект «ключ: строка»`)
      else
        out.servers[name] = {
          type: 'http',
          url: c.url,
          headers: c.headers || {},
          ...(c.disabled ? { disabled: true } : {}),
        }
    } else out.errors.push(`${name}: нужен "command" (процесс) или "url" (HTTP)`)
  }
  return out
}

/** Читает конфиг проекта с диска: первый существующий из CONFIG_FILES */
export function readConfig(dir) {
  for (const f of CONFIG_FILES) {
    const p = path.join(dir, f)
    try {
      realInsideSync(dir, p)
      if (fs.statSync(p).isFile()) return { file: f, ...parseConfig(fs.readFileSync(p, 'utf8')) }
    } catch (e) {
      if (e.code !== 'ENOENT')
        return { file: f, servers: {}, errors: ['Конфигурация MCP недоступна или находится вне проекта'] }
    }
  }
  return { file: null, servers: {}, errors: [] }
}

export const configHash = (dir, name, cfg) =>
  crypto
    .createHash('sha256')
    .update(JSON.stringify([path.resolve(dir), name, cfg]))
    .digest('hex')

/** Одна строка для показа пользователю: что именно будет запущено */
const safeDisplay = (value) =>
  String(value)
    .replace(/[\r\n\x00-\x1f]/g, ' ')
    .slice(0, 1200)
export const describe = (cfg) => {
  if (cfg.type === 'http') {
    try {
      const u = new URL(cfg.url)
      u.username = ''
      u.password = ''
      for (const k of u.searchParams.keys()) u.searchParams.set(k, '[скрыто]')
      return safeDisplay(u.href)
    } catch {
      return 'HTTP MCP'
    }
  }
  let secretNext = false
  return [cfg.command, ...(cfg.args || [])]
    .map((v) => {
      if (secretNext) {
        secretNext = false
        return '[скрыто]'
      }
      if (/^--?(?:token|password|secret|api[-_]?key|authorization)(?:=|$)/i.test(v)) {
        secretNext = !v.includes('=')
        return v.split('=')[0] + (v.includes('=') ? '=[скрыто]' : '')
      }
      return safeDisplay(v)
    })
    .join(' ')
}
export const overrideSummary = (cfg) =>
  Object.entries(cfg.type === 'stdio' ? cfg.env || {} : cfg.headers || {}).map(
    ([key, value]) => safeDisplay(key) + '=' + (/^\$\{[\w]+\}$/.test(value) ? value : '[скрыто]'),
  )

/** Подставляет ${VAR} из окружения сервера — уже после того, как пользователь одобрил конфиг как есть */
export function resolve(cfg, env = childEnv()) {
  return cfg.type === 'stdio'
    ? {
        ...cfg,
        command: expand(cfg.command, env),
        args: cfg.args.map((a) => expand(a, env)),
        env: Object.fromEntries(Object.entries(cfg.env).map(([k, v]) => [k, expand(v, env)])),
      }
    : {
        ...cfg,
        url: expand(cfg.url, env),
        headers: Object.fromEntries(Object.entries(cfg.headers).map(([k, v]) => [k, expand(v, env)])),
      }
}

/* ------------------------------------------------------------------ одобрения */

export function approvals(file) {
  const read = () => {
    try {
      const a = JSON.parse(fs.readFileSync(file, 'utf8'))
      return new Set(Array.isArray(a) ? a.filter((x) => typeof x === 'string') : [])
    } catch {
      return new Set()
    }
  }
  const write = (s) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify([...s].slice(-500)))
  }
  return {
    has: (h) => read().has(h),
    add: (h) => write(read().add(h)),
    remove: (h) => {
      const s = read()
      s.delete(h)
      write(s)
    },
  }
}

/* ------------------------------------------------------------------ клиент */

/** Команда для Windows: npx и другие .cmd-обёртки запускаются только через cmd.exe */
export function winCommandLine(command, args) {
  const q = (s) => (/^[\w@+=:,./\\-]+$/.test(s) ? s : '"' + s.replace(/"/g, '""').replace(/%/g, '%%') + '"')
  return [command, ...args].map(q).join(' ')
}

export class McpClient {
  constructor(
    cfg,
    { cwd, name = 'mcp', platform = process.platform, launch = spawn, processes = serverProcesses } = {},
  ) {
    this.cfg = cfg
    this.cwd = cwd
    this.name = name
    this.platform = platform
    this.launch = launch
    this.processes = processes
    this.id = 0
    this.waits = new Map()
    this.stderr = ''
    this.closed = false
    this.session = null
    this.abort = new AbortController()
    this.lastUse = Date.now()
    this.outgoing = []
    this.outgoingBytes = 0
    this.activeRequests = 0
  }

  async start() {
    if (this.cfg.type === 'stdio') this.#spawn()
    const r = await this.request(
      'initialize',
      {
        protocolVersion: PROTOCOL,
        capabilities: { roots: { listChanged: false } },
        clientInfo: { name: 'TetraFree', version: '1' },
      },
      60000,
    )
    if (this.closed) throw new Error('Соединение MCP закрыто')
    this.server = r.serverInfo || {}
    this.protocol = r.protocolVersion || PROTOCOL
    await this.notify('notifications/initialized')
    return r
  }

  #spawn() {
    if (!this.processes.available('mcp')) throw publicError(503, 'Достигнут лимит фоновых процессов')
    const { command, args, env } = this.cfg
    const win = this.platform === 'win32'
    const child = win
      ? this.launch('cmd.exe', ['/d', '/s', '/c', winCommandLine(command, args)], {
          cwd: this.cwd,
          env: childEnv(env),
          windowsHide: true,
          windowsVerbatimArguments: true,
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: !win,
        })
      : this.launch(command, args, {
          cwd: this.cwd,
          env: childEnv(env),
          stdio: ['pipe', 'pipe', 'pipe'],
          detached: !win,
        })
    this.child = child
    this.owned = this.processes.own(child, 'mcp', () => {
      this.stderr = ''
    })
    let buf = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d) => {
      buf += d
      if (Buffer.byteLength(buf) > MAX_INBOUND) {
        this.#fail(new Error('Ответ MCP слишком большой'))
        this.close()
        return
      }
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim()
        buf = buf.slice(i + 1)
        if (line) this.#onMessage(line)
      }
    })
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (d) => {
      this.stderr = (this.stderr + d).slice(-4000)
    })
    child.stdin.on('error', (e) => this.#transportFailed(e))
    child.on('error', (e) => this.#transportFailed(e))
    child.on('exit', () => {
      this.#fail(new Error('Сервер MCP завершился'))
      void this.close()
    })
  }

  #transportFailed(error) {
    publicFailure(error, 'Связь с сервером MCP прервана', 502, 'mcp-stdio')
    this.#fail(new Error('Связь с сервером MCP прервана'))
    void this.close()
  }

  #fail(err) {
    for (const w of this.waits.values()) w.reject(err)
    this.waits.clear()
  }

  #onMessage(line) {
    let m
    try {
      m = JSON.parse(line)
    } catch {
      return /* не JSON-RPC (например, баннер в stdout) */
    }
    if (m && m.id !== undefined && (m.result !== undefined || m.error) && this.waits.has(m.id)) {
      const w = this.waits.get(m.id)
      this.waits.delete(m.id)
      try {
        w.resolve(rpcResult(m, m.id))
      } catch (e) {
        w.reject(e)
      }
    } else if (m && m.method && m.id !== undefined) {
      /* запрос от сервера к нам */
      if (m.method === 'ping')
        void this.#send({ jsonrpc: '2.0', id: m.id, result: {} }).catch((e) => this.#transportFailed(e))
      else if (m.method === 'roots/list')
        void this.#send({
          jsonrpc: '2.0',
          id: m.id,
          result: { roots: [{ uri: pathToFileURL(this.cwd || process.cwd()).href, name: 'project' }] },
        }).catch((e) => this.#transportFailed(e))
      else
        void this.#send({
          jsonrpc: '2.0',
          id: m.id,
          error: { code: -32601, message: 'Метод MCP не поддерживается' },
        }).catch((e) => this.#transportFailed(e))
    }
  }

  #send(obj) {
    if (this.closed || !this.child?.stdin?.writable)
      return Promise.reject(new Error('Соединение MCP закрыто'))
    let line
    try {
      line = JSON.stringify(obj) + '\n'
    } catch {
      return Promise.reject(new Error('Некорректный запрос MCP'))
    }
    const bytes = Buffer.byteLength(line)
    if (
      bytes > MAX_OUTBOUND ||
      this.outgoingBytes + bytes + (this.child.stdin.writableLength || 0) > MAX_OUTBOUND
    )
      return Promise.reject(new Error('Исходящая очередь MCP переполнена'))
    return new Promise((resolve, reject) => {
      this.outgoing.push({ line, bytes, resolve, reject })
      this.outgoingBytes += bytes
      this.#pump()
    })
  }

  #pump() {
    if (this.writing || this.closed) return
    const entry = this.outgoing.shift()
    if (!entry) return
    this.writing = entry
    const stream = this.child.stdin
    let callbackDone = false,
      drained = false,
      returnKnown = false,
      settled = false
    const cleanup = () => stream.removeListener('drain', onDrain)
    entry.cancel = () => {
      if (!settled) {
        settled = true
        cleanup()
        entry.reject(new Error('Соединение MCP закрыто'))
      }
    }
    const complete = (error) => {
      if (settled) return
      if (error) {
        settled = true
        cleanup()
        entry.reject(new Error('Ошибка отправки MCP'))
        this.#transportFailed(error)
        return
      }
      if (!returnKnown || !callbackDone || !drained) return
      settled = true
      cleanup()
      this.writing = null
      this.outgoingBytes -= entry.bytes
      entry.resolve()
      this.#pump()
    }
    const onDrain = () => {
      drained = true
      complete()
    }
    stream.once('drain', onDrain)
    try {
      const ok = stream.write(entry.line, (error) => {
        callbackDone = true
        complete(error)
      })
      returnKnown = true
      drained = drained || ok !== false
      complete()
    } catch (error) {
      complete(error)
    }
  }

  async notify(method, params) {
    if (this.closed) throw new Error('Соединение MCP закрыто')
    const msg = { jsonrpc: '2.0', method, ...(params ? { params } : {}) }
    if (this.cfg.type === 'stdio') return this.#send(msg)
    await this.#post(msg, 15000)
  }

  request(method, params, timeout = 30000) {
    if (this.activeRequests >= MAX_PENDING)
      return Promise.reject(new Error('Слишком много ожидающих запросов MCP'))
    this.activeRequests++
    return this.#request(method, params, timeout).finally(() => {
      this.activeRequests--
    })
  }

  #request(method, params, timeout) {
    if (this.closed) return Promise.reject(new Error('Соединение MCP закрыто'))
    this.lastUse = Date.now()
    const id = ++this.id
    const msg = { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }
    if (this.cfg.type === 'http') return this.#post(msg, timeout).then((r) => r)
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.waits.delete(id)
        reject(new Error('Сервер MCP не ответил вовремя'))
      }, timeout)
      this.waits.set(id, {
        resolve: (v) => (clearTimeout(t), resolve(v)),
        reject: (e) => (clearTimeout(t), reject(e)),
      })
      this.#send(msg).catch((e) => {
        const wait = this.waits.get(id)
        if (wait) {
          this.waits.delete(id)
          wait.reject(e)
        }
      })
    })
  }

  /* Streamable HTTP: ответ — один JSON либо поток SSE, в котором нужно найти ответ на наш id */
  async #post(msg, timeout) {
    const headers = {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'mcp-protocol-version': this.protocol || PROTOCOL,
      ...this.cfg.headers,
      ...(this.session ? { 'mcp-session-id': this.session } : {}),
    }
    const encoded = JSON.stringify(msg)
    if (Buffer.byteLength(encoded) > MAX_OUTBOUND) throw new Error('Запрос MCP слишком большой')
    const res = await fetch(this.cfg.url, {
      method: 'POST',
      headers,
      body: encoded,
      signal: AbortSignal.any([AbortSignal.timeout(timeout), this.abort.signal]),
    }).catch((e) => {
      const failure = publicFailure(e, 'Нет связи с сервером MCP', 502, 'mcp-http')
      throw publicError(502, failure.error.message, { correlationId: failure.error.correlationId })
    })
    const sid = res.headers.get('mcp-session-id')
    if (sid) this.session = sid
    if (msg.id === undefined) {
      await res.body?.cancel().catch(() => {})
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return null
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {})
      throw new Error(`Сервер MCP ответил ${res.status}`)
    }
    const ct = res.headers.get('content-type') || ''
    let reply = null
    if (ct.includes('text/event-stream')) {
      const dec = new TextDecoder()
      let buf = '',
        bytes = 0
      for await (const chunk of res.body) {
        bytes += chunk.byteLength
        if (bytes > MAX_INBOUND) throw new Error('Ответ MCP слишком большой')
        buf += dec.decode(chunk, { stream: true })
        let i
        while ((i = buf.search(/\r?\n\r?\n/)) >= 0) {
          const ev = buf.slice(0, i)
          buf = buf.slice(i).replace(/^\r?\n\r?\n/, '')
          const data = ev
            .split(/\r?\n/)
            .filter((l) => l.startsWith('data:'))
            .map((l) => l.slice(5).trimStart())
            .join('\n')
          if (!data) continue
          try {
            const m = JSON.parse(data)
            if (m.id === msg.id) {
              reply = m
              break
            }
          } catch {
            /* пропускаем */
          }
        }
        if (reply) break
      }
    } else {
      const chunks = []
      let bytes = 0
      for await (const chunk of res.body || []) {
        bytes += chunk.byteLength
        if (bytes > MAX_INBOUND) throw new Error('Ответ MCP слишком большой')
        chunks.push(Buffer.from(chunk))
      }
      try {
        reply = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        /* rejected below */
      }
    }
    return rpcResult(reply, msg.id)
  }

  async listTools() {
    const tools = []
    let cursor
    for (let i = 0; i < 10; i++) {
      const r = await this.request('tools/list', cursor ? { cursor } : {})
      tools.push(...(r.tools || []))
      if (!r.nextCursor) break
      cursor = r.nextCursor
    }
    return tools
  }

  async callTool(name, args, timeout = 120000) {
    const r = await this.request('tools/call', { name, arguments: args || {} }, timeout)
    return flattenResult(r)
  }

  close() {
    if (this.closePromise) return this.closePromise
    this.closed = true
    this.abort.abort()
    this.#fail(new Error('Соединение закрыто'))
    this.writing?.cancel?.()
    for (const entry of this.outgoing) entry.reject(new Error('Соединение закрыто'))
    this.outgoing = []
    this.outgoingBytes = 0
    const cleanup = async () => {
      if (this.child) {
        try {
          this.child.stdin.end()
        } catch {
          /* closed */
        }
        return this.owned ? this.owned.stop() : killTree(this.child, 'SIGTERM', this.platform)
      }
      if (this.cfg.type === 'http' && this.session) {
        await fetch(this.cfg.url, {
          method: 'DELETE',
          headers: { 'mcp-session-id': this.session, ...this.cfg.headers },
          signal: AbortSignal.timeout(3000),
        }).catch(() => {})
      }
    }
    this.closePromise = Promise.resolve()
      .then(cleanup)
      .then((result) => {
        if (result?.stopped === false) this.closePromise = null
        return result
      })
    return this.closePromise
  }
}

/** Результат tools/call → { text, images:[data URL], isError } */
export function flattenResult(r) {
  const parts = []
  const images = []
  for (const c of r?.content || []) {
    if (c.type === 'text') parts.push(String(c.text ?? ''))
    else if (c.type === 'image' && c.data) images.push(`data:${c.mimeType || 'image/png'};base64,${c.data}`)
    else if (c.type === 'resource' && c.resource) parts.push(c.resource.text ?? `[ресурс ${c.resource.uri}]`)
    else if (c.type === 'resource_link') parts.push(`[ссылка ${c.uri}]`)
    else if (c.type === 'audio') parts.push('[аудио пропущено]')
  }
  if (r?.structuredContent && !parts.length) parts.push(JSON.stringify(r.structuredContent, null, 1))
  let text = parts.join('\n')
  if (text.length > MAX_RESULT) text = text.slice(0, MAX_RESULT) + '\n…(обрезано)'
  return { text, images: images.slice(0, 3), isError: !!r?.isError }
}

/* ------------------------------------------------------------------ пул и маршруты */

export function createPool({ idleMs = IDLE_MS } = {}) {
  const pool = new Map()
  const close = (c) => {
    c.cancelReady?.()
    c.close()
  }
  const sweep = setInterval(() => {
    for (const [k, c] of pool) if (Date.now() - c.lastUse > idleMs || c.closed) (close(c), pool.delete(k))
  }, 30000)
  sweep.unref?.()
  return {
    pool,
    getOwner(owner) {
      const found = [...pool].find(([, c]) => c.owner === owner)
      return found ? { hash: found[0], client: found[1] } : null
    },
    async get(key, make, owner) {
      if (owner)
        for (const [oldKey, c] of pool)
          if (c.owner === owner && oldKey !== key) {
            close(c)
            pool.delete(oldKey)
          }
      const old = pool.get(key)
      if (old && !old.closed) {
        await old.ready
        if (pool.get(key) !== old || old.closed) throw new Error('Соединение MCP закрыто')
        return old
      }
      if (pool.size >= MAX_CLIENTS) {
        const [k, c] = [...pool].sort((a, b) => a[1].lastUse - b[1].lastUse)[0]
        close(c)
        pool.delete(k)
      }
      const c = make()
      c.owner = owner
      pool.set(key, c)
      c.ready = Promise.race([
        Promise.resolve().then(() => {
          if (c.closed) throw new Error('Соединение MCP закрыто')
          return c.start()
        }),
        new Promise((_, reject) => {
          c.cancelReady = () => reject(new Error('Соединение MCP закрыто'))
        }),
      ])
      try {
        await c.ready
        if (pool.get(key) !== c || c.closed) throw new Error('Соединение MCP закрыто')
      } catch (e) {
        c.close()
        if (pool.get(key) === c) pool.delete(key)
        throw e
      }
      return c
    },
    stop(key) {
      const c = pool.get(key)
      if (c) (close(c), pool.delete(key))
    },
    closeAll() {
      const pending = [...pool.values()].map((c) => {
        c.cancelReady?.()
        return c.close()
      })
      pool.clear()
      return Promise.allSettled(pending)
    },
  }
}

export async function mcpRoutes(req, res, u, io, { approvalsFile, pool }) {
  if (!u.pathname.startsWith('/api/mcp/') || req.method !== 'POST') return false
  const b = await io.readBody(req)
  const out = (c, o) => io.json(res, c, o)
  try {
    const ap = approvals(approvalsFile)
    const dir = fs.realpathSync(await io.projectDir(b.id, b.name, b.folder))
    const conf = readConfig(dir)
    const item = (n) => {
      const cfg = conf.servers[n]
      return cfg ? { cfg, hash: configHash(dir, n, cfg) } : null
    }
    const owner = (name) => JSON.stringify([dir, name])
    if (u.pathname === '/api/mcp/status') {
      const servers = Object.entries(conf.servers).map(([n, cfg]) => {
        const hash = configHash(dir, n, cfg)
        return {
          name: n,
          hash,
          runningHash: pool.getOwner(owner(n))?.hash || null,
          overrides: overrideSummary(cfg),
          type: cfg.type,
          desc: describe(cfg),
          disabled: !!cfg.disabled,
          approved: ap.has(hash),
          running: !!pool.getOwner(owner(n)) && !pool.getOwner(owner(n)).client.closed,
        }
      })
      for (const [hash, client] of pool.pool) {
        if (!client.owner || client.closed) continue
        let slot
        try {
          slot = JSON.parse(client.owner)
        } catch {
          continue
        }
        if (slot[0] !== dir || conf.servers[slot[1]]) continue
        servers.push({
          name: slot[1],
          hash,
          runningHash: hash,
          overrides: client.display?.overrides || [],
          type: client.display?.type || 'stdio',
          desc: client.display?.desc || 'Удалённая из файла версия MCP',
          disabled: true,
          approved: ap.has(hash),
          running: true,
          missing: true,
        })
      }
      return (out(200, { file: conf.file, servers, errors: conf.errors }), true)
    }
    const name = String(b.server || '')
    if (!NAME.test(name)) throw publicError(400, 'Неверное имя сервера MCP')
    const it = item(name),
      active = pool.getOwner(owner(name))
    if (['/api/mcp/approve', '/api/mcp/stop'].includes(u.pathname)) {
      const expected = b.expectedHash
      if (typeof expected !== 'string' || !/^[0-9a-f]{64}$/.test(expected))
        throw publicError(409, 'Обнови список MCP и подтверди показанную версию')
      if (u.pathname === '/api/mcp/approve' && b.approved !== false) {
        if (!it || expected !== it.hash)
          throw publicError(409, 'Конфигурация MCP изменилась — проверь новую версию и подтверди ещё раз')
        ap.add(expected)
      } else {
        if (expected !== it?.hash && expected !== active?.hash && !ap.has(expected))
          throw publicError(409, 'Версия MCP изменилась — обнови список')
        if (u.pathname === '/api/mcp/approve') ap.remove(expected)
        if (active?.hash === expected) pool.stop(expected)
      }
      return (out(200, { ok: true }), true)
    }
    if (!it) throw publicError(404, 'Сервер MCP не найден в конфигурации проекта')
    if (it.cfg.disabled)
      return (out(409, { error: { message: `Сервер «${b.server}» выключен ("disabled": true)` } }), true)
    if (!ap.has(it.hash))
      return (
        out(403, {
          error: {
            message: `Сервер «${b.server}» не разрешён: открой Настройки → Расширения и нажми «Разрешить»`,
          },
        }),
        true
      )
    const client = await pool.get(
      it.hash,
      () => {
        const c = new McpClient(resolve(it.cfg), { cwd: dir, name: b.server })
        c.display = { type: it.cfg.type, desc: describe(it.cfg), overrides: overrideSummary(it.cfg) }
        return c
      },
      owner(name),
    )
    if (u.pathname === '/api/mcp/tools')
      return (
        out(200, {
          tools: (await client.listTools()).map((t) => ({
            name: t.name,
            description: t.description || '',
            inputSchema: t.inputSchema || {},
            readOnly: t.annotations?.readOnlyHint === true,
          })),
          server: client.server || {},
        }),
        true
      )
    if (u.pathname === '/api/mcp/call') {
      if (typeof b.tool !== 'string' || !b.tool)
        return (out(400, { error: { message: 'Не указан инструмент' } }), true)
      return (
        out(200, await client.callTool(b.tool, b.args && typeof b.args === 'object' ? b.args : {})),
        true
      )
    }
  } catch (e) {
    const failure = publicFailure(e, 'Не удалось выполнить запрос MCP', 502, 'mcp')
    return (out(failure.status, { error: failure.error }), true)
  }
  return false
}
