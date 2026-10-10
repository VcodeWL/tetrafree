/* Каталог расширений: навыки, команды, MCP-серверы и наборы.
   Источники: встроенный каталог (офлайн), официальный реестр MCP, skills.sh + GitHub.
   Всё скачанное — чужой текст: перед установкой пользователь видит, какие файлы появятся, а в ответах модели
   такие инструкции работают как обычные навыки проекта. Чистые функции отделены от сети — их проверяют тесты. */
import { BUNDLED, type BundledItem } from '../data/market'
import { backendFetch } from './backend'
import { parseFrontmatter } from '../agent/slash'
import { addServer, removeServer, configPath, validName, type McpCfg } from './mcpconfig'

export type MarketKind = 'skill' | 'command' | 'mcp' | 'bundle'
export interface EnvNeed {
  name: string
  desc: string
  secret: boolean
}
export interface Pack {
  files: Record<string, string>
  mcp: Record<string, McpCfg>
  env: EnvNeed[]
  notes: string[]
}
export interface MarketItem {
  key: string
  kind: MarketKind
  id: string
  name: string
  desc: string
  source: 'встроенный' | 'MCP Registry' | 'skills.sh'
  installs?: number
  url?: string
  /** готовый набор файлов; у навыков из skills.sh его нужно сначала скачать */
  pack?: Pack
  remote?: { repo: string; skillId: string }
  /** нельзя установить — причина */
  blocked?: string
  /** из чего состоит набор */
  parts?: string[]
}
export interface Installed {
  key: string
  kind: MarketKind
  id: string
  name: string
  source: string
  files: string[]
  mcp: string[]
  at: number
}

/** Команда /market просит открыть «Расширения» сразу на каталоге (и подставить запрос) */
export const wanted = { tab: '', q: '' }

export const MARKET_FILE = '.tetra/market.json'
const KINDS: MarketKind[] = ['skill', 'command', 'mcp', 'bundle']

/* ------------------------------------------------------------------ учёт установленного */

export function readInstalled(text: string | undefined): Installed[] {
  try {
    const j = JSON.parse(text || '{}')
    const list = Array.isArray(j?.items) ? j.items : []
    return list.filter(
      (x: Installed) =>
        x &&
        typeof x.key === 'string' &&
        KINDS.includes(x.kind) &&
        Array.isArray(x.files) &&
        x.files.every((f) => typeof f === 'string' && safePath(f)) &&
        Array.isArray(x.mcp) &&
        x.mcp.every((m) => typeof m === 'string'),
    )
  } catch {
    return []
  }
}
export const writeInstalled = (items: Installed[]) => JSON.stringify({ v: 1, items }, null, 2) + '\n'

/** Файлы расширений живут только в .tetra/skills и .tetra/commands, без выхода из папки и без служебных имён */
export function safePath(p: string): boolean {
  if (!/^\.tetra\/(skills|commands)\/[^\\:*?"<>|\0]+$/.test(p) || p.length > 200) return false
  return p.split('/').every((s) => s && s !== '.' && s !== '..' && !/^\.git/.test(s) && !/[\s.]$/.test(s))
}

export function mcpNames(files: Record<string, string>): string[] {
  try {
    const j = JSON.parse(files[configPath(files)] || '{}')
    return Object.keys(j.mcpServers || j.servers || {})
  } catch {
    return []
  }
}

export interface Plan {
  write: Record<string, string>
  conflicts: string[]
  error?: string
}

/** Что запишется и что при этом будет перезаписано чужое (не установленное этим же элементом) */
export function planInstall(
  item: MarketItem,
  pack: Pack,
  files: Record<string, string>,
  installed: Installed[],
): Plan {
  const mine = installed.find((i) => i.key === item.key)
  const own = new Set(mine?.files || [])
  const ownMcp = new Set(mine?.mcp || [])
  const write: Record<string, string> = {}
  const conflicts: string[] = []
  for (const [p, t] of Object.entries(pack.files)) {
    if (!safePath(p)) return { write: {}, conflicts, error: `Недопустимый путь файла: ${p}` }
    if (p in files && !own.has(p) && files[p] !== t) conflicts.push(p)
    write[p] = t
  }
  const names = new Set(mcpNames(files))
  for (const n of Object.keys(pack.mcp)) if (names.has(n) && !ownMcp.has(n)) conflicts.push(`MCP «${n}»`)
  if (Object.keys(pack.mcp).length && files[configPath(files)]) {
    try {
      JSON.parse(files[configPath(files)])
    } catch {
      return { write: {}, conflicts, error: 'Файл конфигурации MCP повреждён — исправьте его вручную' }
    }
  }
  if (!Object.keys(write).length && !Object.keys(pack.mcp).length)
    return { write, conflicts, error: 'В элементе нет файлов для установки' }
  if (Object.keys(pack.mcp).some((n) => !validName(n)))
    return { write, conflicts, error: 'Недопустимое имя MCP-сервера' }
  const cfgPath = configPath(files)
  if (Object.keys(pack.mcp).length) {
    let text = files[cfgPath]
    for (const [n, c] of Object.entries(pack.mcp)) text = addServer(text, n, c)
    write[cfgPath] = text
  }
  const rec: Installed = {
    key: item.key,
    kind: item.kind,
    id: item.id,
    name: item.name,
    source: item.source,
    files: Object.keys(pack.files),
    mcp: Object.keys(pack.mcp),
    at: Date.now(),
  }
  write[MARKET_FILE] = writeInstalled([...installed.filter((i) => i.key !== item.key), rec])
  return { write, conflicts }
}

/** Удаление: файлы из учёта + записи MCP, которые добавил этот элемент */
export function planRemove(
  key: string,
  files: Record<string, string>,
  installed: Installed[],
): { write: Record<string, string>; remove: string[] } {
  const it = installed.find((i) => i.key === key)
  if (!it) return { write: {}, remove: [] }
  const write: Record<string, string> = {}
  const others = installed.filter((i) => i.key !== key)
  const shared = new Set(others.flatMap((i) => i.files))
  const sharedMcp = new Set(others.flatMap((i) => i.mcp))
  const remove = it.files.filter((f) => f in files && safePath(f) && !shared.has(f))
  const mine = it.mcp.filter((n) => !sharedMcp.has(n))
  if (mine.length) {
    const cfg = configPath(files)
    let text = files[cfg]
    for (const n of mine) {
      try {
        text = removeServer(text, n)
      } catch {
        break
      }
    }
    if (text !== undefined) write[cfg] = text
  }
  write[MARKET_FILE] = writeInstalled(installed.filter((i) => i.key !== key))
  return { write, remove }
}

/* ------------------------------------------------------------------ встроенный каталог */

const keyOf = (k: string, id: string) => `${k}:${id}`

function bundledPack(b: BundledItem, all: BundledItem[]): Pack {
  const pack: Pack = { files: {}, mcp: {}, env: [], notes: [...(b.notes || [])] }
  const src =
    b.kind === 'bundle' ? (b.parts || []).map((k) => all.find((x) => keyOf(x.kind, x.id) === k)) : [b]
  for (const s of src) {
    if (!s) continue
    Object.assign(pack.files, s.files)
    Object.assign(pack.mcp, s.mcp)
    if (s !== b) pack.notes.push(...(s.notes || []))
  }
  pack.notes = [...new Set(pack.notes)]
  return pack
}

export function bundledItems(all: BundledItem[] = BUNDLED): MarketItem[] {
  return all.map((b) => ({
    key: keyOf(b.kind, b.id),
    kind: b.kind,
    id: b.id,
    name: b.name,
    desc: b.desc,
    source: 'встроенный',
    pack: bundledPack(b, all),
    parts: b.parts,
  }))
}

/** Фильтр по словам запроса (все слова должны встретиться в названии или описании) */
export function matchItems(items: MarketItem[], q: string, kind: MarketKind | 'all'): MarketItem[] {
  const w = q.toLowerCase().split(/\s+/).filter(Boolean)
  return items.filter(
    (i) =>
      (kind === 'all' || i.kind === kind) &&
      w.every((x) => (i.name + ' ' + i.desc + ' ' + i.id).toLowerCase().includes(x)),
  )
}

/* ------------------------------------------------------------------ сеть */

async function getText(url: string, ms = 15000): Promise<string | null> {
  try {
    const r = await backendFetch(url, {
      method: 'GET',
      headers: { accept: '*/*' },
      signal: AbortSignal.timeout(ms),
    })
    return r.ok ? await r.text() : null
  } catch {
    return null
  }
}
async function getJson<T>(url: string): Promise<T> {
  const t = await getText(url)
  if (t === null) throw new Error('Нет связи с ' + new URL(url).host)
  try {
    return JSON.parse(t) as T
  } catch {
    throw new Error('Неожиданный ответ от ' + new URL(url).host)
  }
}

/* ---- официальный реестр MCP ---- */

interface RegVar {
  name: string
  description?: string
  isRequired?: boolean
  isSecret?: boolean
  default?: string
  value?: string
}
interface RegArg {
  type?: string
  name?: string
  value?: string
  valueHint?: string
  isRequired?: boolean
}
export interface RegServer {
  name: string
  description?: string
  title?: string
  version?: string
  websiteUrl?: string
  repository?: { url?: string }
  packages?: {
    registryType?: string
    identifier: string
    version?: string
    runtimeHint?: string
    transport?: { type?: string }
    environmentVariables?: RegVar[]
    packageArguments?: RegArg[]
  }[]
  remotes?: {
    type?: string
    url: string
    headers?: RegVar[]
    variables?: Record<string, { default?: string }>
  }[]
}

export const slugName = (s: string) =>
  s
    .replace(/^(io\.github\.|io\.|com\.|ai\.|org\.|dev\.|app\.|net\.)/, '')
    .replace(/\//g, '-')
    .replace(/[^\w.-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 40) || 'server'

const envName = (s: string) =>
  s
    .replace(/[^A-Za-z0-9]+/g, '_')
    .toUpperCase()
    .replace(/^(\d)/, '_$1')

const argsOf = (list: RegArg[] | undefined, notes: string[]): string[] => {
  const out: string[] = []
  for (const a of list || []) {
    if (a.value !== undefined && a.value !== '') {
      if (a.type === 'named' && a.name) out.push(a.name)
      out.push(a.value)
    } else if (a.isRequired)
      notes.push(
        `Нужен аргумент ${a.name || a.valueHint || ''} — допишите его в args после установки.`.replace(
          '  ',
          ' ',
        ),
      )
  }
  return out
}

/** Запись реестра → конфиг MCP. Порядок: npm (npx) → удалённый Streamable HTTP → PyPI (uvx) → Docker */
export function registryPack(s: RegServer): { pack?: Pack; blocked?: string } {
  const slug = slugName(s.name)
  const notes: string[] = []
  const env: EnvNeed[] = []
  const need = (v: RegVar, nm: string) => {
    if (!env.some((e) => e.name === nm))
      env.push({ name: nm, desc: v.description || '', secret: !!v.isSecret })
  }
  const pkgs = s.packages || []
  const mk = (cfg: McpCfg): { pack: Pack } => ({ pack: { files: {}, mcp: { [slug]: cfg }, env, notes } })

  const npm = pkgs.find((p) => p.registryType === 'npm' && (!p.transport || p.transport.type === 'stdio'))
  if (npm) {
    const e: Record<string, string> = {}
    for (const v of npm.environmentVariables || []) {
      e[v.name] = v.default ? '${' + v.name + ':-' + v.default + '}' : '${' + v.name + '}'
      if (v.isRequired !== false || v.isSecret) need(v, v.name)
    }
    const a = argsOf(npm.packageArguments, notes)
    notes.push('Пакет ' + npm.identifier + (npm.version ? '@' + npm.version : '') + '; нужны Node.js и npx.')
    return mk({
      command: 'npx',
      args: ['-y', npm.version ? `${npm.identifier}@${npm.version}` : npm.identifier, ...a],
      ...(Object.keys(e).length ? { env: e } : {}),
    })
  }
  const rem = (s.remotes || []).find((r) => r.type === 'streamable-http')
  if (rem) {
    let url = rem.url
    for (const [k, v] of Object.entries(rem.variables || {})) url = url.split(`{${k}}`).join(v.default || '')
    if (/[{}]/.test(url))
      return { blocked: 'Адрес сервера зависит от параметров, которые нужно задать вручную' }
    const h: Record<string, string> = {}
    for (const x of rem.headers || []) {
      if (x.value) {
        h[x.name] = x.value
        continue
      }
      const nm = envName(slug + '_' + x.name)
      h[x.name] = (/^bearer\b/i.test(x.description || '') ? 'Bearer ' : '') + '${' + nm + '}'
      if (x.isRequired !== false) need(x, nm)
    }
    notes.push('Удалённый сервер: запросы и данные уходят на ' + new URL(url).host + '.')
    return mk({ url, ...(Object.keys(h).length ? { headers: h } : {}) })
  }
  const py = pkgs.find((p) => p.registryType === 'pypi')
  if (py) {
    const e: Record<string, string> = {}
    for (const v of py.environmentVariables || []) {
      e[v.name] = '${' + v.name + '}'
      if (v.isRequired !== false) need(v, v.name)
    }
    notes.push('Запускается через uvx — нужен установленный uv.')
    return mk({
      command: py.runtimeHint || 'uvx',
      args: [
        py.version ? `${py.identifier}==${py.version}` : py.identifier,
        ...argsOf(py.packageArguments, notes),
      ],
      ...(Object.keys(e).length ? { env: e } : {}),
    })
  }
  const oci = pkgs.find((p) => p.registryType === 'oci')
  if (oci) {
    const a: string[] = ['run', '-i', '--rm']
    const e: Record<string, string> = {}
    for (const v of oci.environmentVariables || []) {
      a.push('-e', v.name)
      e[v.name] = '${' + v.name + '}'
      if (v.isRequired !== false) need(v, v.name)
    }
    notes.push('Запускается в Docker — нужен запущенный Docker.')
    return mk({
      command: 'docker',
      args: [...a, oci.identifier],
      ...(Object.keys(e).length ? { env: e } : {}),
    })
  }
  if ((s.remotes || []).length)
    return { blocked: 'Только устаревший транспорт SSE — он пока не поддерживается' }
  return { blocked: 'Нет способа запуска, который поддерживает TetraFree' }
}

export function registryItem(s: RegServer): MarketItem | null {
  if (!s || typeof s.name !== 'string') return null
  const r = registryPack(s)
  return {
    key: keyOf('mcp', 'reg:' + s.name),
    kind: 'mcp',
    id: s.name,
    name: slugName(s.name),
    desc: (s.description || s.title || '').slice(0, 300),
    source: 'MCP Registry',
    url: s.websiteUrl || s.repository?.url,
    pack: r.pack,
    blocked: r.blocked,
  }
}

export async function searchRegistry(
  q: string,
  cursor?: string,
): Promise<{ items: MarketItem[]; next?: string }> {
  const u = new URL('https://registry.modelcontextprotocol.io/v0/servers')
  if (q.trim()) u.searchParams.set('search', q.trim())
  u.searchParams.set('limit', '20')
  u.searchParams.set('version', 'latest')
  if (cursor) u.searchParams.set('cursor', cursor)
  const j = await getJson<{ servers?: { server: RegServer }[]; metadata?: { nextCursor?: string } }>(
    u.toString(),
  )
  const items = (j.servers || []).map((x) => registryItem(x.server)).filter((x): x is MarketItem => !!x)
  return { items, next: j.metadata?.nextCursor }
}

/* ---- навыки: skills.sh → GitHub ---- */

export const validRepo = (r: string) => /^[\w.-]{1,100}\/[\w.-]{1,100}$/.test(r)
export const validSkillId = (s: string) => /^[A-Za-z0-9][\w.-]{0,63}$/.test(s)

export async function searchSkills(q: string): Promise<MarketItem[]> {
  if (q.trim().length < 2) return []
  const j = await getJson<{
    skills?: { source: string; skillId: string; name?: string; installs?: number }[]
  }>('https://skills.sh/api/search?limit=20&q=' + encodeURIComponent(q.trim()))
  return (j.skills || [])
    .filter((s) => validRepo(s.source || '') && validSkillId(s.skillId || ''))
    .map((s) => ({
      key: keyOf('skill', `${s.source}/${s.skillId}`),
      kind: 'skill' as const,
      id: s.skillId,
      name: s.name || s.skillId,
      desc: `Навык из репозитория ${s.source}`,
      source: 'skills.sh' as const,
      installs: s.installs,
      url: 'https://github.com/' + s.source,
      remote: { repo: s.source, skillId: s.skillId },
    }))
}

/** Из списка путей репозитория — каталоги навыков (по SKILL.md), точное совпадение имени папки — первым */
export function rankSkillDirs(paths: string[], skillId: string): string[] {
  const dirs = paths
    .filter((p) => /(^|\/)SKILL\.md$/.test(p) && !/(^|\/)(node_modules|\.git)\//.test(p))
    .map((p) => p.replace(/\/?SKILL\.md$/, ''))
  const base = (d: string) => d.split('/').pop() || ''
  const exact = dirs.filter((d) => base(d) === skillId).sort((a, b) => a.length - b.length)
  return [...exact, ...dirs.filter((d) => base(d) !== skillId)].slice(0, 8)
}

interface TreeEntry {
  path: string
  type?: string
  size?: number
}
const TEXT_EXT = /\.(md|txt|json|ya?ml|toml|js|mjs|cjs|ts|tsx|py|sh|ps1|html|css|csv|xml|svg)$/i
export const SKILL_LIMITS = { files: 25, file: 100_000, total: 300_000 }

/** Какие файлы папки навыка брать: текстовые, небольшие, не больше лимитов */
export function pickSkillFiles(tree: TreeEntry[], dir: string): { take: string[]; skipped: string[] } {
  const pre = dir ? dir + '/' : ''
  const take: string[] = []
  const skipped: string[] = []
  let total = 0
  const own = tree
    .filter((t) => t.type !== 'tree' && t.path.startsWith(pre))
    .map((t) => ({ ...t, rel: t.path.slice(pre.length) }))
    .filter((t) => dir || !t.rel.includes('/') || /^(references|scripts|assets|examples)\//.test(t.rel))
    .sort((a, b) => (a.rel === 'SKILL.md' ? -1 : b.rel === 'SKILL.md' ? 1 : a.rel.localeCompare(b.rel)))
  for (const t of own) {
    const ok =
      TEXT_EXT.test(t.rel) &&
      (t.size ?? 0) <= SKILL_LIMITS.file &&
      take.length < SKILL_LIMITS.files &&
      total + (t.size ?? 0) <= SKILL_LIMITS.total &&
      safePath('.tetra/skills/x/' + t.rel)
    if (ok) {
      take.push(t.rel)
      total += t.size ?? 0
    } else skipped.push(t.rel)
  }
  return { take, skipped }
}

const raw = (repo: string, path: string) =>
  `https://raw.githubusercontent.com/${repo}/HEAD/${path.split('/').map(encodeURIComponent).join('/')}`

/** Скачивает навык из GitHub: находит SKILL.md, берёт его вместе с вложенными файлами */
export async function fetchSkillPack(repo: string, skillId: string): Promise<Pack> {
  if (!validRepo(repo) || !validSkillId(skillId)) throw new Error('Недопустимый источник навыка')
  const tj = await getText(`https://api.github.com/repos/${repo}/git/trees/HEAD?recursive=1`)
  let tree: TreeEntry[] | null = null
  try {
    if (tj) tree = (JSON.parse(tj).tree || []) as TreeEntry[]
  } catch {
    tree = null
  }
  const dirs = tree
    ? rankSkillDirs(
        tree.map((t) => t.path),
        skillId,
      )
    : [
        `skills/${skillId}`,
        skillId,
        `.claude/skills/${skillId}`,
        `skills/.curated/${skillId}`,
        `.agents/skills/${skillId}`,
        '',
      ]
  let found: { dir: string; text: string } | null = null
  for (const d of dirs) {
    const text = await getText(raw(repo, (d ? d + '/' : '') + 'SKILL.md'))
    if (text === null) continue
    const nm = parseFrontmatter(text).meta.name?.trim()
    const base = d.split('/').pop() || ''
    if (base === skillId || nm === skillId || (!tree && d === '')) {
      found = { dir: d, text }
      break
    }
  }
  if (!found)
    throw new Error(
      tree
        ? `В репозитории ${repo} не нашёлся навык «${skillId}»`
        : 'Не удалось прочитать репозиторий (возможно, лимит GitHub API) — попробуйте позже',
    )
  const dest = '.tetra/skills/' + skillId + '/'
  const pack: Pack = { files: { [dest + 'SKILL.md']: found.text }, mcp: {}, env: [], notes: [] }
  if (tree) {
    const { take, skipped } = pickSkillFiles(tree, found.dir)
    const rest = take.filter((r) => r !== 'SKILL.md')
    const got = await Promise.all(
      rest.map((r) => getText(raw(repo, (found!.dir ? found!.dir + '/' : '') + r))),
    )
    rest.forEach((r, i) => {
      const t = got[i]
      if (t !== null) pack.files[dest + r] = t
      else skipped.push(r)
    })
    if (skipped.length)
      pack.notes.push(
        `Не скачано ${skipped.length} ф. (бинарные, большие или недоступные): ${skipped.slice(0, 4).join(', ')}${skipped.length > 4 ? '…' : ''}`,
      )
  } else pack.notes.push('Скачан только SKILL.md — вложенные файлы навыка не загружены.')
  if (Object.keys(pack.files).some((p) => /\.(sh|ps1|py|js|mjs|cjs)$/.test(p)))
    pack.notes.push(
      'В навыке есть скрипты. Они сами не запускаются, но агент может запустить их по инструкции навыка — просмотрите файлы.',
    )
  pack.notes.push('Навык — чужие инструкции для модели. Прочитайте SKILL.md перед установкой.')
  return pack
}
