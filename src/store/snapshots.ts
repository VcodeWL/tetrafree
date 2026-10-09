/* Версии проекта хранят полный снимок файлов. В localStorage (лимит ~5 МБ) это означало: проект на 400 КБ и 12 версий —
   и хранилище переполнено, потому что каждый файл записывался в каждую версию заново.
   При записи снимок заменяется на разницу с предыдущей версией, при чтении собирается обратно. В памяти ничего не меняется. */
import type { Version } from '../types'

export interface Delta {
  set: Record<string, string>
  del: string[]
}
export type PackedVersion = Omit<Version, 'snapshot'> & { snapshot?: Record<string, string>; delta?: Delta }

export function packVersions(vs: Version[]): PackedVersion[] {
  let prev: Record<string, string> | null = null
  return vs.map((v) => {
    const cur: Record<string, string> = v.snapshot || {}
    if (!prev) {
      prev = cur
      return v
    }
    const set: Record<string, string> = {}
    const del: string[] = []
    for (const k of Object.keys(cur)) if (prev[k] !== cur[k]) set[k] = cur[k]
    for (const k of Object.keys(prev)) if (!(k in cur)) del.push(k)
    prev = cur
    const { snapshot: _s, ...rest } = v
    void _s
    return { ...rest, delta: { set, del } }
  })
}

export function unpackVersions(vs: PackedVersion[]): Version[] {
  let prev: Record<string, string> = {}
  return vs.map((v) => {
    if (!v.delta) {
      prev = v.snapshot || {}
      return { ...v, snapshot: prev } as Version
    }
    const cur = { ...prev, ...v.delta.set }
    for (const k of v.delta.del) delete cur[k]
    prev = cur
    const { delta: _d, ...rest } = v
    void _d
    return { ...rest, snapshot: cur } as Version
  })
}
