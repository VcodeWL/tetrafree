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

const PROTOCOL = '2025-06-18'
export const CONFIG_FILES = ['.tetra/mcp.json', '.mcp.json']
const NAME = /^[\w.-]{1,40}$/
const IDLE_MS = 5 * 60 * 1000
const MAX_CLIENTS = 8
const MAX_RESULT = 60000

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
    out.errors.push('Файл не разобрать как JSON: ' + e.message)
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
      if (fs.statSync(p).isFile()) return { file: f, ...parseConfig(fs.readFileSync(p, 'utf8')) }
    } catch {
      /* нет такого файла */
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
export const describe = (cfg) => (cfg.type === 'stdio' ? [cfg.command, ...cfg.args].join(' ') : cfg.url)

/** Подставляет ${VAR} из окружения сервера — уже после того, как пользователь одобрил конфиг как есть */
export function resolve(cfg, env = process.env) {
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
  constructor(cfg, { cwd, name = 'mcp', platform = process.platform } = {}) {
    this.cfg = cfg
    this.cwd = cwd
    this.name = name
    this.platform = platform
    this.id = 0
    this.waits = new Map()
    this.stderr = ''
    this.closed = false
    this.session = null
    this.lastUse = Date.now()
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
    this.server = r.serverInfo || {}
    this.protocol = r.protocolVersion || PROTOCOL
    await this.notify('notifications/initialized')
    return r
  }

  #spawn() {
    const { command, args, env } = this.cfg
    const win = this.platform === 'win32'
    const child = win
      ? spawn('cmd.exe', ['/d', '/s', '/c', winCommandLine(command, args)], {
          cwd: this.cwd,
          env: { ...process.env, ...env },
          windowsHide: true,
          windowsVerbatimArguments: true,
          stdio: ['pipe', 'pipe', 'pipe'],
        })
      : spawn(command, args, {
          cwd: this.cwd,
          env: { ...process.env, ...env },
          stdio: ['pipe', 'pipe', 'pipe'],
        })
    this.child = child
    let buf = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (d) => {
      buf += d
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
    child.on('error', (e) => this.#fail(new Error(`Не удалось запустить «${command}»: ${e.message}`)))
    child.on('exit', (code) => {
      this.closed = true
      this.#fail(
        new Error(
          `Сервер завершился (код ${code})${this.stderr.trim() ? ': ' + this.stderr.trim().slice(-600) : ''}`,
        ),
      )
    })
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
      m.error ? w.reject(new Error(m.error.message || 'ошибка сервера MCP')) : w.resolve(m.result)
    } else if (m && m.method && m.id !== undefined) {
      /* запрос от сервера к нам */
      if (m.method === 'ping') this.#send({ jsonrpc: '2.0', id: m.id, result: {} })
      else if (m.method === 'roots/list')
        this.#send({
          jsonrpc: '2.0',
          id: m.id,
          result: { roots: [{ uri: pathToFileURL(this.cwd || process.cwd()).href, name: 'project' }] },
        })
      else
        this.#send({
          jsonrpc: '2.0',
          id: m.id,
          error: { code: -32601, message: 'Не поддерживается: ' + m.method },
        })
    }
  }

  #send(obj) {
    if (this.cfg.type === 'stdio') {
      if (this.child?.stdin.writable) this.child.stdin.write(JSON.stringify(obj) + '\n')
    }
  }

  async notify(method, params) {
    const msg = { jsonrpc: '2.0', method, ...(params ? { params } : {}) }
    if (this.cfg.type === 'stdio') return this.#send(msg)
    await this.#post(msg, 15000)
  }

  request(method, params, timeout = 30000) {
    this.lastUse = Date.now()
    const id = ++this.id
    const msg = { jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }
    if (this.cfg.type === 'http') return this.#post(msg, timeout).then((r) => r)
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        this.waits.delete(id)
        reject(
          new Error(
            `Сервер MCP не ответил на ${method} за ${timeout / 1000} с${this.stderr.trim() ? ': ' + this.stderr.trim().slice(-400) : ''}`,
          ),
        )
      }, timeout)
      this.waits.set(id, {
        resolve: (v) => (clearTimeout(t), resolve(v)),
        reject: (e) => (clearTimeout(t), reject(e)),
      })
      this.#send(msg)
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
    const res = await fetch(this.cfg.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(msg),
      signal: AbortSignal.timeout(timeout),
    }).catch((e) => {
      throw new Error('Нет связи с ' + this.cfg.url + ': ' + (e.cause?.code || e.message))
    })
    const sid = res.headers.get('mcp-session-id')
    if (sid) this.session = sid
    if (res.status === 202 || msg.id === undefined) {
      await res.body?.cancel().catch(() => {})
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return null
    }
    if (!res.ok) {
      const t = (await res.text().catch(() => '')).slice(0, 300)
      throw new Error(`Сервер MCP ответил ${res.status}${t ? ': ' + t : ''}`)
    }
    const ct = res.headers.get('content-type') || ''
    let reply = null
    if (ct.includes('text/event-stream')) {
      const dec = new TextDecoder()
      let buf = ''
      for await (const chunk of res.body) {
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
    } else reply = await res.json().catch(() => null)
    if (!reply) throw new Error('Сервер MCP не прислал ответ')
    if (reply.error) throw new Error(reply.error.message || 'ошибка сервера MCP')
    return reply.result
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
    if (this.closed) return
    this.closed = true
    this.#fail(new Error('Соединение закрыто'))
    if (this.child) {
      try {
        this.child.stdin.end()
        setTimeout(() => this.child.kill(), 300).unref?.()
      } catch {
        /* уже закрыт */
      }
    }
    if (this.cfg.type === 'http' && this.session)
      fetch(this.cfg.url, {
        method: 'DELETE',
        headers: { 'mcp-session-id': this.session, ...this.cfg.headers },
        signal: AbortSignal.timeout(3000),
      }).catch(() => {})
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
  const sweep = setInterval(() => {
    for (const [k, c] of pool) if (Date.now() - c.lastUse > idleMs || c.closed) (c.close(), pool.delete(k))
  }, 30000)
  sweep.unref?.()
  return {
    pool,
    async get(key, make) {
      const old = pool.get(key)
      if (old && !old.closed) return old
      if (pool.size >= MAX_CLIENTS) {
        const [k, c] = [...pool].sort((a, b) => a[1].lastUse - b[1].lastUse)[0]
        c.close()
        pool.delete(k)
      }
      const c = make()
      pool.set(key, c)
      try {
        await c.start()
      } catch (e) {
        c.close()
        pool.delete(key)
        throw e
      }
      return c
    },
    stop(key) {
      const c = pool.get(key)
      if (c) (c.close(), pool.delete(key))
    },
    closeAll() {
      for (const c of pool.values()) c.close()
      pool.clear()
    },
  }
}

export async function mcpRoutes(req, res, u, io, { approvalsFile, pool }) {
  if (!u.pathname.startsWith('/api/mcp/') || req.method !== 'POST') return false
  const b = await io.readBody(req)
  const out = (c, o) => io.json(res, c, o)
  const ap = approvals(approvalsFile)
  const dir = await io.projectDir(b.id, b.name, b.folder)
  const conf = readConfig(dir)
  const item = (n) => {
    const cfg = conf.servers[n]
    return cfg ? { cfg, hash: configHash(dir, n, cfg) } : null
  }
  try {
    if (u.pathname === '/api/mcp/status') {
      const servers = Object.entries(conf.servers).map(([n, cfg]) => {
        const hash = configHash(dir, n, cfg)
        return {
          name: n,
          type: cfg.type,
          desc: describe(cfg),
          disabled: !!cfg.disabled,
          approved: ap.has(hash),
          running: pool.pool.has(hash) && !pool.pool.get(hash).closed,
        }
      })
      return (out(200, { file: conf.file, servers, errors: conf.errors }), true)
    }
    const it = item(String(b.server || ''))
    if (!it)
      return (
        out(404, {
          error: { message: `Сервер «${b.server}» не найден в ${conf.file || '.tetra/mcp.json'}` },
        }),
        true
      )
    if (u.pathname === '/api/mcp/approve') {
      b.approved === false ? ap.remove(it.hash) : ap.add(it.hash)
      if (b.approved === false) pool.stop(it.hash)
      return (out(200, { ok: true }), true)
    }
    if (u.pathname === '/api/mcp/stop') {
      pool.stop(it.hash)
      return (out(200, { ok: true }), true)
    }
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
    const client = await pool.get(it.hash, () => new McpClient(resolve(it.cfg), { cwd: dir, name: b.server }))
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
    return (out(502, { error: { message: String(e.message || e) } }), true)
  }
  return false
}
