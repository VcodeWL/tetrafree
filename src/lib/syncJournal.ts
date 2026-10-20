import { idbGet, idbSet } from '../store/idb'
import { canonical } from './teamMetadata'
import * as persistence from '../store/persistence'

export interface SyncIntent<A, L> {
  phase: 'prepared' | 'accepted'
  /** Ordering watermark of the LOCAL full app snapshot, not the journal's KV revision. */
  appRevision?: number
  recoveryBlocked?: boolean
  scope: string
  /** Last known external state, NOT a declaration that current local is clean. */
  ack: A
  prior: L
  local: L
}
interface Envelope<T> {
  revision: number
  value: T | null
}
/** Independent write-ahead/ack journal. Clearing is revisioned too, so old IDB cannot resurrect an intent. */
export function createSyncJournal<A, L>() {
  const cache = new Map<string, Envelope<SyncIntent<A, L>>>()
  const markerKey = (key: string) => key + ':authority'
  return {
    async load(key: string): Promise<{ intent: SyncIntent<A, L> | null; recovered: boolean }> {
      const cached = cache.get(key)
      if (cached) return { intent: cached.value, recovered: false }
      let raw: string | undefined,
        failed = false
      try {
        raw = await idbGet<string>(key)
      } catch {
        failed = true
      }
      const fallback = localStorage.getItem(key)
      const marker = JSON.parse(localStorage.getItem(markerKey(key)) || 'null') as {
        revision: number
        backend: string
      } | null
      const disk = raw ? (JSON.parse(raw) as Envelope<SyncIntent<A, L>>) : null
      const ls = fallback ? (JSON.parse(fallback) as Envelope<SyncIntent<A, L>>) : null
      if (failed && marker && (marker.backend !== 'ls' || marker.revision !== ls?.revision))
        throw new Error('Ack journal недоступен; синхронизация остановлена для восстановления')
      const latest = !disk ? ls : !ls || disk.revision >= ls.revision ? disk : ls
      if (marker?.backend === 'pending' && (latest?.revision ?? 0) < marker.revision)
        throw new Error('Незавершённая запись ack journal; синхронизация остановлена')
      const entry = latest || { revision: 0, value: null }
      cache.set(key, entry)
      return { intent: entry.value, recovered: !!entry.value }
    },
    async save(key: string, value: SyncIntent<A, L> | null, preserveGeneration = false) {
      if (value && !preserveGeneration) value = { ...value, appRevision: persistenceGeneration()?.current }
      const before = cache.get(key)
      const envelope = { revision: (before?.revision || 0) + 1, value }
      // Keep an externally accepted state in memory even if every durable backend now rejects.
      cache.set(key, envelope)
      let idbCommitted = false
      const raw = JSON.stringify(envelope),
        authority = markerKey(key),
        oldMarker = localStorage.getItem(authority)
      localStorage.setItem(authority, JSON.stringify({ revision: envelope.revision, backend: 'pending' }))
      try {
        try {
          await idbSet(key, raw)
          idbCommitted = true
          localStorage.setItem(authority, JSON.stringify({ revision: envelope.revision, backend: 'idb' }))
          try {
            localStorage.removeItem(key)
          } catch {
            /* revisioned old fallback cannot win */
          }
        } catch {
          localStorage.setItem(key, raw)
          if (localStorage.getItem(key) !== raw) throw new Error('Ack journal не сохранён')
          localStorage.setItem(authority, JSON.stringify({ revision: envelope.revision, backend: 'ls' }))
        }
        cache.set(key, envelope)
      } catch (error) {
        // The external call must not start if preparation cannot be made durable.
        try {
          if (!idbCommitted) {
            if (oldMarker === null) localStorage.removeItem(authority)
            else localStorage.setItem(authority, oldMarker)
          }
        } catch {
          /* unreadable/ambiguous authority fails closed on next load */
        }
        throw error
      }
    },
  }
}

interface PersistenceGeneration {
  current: number
  hydrated: number
}
function persistenceGeneration(): PersistenceGeneration | undefined {
  const read = (persistence as { capturePersistenceGeneration?: () => PersistenceGeneration })
    .capturePersistenceGeneration
  if (!read) return undefined
  let value: PersistenceGeneration
  try {
    value = read()
  } catch {
    return undefined
  }
  return Number.isSafeInteger(value.current) && Number.isSafeInteger(value.hydrated) ? value : undefined
}
/** Only the loaded durable snapshot generation establishes replay age. Never infer age from bytes. */
export function journalReplayPolicy(
  intent: { appRevision?: number; recoveryBlocked?: boolean },
  recovered = true,
): 'replay' | 'current' | 'ambiguous' {
  if (intent.recoveryBlocked) return 'ambiguous'
  const generation = persistenceGeneration()
  if (!generation || !Number.isSafeInteger(intent.appRevision)) return 'ambiguous'
  if (generation.hydrated >= intent.appRevision!) return 'current'
  if (recovered) {
    const readRuntime = (persistence as { capturePersistenceRuntimeRevision?: () => number })
      .capturePersistenceRuntimeRevision
    let runtime: number | undefined
    try {
      runtime = readRuntime?.()
    } catch {
      /* fail closed below */
    }
    if (!Number.isSafeInteger(runtime) || runtime !== 0) return 'ambiguous'
  }
  return 'replay'
}

/** Directory membership is three-way; absence in an old checkpoint is unknown, so use union once. */
export const normalizeDirs = (dirs: string[]) =>
  [...new Set(dirs.map((d) => d.replace(/\\/g, '/').replace(/\/+$/, '')))].sort()
export function mergeDirs(
  local: string[],
  remote: string[],
  base?: string[],
  requestLocal?: string[],
): string[] {
  const l = new Set(normalizeDirs(local)),
    r = new Set(normalizeDirs(remote)),
    b = new Set(base && normalizeDirs(base)),
    before = new Set(requestLocal && normalizeDirs(requestLocal))
  return [...new Set([...l, ...r, ...b])]
    .filter((d) =>
      requestLocal && before.has(d) !== l.has(d)
        ? l.has(d)
        : base === undefined
          ? l.has(d) || r.has(d)
          : l.has(d) === b.has(d)
            ? r.has(d)
            : l.has(d),
    )
    .sort()
}

/** An uncertain request cannot make a local undo look unchanged against the old external ancestor. */
export function undoAncestor(base: unknown, sentLocal: unknown, current: unknown): unknown {
  const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b)
  if (equal(base, current) && !equal(sentLocal, current)) return sentLocal
  const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
  if (obj(base) && obj(sentLocal) && obj(current))
    return Object.fromEntries(
      [...new Set([...Object.keys(base), ...Object.keys(sentLocal), ...Object.keys(current)])].map((k) => [
        k,
        undoAncestor(base[k], sentLocal[k], current[k]),
      ]),
    )
  if (
    Array.isArray(base) &&
    Array.isArray(sentLocal) &&
    Array.isArray(current) &&
    [...base, ...sentLocal, ...current].every((x) => obj(x) && typeof x.id === 'string')
  ) {
    const b = new Map(base.map((x) => [x.id, x])),
      s = new Map(sentLocal.map((x) => [x.id, x])),
      c = new Map(current.map((x) => [x.id, x]))
    return [...new Set([...b.keys(), ...s.keys()])]
      .map((id) => undoAncestor(b.get(id), s.get(id), c.get(id)))
      .filter((x) => x !== undefined)
  }
  return base
}
