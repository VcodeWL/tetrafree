/* Клиент локального бэкенда TetraFree (server/tetra-server.mjs).
   В `npm run dev` он встроен в тот же origin, в десктопе/отдельно — http://127.0.0.1:3001.
   Если бэкенда нет, приложение хранит файлы только внутри себя; терминала и пайплайнов нет, запросы к LLM идут напрямую. */
import { create } from 'zustand'
import type { Project } from '../types'
import { authHeader, getToken } from './token'
import { isAbsPath } from './paths'

export { joinPath, isAbsPath } from './paths'

export interface BackendInfo {
  local: boolean
  pty?: boolean
  mail: 'dev' | 'smtp'
  version: string
  root: string
  home?: string
  sep?: string
  git: boolean
  node: string
  platform: string
  shell: string
}
interface BState {
  status: 'checking' | 'online' | 'offline'
  base: string
  info: BackendInfo | null
  lastError?: string
  syncing: boolean
  lastSync?: number
}
export const useBackend = create<BState>(() => ({ status: 'checking', base: '', info: null, syncing: false }))
const B = () => useBackend.getState()
/** сервер отвечает (аккаунты, команды) */
export const serverOnline = () => B().status === 'online'
/** сервер на этом компьютере и мы вошли: диск, shell, git, превью */
export const backendOnline = () => B().status === 'online' && !!B().info?.local && !!getToken()

let custom = ''
let pollPty = false
let ptyTries = 0
export function setBackendUrl(u: string) {
  custom = u.trim().replace(/\/+$/, '')
  void detectBackend()
}

async function ping(base: string) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), 1500)
  try {
    const r = await fetch(base + '/api/health', { signal: ac.signal })
    if (!r.ok) return null
    const j = await r.json()
    return j.ok ? (j as BackendInfo) : null
  } catch {
    return null
  } finally {
    clearTimeout(t)
  }
}
export async function detectBackend() {
  const cands = custom ? [custom] : ['', 'http://127.0.0.1:3001']
  for (const base of cands) {
    if (base === '' && !/^https?:$/.test(location.protocol)) continue
    const info = await ping(base)
    if (info) {
      useBackend.setState({ status: 'online', base, info, lastError: undefined })
      /* на Windows терминал собирается в фоне при первом запуске — спросим ещё раз, когда он будет готов */
      if (info.platform === 'win32' && info.pty === false && !pollPty && ptyTries < 6) {
        pollPty = true
        ptyTries++
        window.setTimeout(() => {
          pollPty = false
          void detectBackend()
        }, 7000)
      }
      return true
    }
  }
  useBackend.setState({ status: 'offline', info: null })
  return false
}

/** что нужно серверу, чтобы найти папку проекта: путь (если он абсолютный) или старая схема по id/имени */
export type ProjRef = Pick<Project, 'id' | 'name'> & { path?: string }
const pj = (p: ProjRef) => ({ id: p.id, name: p.name, ...(isAbsPath(p.path) ? { folder: p.path } : {}) })
async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(B().base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...authHeader() },
    body: JSON.stringify(body),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error?.message || 'HTTP ' + r.status)
  return j as T
}

/** fetch к внешнему API — через бэкенд, если он есть (обходит CORS), иначе напрямую */
export async function backendFetch(url: string, init: RequestInit & { headers: Record<string, string> }) {
  if (!backendOnline()) return fetch(url, init)
  try {
    return await fetch(B().base + '/api/proxy', {
      method: 'POST',
      signal: init.signal,
      headers: { 'content-type': 'application/json', ...authHeader() },
      body: JSON.stringify({ url, method: init.method || 'POST', headers: init.headers, body: init.body }),
    })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    return fetch(url, init)
  }
}

export const bBatch = (
  p: ProjRef,
  write: Record<string, string>,
  remove: string[],
  dirs?: { make?: string[]; drop?: string[] },
  expectedHashes?: Record<string, string | null>,
) =>
  post<{ dir: string; failed?: { path: string; code: string; error: string }[] }>('/api/fs/batch', {
    ...pj(p),
    write,
    remove,
    mkdirs: dirs?.make,
    rmdirs: dirs?.drop,
    expectedHashes,
  })
export const bCommit = (p: ProjRef, message: string) =>
  post<{ ok: boolean; hash?: string }>('/api/git/commit', { ...pj(p), message })
export type GitFile = {
  path: string
  x: string
  y: string
  from?: string
  kind: 'new' | 'mod' | 'del' | 'ren' | 'conflict'
}
export type GitStatus = {
  ok: boolean
  reason?: string
  branch: string
  upstream: string
  ahead: number
  behind: number
  files: GitFile[]
}
export type GitCommit = { hash: string; short: string; subject: string; author: string; at: number }
export const bGit = <T>(
  op:
    | 'blame'
    | 'status'
    | 'diff'
    | 'log'
    | 'show'
    | 'discard'
    | 'commit'
    | 'branches'
    | 'checkout'
    | 'branch'
    | 'fetch'
    | 'pull'
    | 'push'
    | 'stash'
    | 'stashes'
    | 'stashpop'
    | 'stashdrop'
    | 'merge'
    | 'delbranch'
    | 'remote'
    | 'remote-set'
    | 'remote-test'
    | 'remote-remove',
  p: ProjRef,
  extra: Record<string, unknown> = {},
) => post<T>('/api/git/' + op, { ...pj(p), ...extra })
export const bRead = (p: ProjRef, paths: string[]) =>
  post<{ files: Record<string, string | null> }>('/api/fs/read', { ...pj(p), paths })
export async function bHashes(p: ProjRef) {
  const r = await fetch(
    `${B().base}/api/fs/hashes?id=${encodeURIComponent(p.id)}&name=${encodeURIComponent(p.name)}${isAbsPath(p.path) ? '&folder=' + encodeURIComponent(p.path!) : ''}`,
    { headers: authHeader() },
  )
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return (await r.json()) as {
    dir: string
    truncated?: boolean
    ignore?: string
    skip?: string[]
    hashes: Record<string, string>
  }
}
/** Настоящий shell в папке проекта. Вывод — по кускам, по мере появления. */
export async function bExec(
  p: ProjRef,
  cmd: string,
  o: { cwd?: string; signal?: AbortSignal; onOut: (s: string, err: boolean) => void; timeout?: number },
) {
  const aborted = () => new DOMException('Выполнение отменено', 'AbortError')
  if (o.signal?.aborted) throw aborted()
  const runId = Math.random().toString(36).slice(2)
  const transport = new AbortController()
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  let timedOut = false
  let terminal = false
  const kill = () => {
    void post('/api/exec/kill', { runId }).catch(() => {})
  }
  const cancel = () => {
    kill() // Server must retain cancellation for a runId not yet launched.
    transport.abort()
    void reader?.cancel().catch(() => {})
  }
  const onAbort = () => cancel()
  o.signal?.addEventListener('abort', onAbort, { once: true })
  const timeout = Math.min(86400, Math.max(1, Number(o.timeout) || 600))
  const timer = setTimeout(
    () => {
      timedOut = true
      cancel()
    },
    timeout * 1000 + 5000,
  )
  const guard = () => {
    if (o.signal?.aborted) throw aborted()
    if (timedOut) throw new Error('Связь с выполнением команды прервана по таймауту')
  }
  try {
    guard()
    const r = await fetch(B().base + '/api/exec', {
      method: 'POST',
      signal: transport.signal,
      headers: { 'content-type': 'application/json', ...authHeader() },
      body: JSON.stringify({ ...pj(p), cmd, cwd: o.cwd || '', runId, timeout }),
    })
    guard()
    if (!r.ok || !r.body) throw new Error('HTTP ' + r.status)
    reader = r.body.getReader()
    const dec = new TextDecoder()
    let buf = '',
      code: number | undefined,
      cwd = o.cwd || ''
    const frame = (line: string) => {
      if (!line.trim()) return
      guard()
      let m: { t?: string; d?: unknown; code?: unknown; cwd?: unknown }
      try {
        m = JSON.parse(line)
      } catch {
        throw new Error('Повреждён поток выполнения команды')
      }
      if (!m || typeof m !== 'object' || terminal) throw new Error('Неверный кадр выполнения команды')
      if (m.t === 'x') {
        if (!Number.isInteger(m.code) || (m.cwd !== undefined && typeof m.cwd !== 'string'))
          throw new Error('Неверный код завершения команды')
        terminal = true
        code = m.code as number
        cwd = (m.cwd as string | undefined) ?? cwd
      } else if (m.t === 'o' || m.t === 'e') {
        if (typeof m.d !== 'string') throw new Error('Неверный вывод команды')
        o.onOut(m.d, m.t === 'e')
      } else if (m.t !== 's') throw new Error('Неизвестный кадр выполнения команды')
    }
    for (;;) {
      guard()
      const { value, done } = await reader.read()
      guard()
      if (done) {
        buf += dec.decode()
        break
      }
      buf += dec.decode(value, { stream: true })
      let i: number
      while ((i = buf.indexOf('\n')) >= 0) {
        frame(buf.slice(0, i))
        buf = buf.slice(i + 1)
      }
    }
    if (buf.trim()) frame(buf)
    guard()
    if (!terminal || code === undefined)
      throw new Error('Связь оборвалась: завершение команды не подтверждено')
    return { code, cwd }
  } catch (e) {
    if (!terminal) kill()
    guard()
    throw e
  } finally {
    clearTimeout(timer)
    o.signal?.removeEventListener('abort', onAbort)
    if (reader) {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    }
  }
}

export const fnv = (s: string) => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36) + ':' + s.length
}

export interface BackupInfo {
  ok: boolean
  dir: string
  list: { name: string; size: number; at: number }[]
}
/** Автокопия на диск (с данными) или только список (без данных) */
export async function bBackup(data?: unknown): Promise<BackupInfo> {
  if (data) return post<BackupInfo>('/api/backup', { data })
  const r = await fetch(`${B().base}/api/backup`, { headers: authHeader() })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return (await r.json()) as BackupInfo
}

export interface DirInfo {
  dir: string
  parent: string | null
  dirs: { name: string; path: string }[]
  exists: boolean
  isDir: boolean
  entries: number
  git: boolean
}
/** Подпапки и сведения о папке для окна выбора места проекта. dir='' — корни (домой, диски). */
export async function bBrowse(dir: string): Promise<DirInfo> {
  const r = await fetch(`${B().base}/api/fs/browse?dir=${encodeURIComponent(dir)}`, { headers: authHeader() })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error?.message || 'HTTP ' + r.status)
  return j as DirInfo
}
export interface FolderCheck {
  ok: boolean
  reason?: string
  dir?: string
  exists?: boolean
  entries?: number
  git?: boolean
}
export const bCheckFolder = (folder: string) => post<FolderCheck>('/api/project/check', { folder })
/** Клонировать репозиторий в новую (или пустую) папку */
export const bClone = (url: string, folder: string) =>
  post<{ ok: boolean; dir?: string; reason?: string }>('/api/git-clone', { url, folder })
/** Абсолютный путь для проекта, созданного до 2.0 (папка в корне проектов TetraFree) */
export const bResolve = (p: ProjRef) => post<{ ok: boolean; dir: string }>('/api/project/resolve', pj(p))

/** Открыть папку проекта (или файл в ней) в проводнике */
export const bReveal = (p: ProjRef, rel?: string) =>
  post<{ ok: boolean; reason?: string }>('/api/fs/reveal', { ...pj(p), rel })

/** Установленные на компьютере редакторы кода (VS Code, Cursor, Zed…) */
export async function bEditors(): Promise<{ id: string; name: string }[]> {
  const r = await fetch(B().base + '/api/editors', { headers: authHeader() })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return ((await r.json()) as { editors: { id: string; name: string }[] }).editors
}
/** Открыть проект (или файл на строке) во внешнем редакторе */
export const bOpenIn = (p: ProjRef, editor: string, rel?: string, line?: number, exe?: string) =>
  post<{ ok: boolean; reason?: string; editor?: string }>('/api/fs/open-in', {
    ...pj(p),
    editor,
    rel,
    line,
    exe,
  })
/** Проверить путь к своему редактору */
export const bCheckEditor = (exe: string) =>
  post<{ ok: boolean; name?: string; reason?: string }>('/api/editors/check', { exe })
/** Отдельное окно терминала ОС в папке проекта */
export const bOpenTerminal = (p: ProjRef) =>
  post<{ ok: boolean; reason?: string }>('/api/fs/open-terminal', pj(p))

/* интернет и скриншоты для агента (сервер: server/web.mjs) */
export const bWebFetch = (url: string) =>
  post<{ url: string; status: number; type: string; text: string }>('/api/web/fetch', { url })
export const bWebSearch = (q: string) =>
  post<{ results: { title: string; url: string; snippet: string }[] }>('/api/web/search', { q })
export const bShot = (url: string, width: number, height: number, full = false) =>
  post<{ image: string }>('/api/shot', { url, width, height, full })

/* MCP: серверы описаны в .tetra/mcp.json, процессами управляет локальный сервер (server/mcp.mjs) */
export const bMcp = <T>(p: ProjRef, route: string, extra: Record<string, unknown> = {}) =>
  post<T>('/api/mcp/' + route, { ...pj(p), ...extra })
