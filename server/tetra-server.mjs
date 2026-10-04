/* TetraFree local backend — без зависимостей, только Node ≥ 18.
   • файлы проектов на диске (~/TetraFree/projects/<имя>) + двусторонняя синхронизация
   • настоящий shell: команды выполняются в папке проекта, вывод стримится
   • git: init/commit на каждую версию
   • прокси к LLM-провайдерам (обходит CORS)
   • статический превью-сервер /preview/<имя>/…
   Запуск: встроен в `npm run dev` (vite-плагин) или отдельно `npm run server` (порт 3001). */
import { nameFor, isBackupName, stale } from './backups.mjs'
import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { mailMode } from './mail.mjs'
import { checkFolder, bad } from './folders.mjs'
import { makeIgnore } from './ignore.mjs'
import { ptyRoutes, HAS_PTY } from './pty.mjs'
import { createVault, secretRoutes } from './secrets.mjs'
import { accountRoutes, authed, previewToken, previewValid } from './auth.mjs'

const ROOT = path.resolve(process.env.TF_ROOT || path.join(os.homedir(), 'TetraFree', 'projects'))
const vault = createVault({ dir: path.dirname(ROOT) })
import { parseStatus, parseLog, kindOf, parseBlame, splitHunks, pickHunks } from './gitparse.mjs'
const SKIP = new Set([
  '.git',
  'node_modules',
  'dist',
  'target',
  '.venv',
  '__pycache__',
  '.next',
  '.tetrafree',
])
const MAX_FILE = 1024 * 1024
const MAX_DIFF = 300 * 1024
const VERSION = '1.0.0'
let HAS_GIT = false
try {
  execFileSync('git', ['--version'], { stdio: 'ignore' })
  HAS_GIT = true
} catch {
  /* git не установлен */
}

const safeName = (s) =>
  String(s || 'project')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^\.+/, '')
    .slice(0, 80) || 'project'
export const fnv = (s) => {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36) + ':' + s.length
}

/* имя проекта → папка (для маршрута превью, где в URL только имя) */
const REG = new Map()
/** папка проекта. Если клиент знает путь (folder) — используем его; иначе старая схема ROOT/<имя> с поиском по id. */
async function projectDir(id, name, folder) {
  if (folder && path.isAbsolute(String(folder))) {
    const abs = checkFolder(folder)
    /* папку не создаём «на всякий случай»: пропавшую папку надо заметить, а не воскресить пустой. Создаст её первая запись файла. */
    const st = await fsp.stat(abs).catch(() => null)
    if (st && !st.isDirectory()) throw bad('Это не папка: ' + abs)
    if (name) REG.set(safeName(name), abs)
    return abs
  }
  await fsp.mkdir(ROOT, { recursive: true })
  const want = path.join(ROOT, safeName(name))
  if (id) {
    for (const d of await fsp.readdir(ROOT).catch(() => [])) {
      const idf = path.join(ROOT, d, '.tetrafree', 'id')
      if (fs.existsSync(idf) && fs.readFileSync(idf, 'utf8').trim() === id) {
        const cur = path.join(ROOT, d)
        if (cur !== want && !fs.existsSync(want)) {
          await fsp.rename(cur, want)
          REG.set(safeName(name), want)
          return want
        }
        REG.set(safeName(name), cur)
        return cur
      }
    }
  }
  await fsp.mkdir(path.join(want, '.tetrafree'), { recursive: true })
  if (id) await fsp.writeFile(path.join(want, '.tetrafree', 'id'), id)
  REG.set(safeName(name), want)
  return want
}
function inside(dir, rel) {
  const abs = path.resolve(dir, rel)
  if (abs !== dir && !abs.startsWith(dir + path.sep))
    throw Object.assign(new Error('Путь вне папки проекта: ' + rel), { status: 400 })
  return abs
}
const MAX_FILES = 2500
const MAX_TOTAL = 4 * 1024 * 1024
/** Читает текстовые файлы папки. lim.cut = true, если упёрлись в лимит числа/объёма (часть файлов не прочитана). */
async function walk(dir, base = dir, out = {}, lim = { n: 0, bytes: 0, cut: false }) {
  if (!lim.ig) {
    const gi = await fsp.readFile(path.join(base, '.gitignore'), 'utf8').catch(() => '')
    lim.ig = makeIgnore(gi)
  }
  for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (lim.cut) break
    if (SKIP.has(e.name)) continue
    const abs = path.join(dir, e.name)
    const rel = path.relative(base, abs).split(path.sep).join('/')
    if (lim.ig(rel, e.isDirectory())) continue
    if (e.isDirectory()) await walk(abs, base, out, lim)
    else if (e.isFile()) {
      const st = await fsp.stat(abs)
      if (st.size > MAX_FILE) continue
      const buf = await fsp.readFile(abs)
      if (buf.includes(0)) continue // бинарные пропускаем
      if (lim.n >= MAX_FILES || lim.bytes + buf.length > MAX_TOTAL) {
        lim.cut = true
        break
      }
      lim.n++
      lim.bytes += buf.length
      out[path.relative(base, abs).split(path.sep).join('/')] = buf.toString('utf8')
    }
  }
  return out
}
async function pruneEmpty(dir, stop) {
  let d = dir
  while (d.startsWith(stop + path.sep)) {
    const items = await fsp.readdir(d).catch(() => null)
    if (!items || items.length) return
    await fsp.rmdir(d).catch(() => {})
    d = path.dirname(d)
  }
}

function git(dir, args, timeout = 0, input = null) {
  return new Promise((res) => {
    const p = spawn('git', args, {
      cwd: dir,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_AUTHOR_NAME: process.env.GIT_AUTHOR_NAME || 'TetraFree',
        GIT_AUTHOR_EMAIL: process.env.GIT_AUTHOR_EMAIL || 'agent@tetrafree.local',
        GIT_COMMITTER_NAME: 'TetraFree',
        GIT_COMMITTER_EMAIL: 'agent@tetrafree.local',
      },
    })
    p.stdin.on('error', () => {})
    p.stdin.end(input ?? '')
    let out = '',
      so = '',
      se = ''
    p.stdout.on('data', (d) => {
      out += d
      so += d
    })
    p.stderr.on('data', (d) => {
      out += d
      se += d
    })
    const to = timeout
      ? setTimeout(() => {
          se += '\nПревышено время ожидания'
          out += '\nПревышено время ожидания'
          p.kill()
        }, timeout)
      : null
    p.on('close', (code) => {
      if (to) clearTimeout(to)
      res({ code, out, so, se })
    })
    p.on('error', (e) => res({ code: -1, out: String(e), so: '', se: String(e) }))
  })
}
async function ensureGit(dir) {
  if (!HAS_GIT) return false
  if (!fs.existsSync(path.join(dir, '.git'))) {
    await git(dir, ['init', '-q', '-b', 'main'])
    await fsp
      .writeFile(path.join(dir, '.gitignore'), 'node_modules/\ndist/\n.tetrafree/\n', { flag: 'wx' })
      .catch(() => {})
  }
  return true
}

const json = (res, code, body) => {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  })
  res.end(JSON.stringify(body))
}
const readBody = (req) =>
  new Promise((ok, fail) => {
    let b = ''
    req.setEncoding('utf8')
    req.on('data', (d) => {
      b += d
      if (b.length > 50e6) {
        fail(new Error('Слишком большой запрос'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        ok(b ? JSON.parse(b) : {})
      } catch (e) {
        fail(e)
      }
    })
    req.on('error', fail)
  })
const MIME = {
  html: 'text/html',
  css: 'text/css',
  js: 'text/javascript',
  mjs: 'text/javascript',
  json: 'application/json',
  svg: 'image/svg+xml',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  ico: 'image/x-icon',
  txt: 'text/plain',
  md: 'text/plain',
}

const running = new Map()

async function handle(req, res, isLocal) {
  const u = new URL(req.url, 'http://x')
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,content-type',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    })
    return res.end()
  }

  if (u.pathname === '/api/health')
    return json(res, 200, {
      ok: true,
      local: isLocal,
      mail: mailMode(),
      pty: HAS_PTY,
      version: VERSION,
      root: ROOT,
      home: os.homedir(),
      sep: path.sep,
      git: HAS_GIT,
      node: process.version,
      platform: process.platform,
      shell: process.platform === 'win32' ? 'cmd' : process.env.SHELL || 'sh',
    })

  if (await accountRoutes(req, res, u, { json, readBody, isLocal })) return

  /* всё ниже — доступ к диску, shell и сети: только с этого компьютера и только для вошедшего пользователя */
  const pv = u.pathname.match(/^\/preview\/([0-9a-f]{32})\//)
  if (!pv) {
    if (!isLocal)
      return json(res, 403, {
        error: { message: 'Диск, терминал и превью доступны только на компьютере, где запущен TetraFree' },
      })
    if (!authed(req)) return json(res, 401, { error: { message: 'Нужно войти в аккаунт' } })
  }

  if (await ptyRoutes(req, res, u, { json, readBody, projectDir })) return
  if (await secretRoutes(req, res, u, { json, readBody }, vault)) return

  /* обзор папок для выбора места проекта: список подпапок + сведения о самой папке */
  if (u.pathname === '/api/fs/browse') {
    const want = u.searchParams.get('dir') || ''
    if (!want) {
      /* корень выбора: домой, папка по умолчанию и (на Windows) диски */
      const roots = [{ name: 'Домашняя папка', path: os.homedir() }]
      if (fs.existsSync(ROOT)) roots.push({ name: 'Папка проектов TetraFree', path: ROOT })
      if (process.platform === 'win32')
        for (const L of 'CDEFGHIJKLMNOPQRSTUVWXYZ')
          if (fs.existsSync(L + ':\\')) roots.push({ name: L + ':', path: L + ':\\' })
          else roots.push({ name: '/', path: '/' })
      return json(res, 200, {
        dir: '',
        parent: null,
        dirs: roots,
        exists: true,
        isDir: true,
        entries: 0,
        git: false,
        home: os.homedir(),
      })
    }
    if (!path.isAbsolute(want)) return json(res, 400, { error: { message: 'Нужен абсолютный путь' } })
    const abs = path.resolve(want)
    const st = await fsp.stat(abs).catch(() => null)
    const parentDir = path.dirname(abs)
    const parent = parentDir === abs ? '' : parentDir
    if (!st)
      return json(res, 200, {
        dir: abs,
        parent,
        dirs: [],
        exists: false,
        isDir: false,
        entries: 0,
        git: false,
      })
    if (!st.isDirectory())
      return json(res, 200, {
        dir: abs,
        parent,
        dirs: [],
        exists: true,
        isDir: false,
        entries: 0,
        git: false,
      })
    const items = await fsp.readdir(abs, { withFileTypes: true }).catch(() => null)
    if (!items) return json(res, 403, { error: { message: 'Нет доступа к папке' } })
    const dirs = items
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules')
      .map((e) => ({ name: e.name, path: path.join(abs, e.name) }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 500)
    return json(res, 200, {
      dir: abs,
      parent,
      dirs,
      exists: true,
      isDir: true,
      entries: items.filter((e) => !SKIP.has(e.name)).length,
      git: items.some((e) => e.name === '.git'),
    })
  }
  /* проверка пути до создания проекта: можно ли писать, что там лежит */
  if (u.pathname === '/api/project/check' && req.method === 'POST') {
    const { folder } = await readBody(req)
    let abs
    try {
      abs = checkFolder(folder)
    } catch (e) {
      return json(res, 200, { ok: false, reason: e.message })
    }
    let probe = abs
    while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe)
    if (!fs.statSync(probe).isDirectory())
      return json(res, 200, { ok: false, reason: 'Путь проходит через файл: ' + probe })
    try {
      await fsp.access(probe, fs.constants.W_OK)
    } catch {
      return json(res, 200, { ok: false, reason: 'Нет прав на запись в ' + probe })
    }
    const exists = fs.existsSync(abs)
    const items = exists ? await fsp.readdir(abs).catch(() => []) : []
    return json(res, 200, {
      ok: true,
      dir: abs,
      exists,
      entries: items.filter((x) => !SKIP.has(x)).length,
      git: items.includes('.git'),
    })
  }
  /* показать папку проекта (или файл в ней) в проводнике ОС */
  if (u.pathname === '/api/fs/reveal' && req.method === 'POST') {
    const { id, name, folder, rel } = await readBody(req)
    const dir = await projectDir(id, name, folder)
    const target = rel && fs.existsSync(inside(dir, rel)) ? inside(dir, rel) : dir
    const isFile = target !== dir
    const [cmd, args] =
      process.platform === 'win32'
        ? ['explorer.exe', isFile ? ['/select,' + target] : [target]]
        : process.platform === 'darwin'
          ? ['open', isFile ? ['-R', target] : [target]]
          : ['xdg-open', [isFile ? path.dirname(target) : target]]
    try {
      const c = spawn(cmd, args, { detached: true, stdio: 'ignore' })
      c.on('error', () => {})
      c.unref()
    } catch {
      return json(res, 200, { ok: false, reason: 'Не удалось открыть проводник' })
    }
    return json(res, 200, { ok: true, dir: target })
  }
  /* путь для проекта, созданного до 2.0 (лежал в ROOT/<имя>) */
  if (u.pathname === '/api/project/resolve' && req.method === 'POST') {
    const { id, name } = await readBody(req)
    return json(res, 200, { ok: true, dir: await projectDir(id, name) })
  }

  /* автокопии данных приложения: ~/TetraFree/backups, хранится 14 последних */
  if (u.pathname === '/api/backup' && (req.method === 'POST' || req.method === 'GET')) {
    const dir = path.join(path.dirname(ROOT), 'backups')
    if (req.method === 'POST') {
      const { data } = await readBody(req)
      if (!data || data.app !== 'tetrafree' || !Array.isArray(data.projects))
        return json(res, 400, { ok: false, reason: 'Это не копия TetraFree' })
      await fsp.mkdir(dir, { recursive: true })
      const name = nameFor(new Date())
      const tmp = path.join(dir, name + '.tmp')
      await fsp.writeFile(tmp, JSON.stringify(data))
      await fsp.rename(tmp, path.join(dir, name))
      for (const old of stale(await fsp.readdir(dir), 14)) await fsp.rm(path.join(dir, old), { force: true })
    }
    const names = (await fsp.readdir(dir).catch(() => [])).filter(isBackupName).sort().reverse()
    const list = []
    for (const n of names.slice(0, 14)) {
      const st = await fsp.stat(path.join(dir, n)).catch(() => null)
      if (st) list.push({ name: n, size: st.size, at: st.mtimeMs })
    }
    return json(res, 200, { ok: true, dir, list })
  }

  /* полная синхронизация: браузер — источник правды */
  if (u.pathname === '/api/sync' && req.method === 'POST') {
    const { id, name, folder, files = {}, prune = true } = await readBody(req)
    const dir = await projectDir(id, name, folder)
    for (const [rel, content] of Object.entries(files)) {
      const abs = inside(dir, rel)
      await fsp.mkdir(path.dirname(abs), { recursive: true })
      await fsp.writeFile(abs, content)
    }
    if (prune) {
      const lim = { n: 0, bytes: 0, cut: false }
      const disk = await walk(dir, dir, {}, lim)
      if (!lim.cut)
        for (const rel of Object.keys(disk))
          if (!(rel in files) && rel !== '.gitignore') {
            await fsp.rm(inside(dir, rel), { force: true })
            await pruneEmpty(path.dirname(inside(dir, rel)), dir)
          }
    }
    await ensureGit(dir)
    return json(res, 200, { ok: true, dir })
  }
  /* инкрементальные правки */
  if (u.pathname === '/api/fs/batch' && req.method === 'POST') {
    const { id, name, folder, write = {}, remove = [] } = await readBody(req)
    const dir = await projectDir(id, name, folder)
    for (const [rel, content] of Object.entries(write)) {
      const abs = inside(dir, rel)
      await fsp.mkdir(path.dirname(abs), { recursive: true })
      await fsp.writeFile(abs, content)
    }
    for (const rel of remove) {
      const abs = inside(dir, rel)
      await fsp.rm(abs, { force: true, recursive: true })
      await pruneEmpty(path.dirname(abs), dir)
    }
    return json(res, 200, { ok: true, dir })
  }
  /* хеши файлов на диске — для подхвата правок из внешнего редактора */
  if (u.pathname === '/api/fs/hashes') {
    const dir = await projectDir(
      u.searchParams.get('id'),
      u.searchParams.get('name'),
      u.searchParams.get('folder'),
    )
    const lim = { n: 0, bytes: 0, cut: false }
    const files = await walk(dir, dir, {}, lim)
    return json(res, 200, {
      dir,
      truncated: lim.cut,
      ignore: await fsp.readFile(path.join(dir, '.gitignore'), 'utf8').catch(() => ''),
      skip: [...SKIP],
      hashes: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, fnv(v)])),
    })
  }
  if (u.pathname === '/api/fs/read' && req.method === 'POST') {
    const { id, name, folder, paths = [] } = await readBody(req)
    const dir = await projectDir(id, name, folder)
    const out = {}
    for (const rel of paths) {
      try {
        out[rel] = await fsp.readFile(inside(dir, rel), 'utf8')
      } catch {
        out[rel] = null
      }
    }
    return json(res, 200, { files: out })
  }

  /* shell: NDJSON-стрим {t:'o'|'e', d} … {t:'x', code, cwd} */
  if (u.pathname === '/api/exec' && req.method === 'POST') {
    const { id, name, folder, cmd, cwd = '', timeout = 600, runId } = await readBody(req)
    const dir = await projectDir(id, name, folder)
    const wd = inside(dir, cwd)
    res.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-cache',
      'access-control-allow-origin': '*',
      'x-accel-buffering': 'no',
    })
    const send = (o) => {
      try {
        res.write(JSON.stringify(o) + '\n')
      } catch {
        /* клиент ушёл */
      }
    }
    const marker = '__TF_CWD__'
    const isWin = process.platform === 'win32'
    const script = isWin
      ? `${cmd} & echo ${marker}%CD%`
      : `trap 'printf "\\n${marker}%s\\n" "$(pwd)"' EXIT\n${cmd}`
    const child = spawn(
      isWin
        ? 'cmd.exe'
        : process.env.SHELL && !process.env.SHELL.endsWith('fish')
          ? process.env.SHELL
          : 'bash',
      isWin ? ['/d', '/s', '/c', script] : ['-lc', script],
      {
        cwd: fs.existsSync(wd) ? wd : dir,
        env: { ...process.env, FORCE_COLOR: '1', TERM: 'xterm-256color', TETRA_PROJECT: name },
        detached: !isWin,
      },
    )
    if (runId) running.set(runId, child)
    let newCwd = cwd,
      hold = ''
    const onOut = (d) => {
      let s = hold + d.toString('utf8')
      hold = ''
      const k = s.indexOf(marker)
      if (k >= 0) {
        const nl = s.indexOf('\n', k)
        if (nl < 0) {
          hold = s.slice(k)
          s = s.slice(0, k)
        } else {
          const abs = s.slice(k + marker.length, nl).trim()
          if (abs === dir) newCwd = ''
          else if (abs.startsWith(dir + path.sep)) newCwd = path.relative(dir, abs).split(path.sep).join('/')
          s = s.slice(0, k).replace(/\r?\n$/, '') + s.slice(nl + 1)
        }
      } else {
        for (let j = Math.min(marker.length, s.length); j > 0; j--)
          if (marker.startsWith(s.slice(-j).replace(/^\n/, ''))) {
            hold = s.slice(-j)
            s = s.slice(0, -j)
            break
          }
      }
      if (s) send({ t: 'o', d: s })
    }
    const onErr = (d) => send({ t: 'e', d: d.toString('utf8') })
    child.stdout.on('data', onOut)
    child.stderr.on('data', onErr)
    const kill = () => {
      try {
        if (isWin) child.kill()
        else process.kill(-child.pid, 'SIGTERM')
      } catch {
        /* уже завершён */
      }
    }
    const timer = setTimeout(() => {
      send({ t: 'e', d: `\n[таймаут ${timeout} с — процесс остановлен]\n` })
      kill()
    }, timeout * 1000)
    req.on('close', () => {
      if (child.exitCode === null) kill()
    })
    res.on('close', () => {
      if (child.exitCode === null) kill()
    })
    child.on('error', (e) => {
      send({ t: 'e', d: String(e) + '\n' })
    })
    child.on('close', (code, sig) => {
      clearTimeout(timer)
      if (hold && !hold.includes(marker)) send({ t: 'o', d: hold })
      if (runId) running.delete(runId)
      send({ t: 'x', code: code ?? (sig ? 130 : 1), cwd: newCwd })
      res.end()
    })
    return
  }
  if (u.pathname === '/api/exec/kill' && req.method === 'POST') {
    const { runId } = await readBody(req)
    const c = running.get(runId)
    if (c) {
      try {
        process.platform === 'win32' ? c.kill() : process.kill(-c.pid, 'SIGINT')
      } catch {
        /* noop */
      }
    }
    return json(res, 200, { ok: !!c })
  }

  /* git */
  if (u.pathname.startsWith('/api/git/') && req.method === 'POST') {
    const op = u.pathname.slice(9)
    const body = await readBody(req)
    const dir = await projectDir(body.id, body.name, body.folder)
    if (!(await ensureGit(dir))) return json(res, 200, { ok: false, reason: 'git не установлен' })
    const clip = (t) => (t.length > MAX_DIFF ? t.slice(0, MAX_DIFF) + '\n… diff обрезан' : t)
    const relOk = (p) => {
      inside(dir, p)
      return p
    }
    if (op === 'commit') {
      const { message, paths, manual, amend, partial } = body
      if (amend) {
        if ((await git(dir, ['rev-parse', '--verify', '-q', 'HEAD'])).code !== 0)
          return json(res, 200, { ok: false, reason: 'Исправлять нечего: коммитов ещё нет' })
        if (Array.isArray(paths) && paths.length) await git(dir, ['add', '-A', '--', ...paths.map(relOk)])
        const r = await git(dir, [
          'commit',
          '--amend',
          '-q',
          ...(String(message || '').trim() ? ['-m', String(message).trim()] : ['--no-edit']),
        ])
        const h = await git(dir, ['rev-parse', '--short', 'HEAD'])
        return json(res, 200, {
          ok: r.code === 0,
          hash: h.so.trim(),
          out: r.out,
          reason: r.code === 0 ? undefined : r.out.trim().slice(-200),
        })
      }
      if (manual && !String(message || '').trim())
        return json(res, 200, { ok: false, reason: 'Нужно сообщение коммита' })
      /* выборочный коммит: из части файлов — только отмеченные блоки (hunks) */
      const parts = partial && typeof partial === 'object' ? Object.entries(partial) : []
      if (manual && parts.length) {
        if ((await git(dir, ['rev-parse', '--verify', '-q', 'HEAD'])).code !== 0)
          return json(res, 200, { ok: false, reason: 'Выборочный коммит возможен после первого коммита' })
        await git(dir, ['reset', '-q'])
        if (Array.isArray(paths) && paths.length) await git(dir, ['add', '-A', '--', ...paths.map(relOk)])
        for (const [pth, sel] of parts) {
          relOk(pth)
          const d = await git(dir, ['diff', 'HEAD', '--no-color', '--', pth])
          if (splitHunks(d.so).hunks.length !== sel.total) {
            await git(dir, ['reset', '-q'])
            return json(res, 200, { ok: false, reason: `«${pth}» изменился — выбери блоки заново` })
          }
          const patch = pickHunks(d.so, Array.isArray(sel.idx) ? sel.idx : [])
          if (!patch) continue
          const a = await git(dir, ['apply', '--cached', '--recount', '-'], 0, patch)
          if (a.code !== 0) {
            await git(dir, ['reset', '-q'])
            return json(res, 200, {
              ok: false,
              reason: 'Не удалось взять выбранные блоки: ' + a.out.trim().slice(-160),
            })
          }
        }
        if ((await git(dir, ['diff', '--cached', '--quiet'])).code === 0)
          return json(res, 200, { ok: false, reason: 'Нечего коммитить' })
        const r = await git(dir, ['commit', '-q', '-m', String(message).trim()])
        const h = await git(dir, ['rev-parse', '--short', 'HEAD'])
        return json(res, 200, { ok: r.code === 0, hash: h.so.trim(), out: r.out })
      }
      if (Array.isArray(paths) && paths.length) await git(dir, ['add', '-A', '--', ...paths.map(relOk)])
      else await git(dir, ['add', '-A'])
      if (manual) {
        const q = await git(dir, ['diff', '--cached', '--quiet'])
        if (q.code === 0) return json(res, 200, { ok: false, reason: 'Нечего коммитить' })
      }
      const args = ['commit', '-q', '-m', message || 'TetraFree version']
      if (!manual) args.push('--allow-empty')
      if (manual && Array.isArray(paths) && paths.length) args.push('--only', '--', ...paths.map(relOk))
      const r = await git(dir, args)
      const h = await git(dir, ['rev-parse', '--short', 'HEAD'])
      return json(res, 200, { ok: r.code === 0, hash: h.so.trim(), out: r.out })
    }
    if (op === 'status') {
      const r = await git(dir, ['status', '--porcelain=v1', '-z', '-b', '-uall'])
      if (r.code !== 0) return json(res, 200, { ok: false, reason: r.se.trim() || 'git status не удался' })
      const st = parseStatus(r.so)
      return json(res, 200, {
        ok: true,
        ...st,
        files: st.files
          .filter((f) => !f.path.startsWith('.tetrafree/'))
          .map((f) => ({ ...f, kind: kindOf(f) })),
      })
    }
    if (op === 'diff') {
      const p = relOk(String(body.path || ''))
      const tracked = (await git(dir, ['ls-files', '--error-unmatch', '--', p])).code === 0
      let r
      if (!tracked) r = await git(dir, ['diff', '--no-index', '--no-color', '--', os.devNull, p])
      else {
        const hasHead = (await git(dir, ['rev-parse', '--verify', '-q', 'HEAD'])).code === 0
        r = await git(
          dir,
          hasHead ? ['diff', 'HEAD', '--no-color', '--', p] : ['diff', '--cached', '--no-color', '--', p],
        )
      }
      return json(res, 200, { ok: true, diff: clip(r.so), binary: /^Binary files /m.test(r.so) })
    }
    if (op === 'log') {
      const n = Math.min(100, Math.max(1, +body.limit || 30))
      const r = await git(dir, ['log', `-n${n}`, '--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%at%x1e'])
      return json(res, 200, { ok: true, commits: r.code === 0 ? parseLog(r.so) : [] })
    }
    if (op === 'blame') {
      const p = relOk(String(body.path || ''))
      const r = await git(dir, ['blame', '--line-porcelain', '-w', '--', p])
      if (r.code !== 0)
        return json(res, 200, {
          ok: false,
          reason: /no such path|no such file|fatal: no/i.test(r.se || '')
            ? 'Файл ещё не в git — сделай коммит'
            : (r.se || 'git blame не сработал').trim().slice(0, 200),
        })
      return json(res, 200, { ok: true, rows: parseBlame(r.so).slice(0, 5000) })
    }
    if (op === 'show') {
      const h = String(body.hash || '')
      if (!/^[0-9a-f]{7,40}$/i.test(h)) return json(res, 400, { ok: false, reason: 'Неверный хеш' })
      const r = await git(dir, [
        'show',
        '--no-color',
        '--stat',
        '--patch',
        '--format=%h %s%n%an · %ad',
        '--date=short',
        h,
      ])
      return json(res, 200, { ok: r.code === 0, diff: clip(r.so) })
    }
    if (op === 'discard') {
      const p = relOk(String(body.path || ''))
      const tracked = (await git(dir, ['ls-files', '--error-unmatch', '--', p])).code === 0
      if (tracked) {
        const hasHead = (await git(dir, ['rev-parse', '--verify', '-q', 'HEAD'])).code === 0
        if (hasHead) await git(dir, ['checkout', 'HEAD', '--', p])
        else await git(dir, ['rm', '-q', '-f', '--cached', '--', p])
      } else await fsp.rm(inside(dir, p), { force: true })
      return json(res, 200, { ok: true })
    }
    const okName = (n) =>
      /^[A-Za-z0-9][\w./-]{0,99}$/.test(n) && !n.includes('..') && !n.endsWith('/') && !n.endsWith('.lock')
    if (op === 'stash') {
      const m = String(body.message || '')
        .trim()
        .slice(0, 100)
      const r = await git(dir, ['stash', 'push', '-u', '-q', ...(m ? ['-m', m] : [])])
      if (r.code !== 0) return json(res, 200, { ok: false, reason: r.out.trim().slice(-200) })
      return json(res, 200, { ok: true })
    }
    if (op === 'stashes') {
      const r = await git(dir, ['stash', 'list', '--format=%gd%x09%s%x09%at'])
      return json(res, 200, {
        ok: true,
        stashes: r.so
          .split('\n')
          .filter(Boolean)
          .map((l) => {
            const [ref, subject, at] = l.split('\t')
            return { ref, subject, at: +at || 0 }
          }),
      })
    }
    if (op === 'stashpop' || op === 'stashdrop') {
      const ref = String(body.ref || '')
      if (!/^stash@\{\d{1,3}\}$/.test(ref))
        return json(res, 400, { ok: false, reason: 'Неверная ссылка на stash' })
      const r = await git(dir, ['stash', op === 'stashpop' ? 'pop' : 'drop', '-q', ref])
      return json(res, 200, {
        ok: r.code === 0,
        reason:
          r.code === 0
            ? undefined
            : /conflict|overwritten|local changes/i.test(r.out)
              ? 'Есть пересечения с текущими правками — закоммить или отложи их, stash остался на месте'
              : r.out.trim().slice(-200),
      })
    }
    if (op === 'merge') {
      const name = String(body.name || '').trim()
      if (!okName(name)) return json(res, 200, { ok: false, reason: 'Недопустимое имя ветки' })
      const r = await git(dir, ['merge', '--no-edit', '--no-ff', name])
      if (r.code !== 0) {
        await git(dir, ['merge', '--abort'])
        return json(res, 200, {
          ok: false,
          reason: /conflict/i.test(r.out)
            ? 'Конфликты слияния — слияние отменено, ничего не изменилось'
            : r.out.trim().slice(-200),
        })
      }
      return json(res, 200, { ok: true, out: r.out.trim().slice(-200) })
    }
    if (op === 'delbranch') {
      const name = String(body.name || '').trim()
      if (!okName(name)) return json(res, 200, { ok: false, reason: 'Недопустимое имя ветки' })
      const r = await git(dir, ['branch', body.force ? '-D' : '-d', name])
      return json(res, 200, {
        ok: r.code === 0,
        reason:
          r.code === 0 ? undefined : /not fully merged/i.test(r.out) ? 'notmerged' : r.out.trim().slice(-200),
      })
    }
    if (op === 'branches') {
      const r = await git(dir, ['branch', '--format=%(refname:short)%09%(HEAD)'])
      const list = r.so
        .split('\n')
        .filter(Boolean)
        .map((l) => {
          const [name, head] = l.split('\t')
          return { name, current: head === '*' }
        })
      const rm = await git(dir, ['remote'])
      return json(res, 200, {
        ok: true,
        branches: list,
        remote: rm.so.trim().split('\n').filter(Boolean)[0] || '',
      })
    }
    if (op === 'checkout' || op === 'branch') {
      const name = String(body.name || '').trim()
      if (
        !/^[A-Za-z0-9][\w./-]{0,99}$/.test(name) ||
        name.includes('..') ||
        name.endsWith('/') ||
        name.endsWith('.lock')
      )
        return json(res, 200, { ok: false, reason: 'Недопустимое имя ветки (латиница, цифры, - _ . /)' })
      const r = await git(
        dir,
        op === 'branch' ? ['checkout', '-q', '-b', name] : ['checkout', '-q', name, '--'],
      )
      return json(res, 200, {
        ok: r.code === 0,
        reason:
          r.code === 0
            ? undefined
            : r.se.trim().split('\n').slice(0, 3).join(' ') || 'git checkout не удался',
      })
    }
    if (op === 'fetch' || op === 'pull' || op === 'push') {
      const rm = (await git(dir, ['remote'])).so.trim()
      if (!rm)
        return json(res, 200, {
          ok: false,
          reason: 'Удалённый репозиторий не настроен (git remote add origin …)',
        })
      let args = op === 'pull' ? ['pull', '--ff-only'] : [op]
      if (op === 'push') {
        const up = await git(dir, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
        if (up.code !== 0) args = ['push', '-u', rm.split('\n')[0], 'HEAD']
      }
      const r = await git(dir, args, 60000)
      return json(res, 200, {
        ok: r.code === 0,
        out: r.out.trim().slice(-400),
        reason:
          r.code === 0
            ? undefined
            : r.se.trim().split('\n').slice(-3).join(' ') || 'git ' + op + ' не удался',
      })
    }
    return json(res, 404, { ok: false, reason: 'Неизвестная операция git' })
  }

  /* прокси к LLM: стримит ответ как есть */
  if (u.pathname === '/api/proxy' && req.method === 'POST') {
    const { url, method = 'POST', headers = {}, body } = await readBody(req)
    if (!/^https?:\/\//.test(url)) return json(res, 400, { error: { message: 'Некорректный URL' } })
    const ac = new AbortController()
    res.on('close', () => ac.abort())
    try {
      const h = { ...headers }
      delete h['anthropic-dangerous-direct-browser-access']
      const r = await fetch(url, { method, headers: h, body, signal: ac.signal })
      res.writeHead(r.status, {
        'content-type': r.headers.get('content-type') || 'application/octet-stream',
        'cache-control': 'no-cache',
        'access-control-allow-origin': '*',
        'x-accel-buffering': 'no',
      })
      if (!r.body) return res.end()
      for await (const chunk of r.body) res.write(chunk)
      res.end()
    } catch (e) {
      if (!res.headersSent)
        json(res, 502, {
          error: { message: 'Бэкенд не смог связаться с провайдером: ' + (e.cause?.code || e.message) },
        })
      else res.end()
    }
    return
  }

  /* превью: /preview/<имя>/путь */
  const pm = u.pathname.match(/^\/preview\/[0-9a-f]{32}\/([^/]+)\/?(.*)$/)
  if (pm) {
    if (!isLocal || !previewValid(pv[1])) {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' })
      return res.end('Сессия превью недействительна — открой превью из приложения')
    }
    const pname = safeName(decodeURIComponent(pm[1]))
    const dir = REG.get(pname) || path.join(ROOT, pname)
    let rel = decodeURIComponent(pm[2] || '')
    if (!rel) rel = fs.existsSync(path.join(dir, 'site', 'index.html')) ? 'site/index.html' : 'index.html'
    let abs
    try {
      abs = inside(dir, rel)
    } catch {
      res.writeHead(400)
      return res.end('bad path')
    }
    if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) abs = path.join(abs, 'index.html')
    if (!fs.existsSync(abs)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
      return res.end('Файл не найден: ' + rel)
    }
    res.writeHead(200, {
      'content-type':
        (MIME[abs.split('.').pop().toLowerCase()] || 'application/octet-stream') + '; charset=utf-8',
      'cache-control': 'no-store',
    })
    return fs.createReadStream(abs).pipe(res)
  }
  return false
}

/** middleware для vite / connect */
export function tetraMiddleware() {
  return (req, res, next) => {
    if (!req.url.startsWith('/api/') && !req.url.startsWith('/preview/')) return next()
    /* локальные функции (диск, shell) — только с этого компьютера; аккаунты и команды — ещё и с хостов из TF_ALLOWED_HOSTS */
    const host = String(req.headers.host || '').replace(/:\d+$/, '')
    const origin = String(req.headers.origin || '')
    const extra = String(process.env.TF_ALLOWED_HOSTS || '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
    const LOCALS = ['localhost', '127.0.0.1', '[::1]', 'tauri.localhost']
    const localHost = LOCALS.includes(host)
    const okHost = localHost || extra.includes(host)
    const originHost = origin.replace(/^[a-z]+:\/\//, '').replace(/:\d+$/, '')
    const localOrigin =
      !origin ||
      /^(https?:\/\/(localhost|127\.0\.0\.1|\[::1\]|tauri\.localhost)(:\d+)?|tauri:\/\/localhost)$/.test(
        origin,
      ) ||
      (extra.includes(originHost) && originHost === host)
    if (!okHost || !localOrigin)
      return json(res, 403, {
        error: { message: 'TetraFree backend принимает запросы только с этого компьютера' },
      })
    const isLocal = localHost
    handle(req, res, isLocal)
      .then((r) => {
        if (r === false) next()
      })
      .catch((e) => {
        if (!res.headersSent) json(res, e.status || 500, { error: { message: e.message } })
        else res.end()
      })
  }
}

/** `npm run build` + `npm run server`: сервер сам отдаёт собранное приложение (для командного хоста) */
const DIST = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist')
function serveStatic(req, res) {
  if (!fs.existsSync(path.join(DIST, 'index.html')) || (req.method !== 'GET' && req.method !== 'HEAD'))
    return json(res, 404, { error: { message: 'not found' } })
  const url = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  let abs = path.join(DIST, url)
  if (!abs.startsWith(DIST)) {
    res.writeHead(400)
    return res.end()
  }
  if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) abs = path.join(DIST, 'index.html')
  const ext = abs.split('.').pop().toLowerCase()
  res.writeHead(200, {
    'content-type':
      (MIME[ext] || 'application/octet-stream') +
      (/^(html|css|js|mjs|json|svg)$/.test(ext) ? '; charset=utf-8' : ''),
    'cache-control': abs.includes('/assets/') ? 'public,max-age=31536000,immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'same-origin',
  })
  fs.createReadStream(abs).pipe(res)
}

export function start(port = +(process.env.PORT || 3001), host = process.env.HOST || '127.0.0.1') {
  const mw = tetraMiddleware()
  const srv = http.createServer((req, res) => mw(req, res, () => serveStatic(req, res)))
  srv.listen(port, host, () =>
    console.log(
      `TetraFree backend → http://${host}:${port}  ·  проекты: ${ROOT}  ·  git: ${HAS_GIT ? 'да' : 'нет'}`,
    ),
  )
  return srv
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) start()
