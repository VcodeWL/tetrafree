/* Документы ⇄ файлы `docs/*.md`. Чистая логика: что записать в файлы и что поменять в документах.
   Для каждого документа помним, под каким файлом он лежит и какой хеш Markdown был «общим» в прошлый раз. */
import type { Block } from '../types'
import { docMd } from './docmd'
import { parseMd } from './mdimport'

export interface DocLite {
  id: string
  title: string
  blocks: Block[]
  file?: string
}
export type DocBase = Record<string, { file: string; h: string; d: string }>
export interface DocPlan {
  /** файлы к записи (путь → содержимое) */
  write: Record<string, string>
  /** файлы к удалению */
  remove: string[]
  /** документы, которые надо обновить из файла */
  update: { id: string; title: string; blocks: Block[] }[]
  /** новые документы из чужих .md */
  add: { title: string; blocks: Block[]; file: string }[]
  /** привязка документов к файлам */
  attach: Record<string, string>
  base: DocBase
}

export const DOCS_DIR = 'docs'
export const MAX_IMPORT = 20
export const MAX_BYTES = 400_000
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

export function slugName(title: string): string {
  let s = title
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, 60)
    .trim()
  if (!s) s = 'Без названия'
  if (RESERVED.test(s)) s = '_' + s
  return s
}
const isDocFile = (p: string) =>
  p.startsWith(DOCS_DIR + '/') && !p.slice(DOCS_DIR.length + 1).includes('/') && /\.md$/i.test(p)

function freePath(title: string, taken: Set<string>, suffix = ''): string {
  const base = `${DOCS_DIR}/${slugName(title)}${suffix}`
  let p = base + '.md'
  for (let i = 2; taken.has(p.toLowerCase()); i++) p = `${base} (${i}).md`
  taken.add(p.toLowerCase())
  return p
}

export function planDocs(
  allDocs: DocLite[],
  files: Record<string, string>,
  prev: DocBase,
  h: (s: string) => string,
  firstRun: boolean,
): DocPlan {
  /* документы с картинками не зеркалим: data:-URL удвоили бы хранилище, а из файла картинки не вернуть */
  const docs = allDocs.filter((d) => !d.blocks.some((b) => b.type === 'image'))
  const plan: DocPlan = { write: {}, remove: [], update: [], add: [], attach: {}, base: {} }
  const taken = new Set(Object.keys(files).map((k) => k.toLowerCase()))
  const owned = new Set<string>()
  const cur = { ...files }
  const put = (p: string, c: string) => {
    plan.write[p] = c
    cur[p] = c
  }
  for (const d of docs) {
    const want = docMd(d)
    const rec = prev[d.id]
    let file = d.file || rec?.file
    const here = file !== undefined ? cur[file] : undefined
    if (file === undefined || (here === undefined && !rec)) {
      file = freePath(d.title, taken)
      plan.attach[d.id] = file
      put(file, want)
      plan.base[d.id] = { file, h: h(want), d: h(want) }
      owned.add(file)
      continue
    }
    owned.add(file)
    if (d.file !== file) plan.attach[d.id] = file
    if (here === undefined) {
      /* файл пропал (удалили или откатили) — документ не теряем, возвращаем файл */
      put(file, want)
      plan.base[d.id] = { file, h: h(want), d: h(want) }
      continue
    }
    const fileChanged = !rec || h(here) !== rec.h
    const docChanged = !rec || h(want) !== rec.d
    if (!fileChanged || here === want) {
      if (docChanged && here !== want) put(file, want)
      plan.base[d.id] = { file, h: h(cur[file]), d: h(want) }
    } else if (!docChanged) {
      const parsed = parseMd(here, d.title)
      const title = parsed.title || d.title
      plan.update.push({ id: d.id, title, blocks: parsed.blocks })
      plan.base[d.id] = { file, h: h(here), d: h(docMd({ title, blocks: parsed.blocks })) }
    } else {
      /* правили и документ, и файл: документ главный, версия файла уходит в соседнюю копию */
      const copy = freePath(d.title, taken, ' (копия с диска)')
      put(copy, here)
      put(file, want)
      plan.base[d.id] = { file, h: h(want), d: h(want) }
    }
  }
  /* документы, удалённые в приложении: убираем их файл, если его не трогали */
  const live = new Set(docs.map((d) => d.id))
  for (const [id, r] of Object.entries(prev)) {
    if (live.has(id) || owned.has(r.file)) continue
    const c = cur[r.file]
    if (c !== undefined && h(c) === r.h) {
      plan.remove.push(r.file)
      delete cur[r.file]
    }
  }
  /* чужие .md в docs/ → новые документы */
  const orphans = Object.keys(cur)
    .filter((p) => isDocFile(p) && !owned.has(p) && cur[p].length <= MAX_BYTES)
    .sort()
  if (!(firstRun && orphans.length > MAX_IMPORT)) {
    for (const p of orphans) {
      const parsed = parseMd(cur[p], p.slice(DOCS_DIR.length + 1).replace(/\.md$/i, ''))
      plan.add.push({ title: parsed.title, blocks: parsed.blocks, file: p })
    }
  }
  return plan
}
