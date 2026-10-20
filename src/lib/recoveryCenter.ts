/* Recovery is an explicit copy operation, never a replay/overwrite of live state. */
import type { Project } from '../types'
import { agentPathError, checkPath } from './paths'

export type RecoveryKind = 'trash' | 'disk' | 'cloud' | 'journal' | 'agent'
export interface RecoveryEntry {
  id: string
  kind: RecoveryKind
  source: string
  at?: number
  text: string
}
export interface RecoveryVariant {
  id: string
  path: string
  text: string
  label: string
}
type Tree = Pick<Project, 'files' | 'dirs' | 'trash'>
const MAX_PARSE = 4_000_000
const MAX_VARIANTS = 500
const record = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)

export function recoveryEntries(p: Tree): RecoveryEntry[] {
  const out: RecoveryEntry[] = (p.trash || []).map((t) => ({
    id: `trash:${t.path}:${t.at}`,
    kind: 'trash',
    source: t.path,
    at: t.at,
    text: t.content,
  }))
  for (const [source, text] of Object.entries(p.files)) {
    const kind: RecoveryKind | undefined = source.startsWith('.tetra/recovery/')
      ? 'agent'
      : /\.journal-recovery\.json(?:\.\d+)?$/.test(source)
        ? 'journal'
        : /\.disk-conflict(?:\.\d+)?$/.test(source)
          ? 'disk'
          : /\.cloud(?:\.json)?(?:\.\d+)?$/.test(source)
            ? 'cloud'
            : undefined
    if (kind) out.push({ id: `file:${source}`, kind, source, text })
  }
  return out.sort((a, b) => (b.at || 0) - (a.at || 0) || a.source.localeCompare(b.source))
}

/** Do not interpret metadata, null (deletion) or unknown journal formats as executable mutations. */
export function recoveryVariants(e: RecoveryEntry): RecoveryVariant[] {
  if (e.kind === 'trash') return [{ id: 'text', path: e.source, text: e.text, label: 'Сохранённый текст' }]
  if (e.kind === 'disk' || (e.kind === 'cloud' && !/\.cloud\.json(?:\.\d+)?$/.test(e.source)))
    return [
      {
        id: 'text',
        path: e.source.replace(/\.(?:disk-conflict|cloud)(?:\.\d+)?$/, ''),
        text: e.text,
        label: e.kind === 'disk' ? 'Версия с диска' : 'Облачная версия',
      },
    ]
  if (e.text.length > MAX_PARSE) return []
  let j: unknown
  try {
    j = JSON.parse(e.text)
  } catch {
    return []
  }
  if (!record(j)) return []
  const out: RecoveryVariant[] = []
  const add = (files: unknown, prefix: string, label: string) => {
    if (!record(files)) return
    for (const [path, text] of Object.entries(files)) {
      if (out.length >= MAX_VARIANTS) break
      if (typeof text === 'string' && !agentPathError(path))
        out.push({ id: prefix + ':' + path, path, text, label })
    }
  }
  if (e.kind === 'agent') add(j.files, 'saved', 'Сохранённая версия')
  else if (e.kind === 'journal') {
    if (record(j.desired)) add(j.desired.files, 'desired', 'Локальное намерение')
    if (record(j.prior)) add(j.prior.files, 'prior', 'Предыдущая версия')
  }
  return out
}

/** Exact source check is repeated inside the same store publication as the write. */
export function restoreRecoveryCopy(p: Tree, shown: RecoveryEntry, chosen: RecoveryVariant): string {
  const fresh = recoveryEntries(p).find((e) => e.id === shown.id)
  if (!fresh || fresh.text !== shown.text)
    throw new Error('Источник восстановления изменился. Выбери его заново.')
  const variant = recoveryVariants(fresh).find((v) => v.id === chosen.id)
  if (!variant || variant.path !== chosen.path || variant.text !== chosen.text)
    throw new Error('Версия восстановления изменилась. Выбери её заново.')
  const invalid = agentPathError(variant.path)
  if (invalid) throw new Error(invalid)
  // Never re-enable automation/config by restoring to its original service path.
  const relative = variant.path.startsWith('.tetra/') ? variant.path.slice('.tetra/'.length) : variant.path
  const original = relative.length > 160 ? relative.split('/').pop()!.slice(-100) : relative
  let target = ''
  for (let n = 1; n <= 200; n++) {
    const candidate = `${n === 1 ? 'recovered' : 'recovered-' + n}/${original}`
    if (!checkPath(p, candidate)) {
      target = candidate
      break
    }
  }
  if (!target) throw new Error('Не удалось выбрать безопасный путь. Скачай исходную копию.')
  p.files[target] = variant.text
  const parts = target.split('/')
  for (let i = 1; i < parts.length; i++) {
    const dir = parts.slice(0, i).join('/')
    if (!p.dirs.some((d) => d.toLowerCase() === dir.toLowerCase())) p.dirs.push(dir)
  }
  // Original trash/recovery file remains available until the user explicitly cleans it up.
  return target
}
