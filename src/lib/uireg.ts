/* Библиотеки интерфейсных компонентов (формат реестров shadcn): shadcn/ui, Magic UI, React Bits и любой свой реестр по ссылке.
   Здесь — разбор реестров, сбор зависимостей и раскладка файлов по проекту; запуск и предпросмотр — в uirun.ts.
   Чистая логика отделена от сети (get передаётся параметром) — её проверяют тесты. */
import { backendFetch } from './backend'

export interface UiSource {
  id: string
  name: string
  index: string
  item: (name: string) => string
  /** имя пространства в registryDependencies вида «@magicui/marquee» */
  ns?: string
  site: string
}
export const UI_SOURCES: UiSource[] = [
  {
    id: 'shadcn',
    name: 'shadcn/ui',
    index: 'https://ui.shadcn.com/r/styles/new-york-v4/registry.json',
    item: (n) => `https://ui.shadcn.com/r/styles/new-york-v4/${n}.json`,
    site: 'https://ui.shadcn.com',
  },
  {
    id: 'magicui',
    name: 'Magic UI',
    index: 'https://magicui.design/r/registry.json',
    item: (n) => `https://magicui.design/r/${n}.json`,
    ns: '@magicui',
    site: 'https://magicui.design',
  },
  {
    id: 'reactbits',
    name: 'React Bits',
    index: 'https://reactbits.dev/r/registry.json',
    item: (n) => `https://reactbits.dev/r/${n}.json`,
    site: 'https://reactbits.dev',
  },
]

export interface RegFile {
  path: string
  content?: string
  type?: string
  target?: string
}
export interface RegItem {
  name: string
  type?: string
  title?: string
  description?: string
  dependencies?: string[]
  devDependencies?: string[]
  registryDependencies?: string[]
  files?: RegFile[]
  cssVars?: Record<string, Record<string, string>>
  css?: Record<string, unknown>
}
export interface UiItem {
  source: string
  name: string
  title: string
  desc: string
  type: string
  /** имя элемента-примера с готовым использованием (если у реестра есть) */
  demo?: string
}

export const prettify = (n: string) =>
  n
    .replace(/-(TS|JS)-(TW|CSS)$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^./, (c) => c.toUpperCase())

/** Список реестра → элементы для показа. Примеры (`-demo`) не показываются отдельно, а привязываются к своему компоненту. */
export function parseIndex(src: Pick<UiSource, 'id'>, json: unknown): UiItem[] {
  const list: RegItem[] = Array.isArray((json as { items?: unknown })?.items)
    ? ((json as { items: RegItem[] }).items as RegItem[])
    : Array.isArray(json)
      ? (json as RegItem[])
      : []
  const examples = new Set(list.filter((i) => i?.type === 'registry:example').map((i) => i.name))
  const out: UiItem[] = []
  for (const i of list) {
    if (!i || typeof i.name !== 'string') continue
    const t = i.type || ''
    const show =
      src.id === 'reactbits'
        ? /-TS-TW$/.test(i.name)
        : src.id === 'custom'
          ? !/example|internal|style|font|theme|base|page/.test(t)
          : t === 'registry:ui'
    if (!show) continue
    out.push({
      source: src.id,
      name: i.name,
      title: i.title || prettify(i.name),
      desc: (i.description || '').slice(0, 240),
      type: t,
      demo: examples.has(i.name + '-demo') ? i.name + '-demo' : undefined,
    })
  }
  return out
}

export function filterUi(items: UiItem[], q: string): UiItem[] {
  const w = q.toLowerCase().split(/\s+/).filter(Boolean)
  return items.filter((i) =>
    w.every((x) => (i.title + ' ' + i.name + ' ' + i.desc).toLowerCase().includes(x)),
  )
}

/* ------------------------------------------------------------------ сеть */

const cache = new Map<string, Promise<unknown>>()
export type Getter = (url: string) => Promise<unknown>
export const getJson: Getter = (url) => {
  let p = cache.get(url)
  if (!p) {
    p = (async () => {
      let r: Response
      try {
        r = await backendFetch(url, {
          method: 'GET',
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(20000),
        })
      } catch {
        throw new Error('Нет связи с ' + new URL(url).host)
      }
      if (!r.ok) throw new Error(`${new URL(url).host}: ответ ${r.status}`)
      try {
        return await r.json()
      } catch {
        throw new Error(`${new URL(url).host}: это не JSON`)
      }
    })()
    p.catch(() => cache.delete(url))
    cache.set(url, p)
  }
  return p
}

export async function loadIndex(src: UiSource, get: Getter = getJson): Promise<UiItem[]> {
  return parseIndex(src, await get(src.index))
}

/** Свой реестр по ссылке: …/registry.json (список) или …/имя.json (один компонент) */
export function customSource(url: string): { src: UiSource; single?: boolean } {
  let u: URL
  try {
    u = new URL(url.trim())
  } catch {
    throw new Error('Нужна ссылка вида https://…/registry.json или https://…/компонент.json')
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('Только http(s)-ссылки')
  const base = u.href.slice(0, u.href.lastIndexOf('/') + 1)
  const single = !/registry\.json$|index\.json$/.test(u.pathname)
  return {
    single,
    src: {
      id: 'custom',
      name: u.host,
      index: u.href,
      item: (n) => (/^https?:\/\//.test(n) ? n : `${base}${n}.json`),
      site: u.origin,
    },
  }
}

/* ------------------------------------------------------------------ сборка зависимостей */

export interface BFile {
  path: string
  content: string
  type: string
  target?: string
  item: string
}
export interface Bundle {
  entry: string
  items: RegItem[]
  files: BFile[]
  notes: string[]
}

export async function resolveBundle(src: UiSource, name: string, get: Getter = getJson): Promise<Bundle> {
  const seen = new Map<string, RegItem>()
  const order: RegItem[] = []
  const notes: string[] = []
  const urlFor = (ref: string): string | null => {
    if (/^https?:\/\//.test(ref)) return ref
    const m = ref.match(/^(@[\w-]+)\/(.+)$/)
    if (m) {
      if (src.ns === m[1]) return src.item(m[2])
      notes.push(`Зависимость ${ref} из другого реестра — не подключена`)
      return null
    }
    return src.item(ref)
  }
  const visit = async (ref: string, depth: number): Promise<void> => {
    const url = urlFor(ref)
    if (!url || seen.has(url)) return
    if (depth > 6 || seen.size >= 40) {
      notes.push('Слишком глубокая цепочка зависимостей — часть пропущена')
      return
    }
    const j = (await get(url)) as RegItem
    if (!j || typeof j !== 'object' || typeof j.name !== 'string')
      throw new Error(`Не похоже на компонент: ${url}`)
    seen.set(url, j)
    for (const d of j.registryDependencies || []) {
      try {
        await visit(d, depth + 1)
      } catch (e) {
        notes.push(`Зависимость ${d}: ${(e as Error).message}`)
      }
    }
    order.push(j)
  }
  await visit(name, 0)
  const collect = (warn: boolean) => {
    const out: BFile[] = []
    for (const it of order)
      for (const f of it.files || []) {
        if (typeof f.content !== 'string' || !f.path) {
          if (warn)
            notes.push(
              `У файла ${f.path || '?'} из «${it.name}» нет содержимого — реестр отдаёт только список`,
            )
          continue
        }
        if (!out.some((x) => x.path === f.path))
          out.push({
            path: f.path,
            content: f.content,
            type: f.type || it.type || '',
            target: f.target,
            item: it.name,
          })
      }
    return out
  }
  /* Реестры не всегда перечисляют все зависимости (shadcn: dialog импортирует button, но не объявляет) — догружаем по импортам */
  const tried = new Set<string>()
  for (let pass = 0; pass < 4; pass++) {
    const all = collect(false)
    const missing = new Set<string>()
    for (const f of all)
      for (const m of f.content.matchAll(IMPORT_RE)) {
        const spec = m[3]
        if (
          (spec.startsWith('@/') || spec.startsWith('~/')) &&
          !resolveSpec(spec, f, all) &&
          !/(^|\/)utils$/.test(spec)
        )
          missing.add(spec.split('/').pop()!)
      }
    let more = false
    for (const n of missing) {
      if (tried.has(n)) continue
      tried.add(n)
      try {
        const before = seen.size
        await visit(n, 1)
        more ||= seen.size > before
      } catch {
        /* такого элемента в реестре нет — останется заметка при раскладке */
      }
    }
    if (!more) break
  }
  const files = collect(true)
  return { entry: (seen.values().next().value as RegItem).name, items: order, files, notes }
}

/* ------------------------------------------------------------------ раскладка по проекту */

export interface Layout {
  ui: string
  lib: string
  hooks: string
  comp: string
}
export const DEFAULT_LAYOUT: Layout = {
  ui: 'src/components/ui',
  lib: 'src/lib',
  hooks: 'src/hooks',
  comp: 'src/components',
}

/** Где в проекте лежат компоненты: рядом с уже существующими или в src/ */
export function detectLayout(files: Record<string, string>): Layout {
  const paths = Object.keys(files)
  const root =
    paths.some((p) => /^src\//.test(p)) || !paths.some((p) => /^(components|lib)\//.test(p)) ? 'src/' : ''
  const ui = paths.map((p) => p.match(/^(.*?components\/ui)\//)?.[1]).find(Boolean)
  const lib = paths.map((p) => p.match(/^(.*?lib)\/utils\.[tj]sx?$/)?.[1]).find(Boolean)
  const hooks = paths.map((p) => p.match(/^(.*?hooks)\//)?.[1]).find(Boolean)
  return {
    ui: ui || root + 'components/ui',
    lib: lib || root + 'lib',
    hooks: hooks || root + 'hooks',
    comp: ui ? ui.replace(/\/ui$/, '') : root + 'components',
  }
}

const noExt = (p: string) => p.replace(/\.(tsx?|jsx?|mjs|cjs)$/, '')
const base = (p: string) => p.split('/').pop() || p
const dir = (p: string) => p.split('/').slice(0, -1).join('/')

export function safeRel(p: string): boolean {
  return (
    !!p &&
    p.length < 220 &&
    !/\\|:|\0|(^|\/)\.\.(\/|$)/.test(p) &&
    !p.startsWith('/') &&
    !/(^|\/)\.git(\/|$)/.test(p)
  )
}

export const UTILS_TS = `import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
`

function destOf(f: BFile, l: Layout): string {
  if (f.target) {
    const t = f.target.replace(/^\/+/, '')
    if (!t.startsWith('~') && safeRel(t)) return t
  }
  const t = f.type
  if (t === 'registry:ui') return `${l.ui}/${base(f.path)}`
  if (t === 'registry:lib') return `${l.lib}/${base(f.path)}`
  if (t === 'registry:hook') return `${l.hooks}/${base(f.path)}`
  const rest = f.path.replace(/^registry\/[^/]+\//, '').replace(/^(components|examples|blocks)\//, '')
  return `${l.comp}/${rest}`
}

const IMPORT_RE = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])([^"'\n]+)\2/g

const join = (from: string, spec: string) => {
  const out = from ? from.split('/') : []
  for (const s of spec.split('/')) {
    if (s === '..') out.pop()
    else if (s !== '.' && s !== '') out.push(s)
  }
  return out.join('/')
}

const EXT = ['', '.tsx', '.ts', '.jsx', '.js', '/index.tsx', '/index.ts', '/index.jsx', '/index.js']

/** К какому файлу набора ведёт import. 'utils' — общий помощник cn */
export function resolveSpec(spec: string, from: BFile, files: BFile[]): BFile | 'utils' | null {
  if (spec === 'cn') return 'utils'
  const by = (p: string) => files.find((f) => EXT.some((e) => f.path === p + e || noExt(f.path) === p))
  if (spec.startsWith('.')) return by(join(dir(from.path), spec)) || null
  if (spec.startsWith('@/') || spec.startsWith('~/')) {
    const segs = spec.slice(2).split('/')
    for (let k = 0; k < segs.length; k++) {
      const tail = segs.slice(k).join('/')
      const hit = files.find((f) => noExt(f.path) === tail || noExt(f.path).endsWith('/' + tail))
      if (hit) return hit
    }
    if (/(^|\/)utils$/.test(spec)) return 'utils'
  }
  return null
}

const rootPkg = (s: string) => (s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0])
const SKIP_PKG = new Set(['react', 'react-dom', 'cn'])
const NODE = new Set(['fs', 'path', 'url', 'crypto', 'util', 'os', 'child_process'])

export interface Materialized {
  /** путь в проекте → содержимое */
  files: Record<string, string>
  /** файлы набора, которые уже есть в проекте и совпадают с тем, что мы бы записали */
  same: string[]
  /** файл с cn, который будет использован (существующий или новый) */
  utils: string
  entry: string
  deps: Record<string, string>
  dev: Record<string, string>
  css: string
  notes: string[]
}

export function cssText(items: RegItem[]): string {
  const rules = (o: Record<string, unknown>, ind = ''): string =>
    Object.entries(o)
      .map(([k, v]) =>
        typeof v === 'string'
          ? k.startsWith('@')
            ? `${ind}${k} ${v};\n`
            : `${ind}${k}: ${v};\n`
          : `${ind}${k} {\n${rules(v as Record<string, unknown>, ind + '  ')}${ind}}\n`,
      )
      .join('')
  const vars = (o: Record<string, string>) =>
    Object.entries(o)
      .map(([k, v]) => `  ${k.startsWith('--') ? k : '--' + k}: ${v};\n`)
      .join('')
  const seen = new Set<string>()
  let out = ''
  for (const it of items) {
    let b = ''
    if (it.cssVars?.theme && Object.keys(it.cssVars.theme).length)
      b += `@theme inline {\n${vars(it.cssVars.theme)}}\n`
    if (it.cssVars?.light && Object.keys(it.cssVars.light).length)
      b += `:root {\n${vars(it.cssVars.light)}}\n`
    if (it.cssVars?.dark && Object.keys(it.cssVars.dark).length) b += `.dark {\n${vars(it.cssVars.dark)}}\n`
    if (it.css && typeof it.css === 'object') b += rules(it.css as Record<string, unknown>)
    if (b && !seen.has(b)) {
      seen.add(b)
      out += b
    }
  }
  return out
}

/** Набор → файлы проекта: куда класть, как поправить импорты (в относительные), какие npm-пакеты нужны */
export function materialize(
  b: Bundle,
  layout: Layout = DEFAULT_LAYOUT,
  existing: Record<string, string> = {},
  entryFile?: string,
): Materialized {
  const notes = [...b.notes]
  const files = [...b.files]
  const exUtils = Object.keys(existing).find((p) =>
    new RegExp('^' + layout.lib + '/utils\\.[tj]sx?$').test(p),
  )
  const utilsDest = exUtils || `${layout.lib}/utils.ts`
  const hasOwnUtils = files.some(
    (f) =>
      /(^|\/)lib\/utils\.[tj]sx?$/.test(f.path) ||
      (/(^|\/)utils\.[tj]sx?$/.test(f.path) && f.type === 'registry:lib'),
  )
  let needUtils = false
  const dest = new Map<BFile, string>()
  for (const f of files) dest.set(f, destOf(f, layout))
  const rel = (from: string, to: string) => {
    const a = dir(from).split('/').filter(Boolean)
    const t = noExt(to).split('/')
    let i = 0
    while (i < a.length && i < t.length - 1 && a[i] === t[i]) i++
    const up = a.length - i
    return (up ? '../'.repeat(up) : './') + t.slice(i).join('/')
  }
  const out: Record<string, string> = {}
  const deps: Record<string, string> = {}
  const dev: Record<string, string> = {}
  const addDep = (list: string[] | undefined, to: Record<string, string>) => {
    for (const d of list || []) {
      const m = d.match(/^(@?[^@]+)(?:@(.+))?$/)
      if (!m || SKIP_PKG.has(m[1])) continue
      if (!to[m[1]] || to[m[1]] === 'latest') to[m[1]] = m[2] || 'latest'
    }
  }
  for (const it of b.items) {
    addDep(it.dependencies, deps)
    addDep(it.devDependencies, dev)
  }
  for (const f of files) {
    const from = dest.get(f)!
    const text = f.content.replace(IMPORT_RE, (all, pre: string, q: string, spec: string) => {
      const r = resolveSpec(spec, f, files)
      if (r === 'utils' && !hasOwnUtils) {
        needUtils = true
        return `${pre}${q}${rel(from, utilsDest)}${q}`
      }
      if (r && r !== 'utils') return `${pre}${q}${rel(from, dest.get(r)!)}${q}`
      if (r === 'utils') {
        const u = files.find((x) => /(^|\/)utils\.[tj]sx?$/.test(x.path))
        if (u) return `${pre}${q}${rel(from, dest.get(u)!)}${q}`
      }
      if (!spec.startsWith('.') && !spec.startsWith('@/') && !spec.startsWith('~/') && !NODE.has(spec)) {
        const pkg = rootPkg(spec)
        if (!SKIP_PKG.has(pkg) && !(pkg in deps)) deps[pkg] = 'latest'
      } else if (spec.startsWith('@/') || spec.startsWith('~/'))
        notes.push(`В «${base(f.path)}» импорт ${spec} не найден в наборе — поправьте путь вручную`)
      return all
    })
    out[from] = text
  }
  if (needUtils) {
    deps.clsx ||= 'latest'
    deps['tailwind-merge'] ||= 'latest'
    if (!exUtils) out[utilsDest] = UTILS_TS
  }
  const same = Object.keys(out).filter((p) => existing[p] === out[p])
  const entryItem = b.items.find((i) => i.name === b.entry)
  const ef =
    entryFile ||
    (entryItem?.files || [])
      .map((f) => files.find((x) => x.path === f.path))
      .find((f): f is BFile => !!f && /\.(tsx|jsx|ts|js)$/.test(f.path))?.path
  const entry = ef ? dest.get(files.find((f) => f.path === ef)!) || '' : ''
  return {
    files: out,
    same,
    utils: utilsDest,
    entry,
    deps,
    dev,
    css: cssText(b.items),
    notes: [...new Set(notes)],
  }
}

/* ------------------------------------------------------------------ package.json и стили проекта */

/** Добавляет недостающие зависимости в package.json (версию берём как «^последняя» через getVersion, иначе «latest») */
export async function addDeps(
  pkgText: string,
  deps: Record<string, string>,
  dev: Record<string, string>,
  getVersion: (name: string) => Promise<string | null>,
): Promise<{ text: string; added: string[]; error?: string }> {
  let j: Record<string, Record<string, string>>
  try {
    j = JSON.parse(pkgText)
  } catch {
    return { text: pkgText, added: [], error: 'package.json повреждён' }
  }
  const have = { ...(j.dependencies || {}), ...(j.devDependencies || {}) }
  const added: string[] = []
  const put = async (key: 'dependencies' | 'devDependencies', m: Record<string, string>) => {
    for (const [n, r] of Object.entries(m)) {
      if (n in have) continue
      const v = r !== 'latest' ? r : ((await getVersion(n).catch(() => null)) ?? 'latest')
      j[key] = { ...(j[key] || {}), [n]: v }
      added.push(n)
    }
    if (j[key]) j[key] = Object.fromEntries(Object.entries(j[key]).sort(([a], [b]) => a.localeCompare(b)))
  }
  await put('dependencies', deps)
  await put('devDependencies', dev)
  return { text: JSON.stringify(j, null, 2) + '\n', added }
}

export async function npmLatest(name: string): Promise<string | null> {
  if (!/^(@[\w.-]+\/)?[\w.-]+$/.test(name)) return null
  const r = await backendFetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}/latest`, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  })
  if (!r.ok) return null
  const v = ((await r.json()) as { version?: string }).version
  return v ? '^' + v : null
}

/** Дописывает стили компонента в глобальный CSS проекта (с Tailwind) один раз; без такого файла — null */
export function mergeCss(
  files: Record<string, string>,
  name: string,
  css: string,
): { path: string; text: string } | null {
  if (!css.trim()) return null
  const path = Object.keys(files)
    .filter((p) => /\.css$/.test(p) && /@import\s+["']tailwindcss|@tailwind\s/.test(files[p]))
    .sort((a, b) => a.length - b.length)[0]
  if (!path) return null
  const mark = `/* tetra:ui ${name} */`
  if (files[path].includes(mark)) return { path, text: files[path] }
  return { path, text: files[path].replace(/\s*$/, '\n') + `\n${mark}\n${css}` }
}
