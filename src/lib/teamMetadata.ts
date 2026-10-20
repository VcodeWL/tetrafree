import type { Actor, Project, TeamEntry, DeployRun, LineComment } from '../types'

export interface TeamMeta {
  desc: string
  icon: Project['icon']
  template: string
  tools: string[]
  docs: Project['docs']
  tasks: Project['tasks']
  taskSeq: number
  memory: Project['memory']
  chats: Project['chats']
  history?: TeamEntry[]
  deploy?: { auto: boolean; runs: DeployRun[] }
  comments?: LineComment[]
  tomb?: Record<string, number>
}

/** Only schema-declared person IDs travel. Names, prose, filenames and agent names do not. */
export function convertMetaIds(meta: TeamMeta, uid: string, direction: 'to' | 'from'): TeamMeta {
  const id = (v: string) => (v === (direction === 'to' ? 'me' : uid) ? (direction === 'to' ? uid : 'me') : v)
  const actor = (a: Actor | null): Actor | null => (a?.kind === 'human' ? { ...a, id: id(a.id) } : a)
  return {
    ...meta,
    docs: (meta.docs || []).map((d) => ({ ...d, createdBy: id(d.createdBy) })),
    tasks: (meta.tasks || []).map((t) => ({
      ...t,
      assignee: actor(t.assignee),
      ...(t.comments ? { comments: t.comments.map((c) => ({ ...c, by: id(c.by) })) } : {}),
    })),
    chats: (meta.chats || []).map((c) => ({
      ...c,
      creator: actor(c.creator)!,
      messages: c.messages.map((m) => (m.kind === 'human' ? { ...m, author: id(m.author) } : m)),
    })),
    ...(meta.comments ? { comments: meta.comments.map((c) => ({ ...c, by: id(c.by) })) } : {}),
    // Memory.by and Version.author are display names, not person IDs.
  }
}

const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x)
export const canonical = (v: unknown): string =>
  JSON.stringify(v, (_k, x) =>
    object(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x,
  ) ?? 'undefined'
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b)
const idArray = (xs: unknown[]): xs is { id: string }[] =>
  xs.every((x) => object(x) && typeof x.id === 'string')

interface Merged {
  value: unknown
  conflict: boolean
}
/** Three-way structural merge. Undefined ancestor means unknown, never inferred from current state. */
export function mergeValue(local: unknown, remote: unknown, base: unknown, field = ''): Merged {
  if (field === 'updatedAt' || field === 'lastAt' || field === 'at')
    return { value: Math.max(Number(local) || 0, Number(remote) || 0), conflict: false }
  if (field === 'running') return { value: local ?? false, conflict: false }
  if (equal(local, remote)) return { value: local, conflict: false }
  if (field === 'messages' && Array.isArray(local) && Array.isArray(remote)) {
    return mergeArray(local, remote, Array.isArray(base) ? base : undefined, true)
  }
  // A chat is a windowed collection, including when its other fields match the ancestor.
  const windowed =
    object(local) && object(remote) && Array.isArray(local.messages) && Array.isArray(remote.messages)
  if (base !== undefined && !windowed) {
    if (equal(local, base)) return { value: remote, conflict: false }
    if (equal(remote, base)) return { value: local, conflict: false }
  }
  if (local === undefined && base === undefined) return { value: remote, conflict: false }
  if (remote === undefined && base === undefined) return { value: local, conflict: false }
  if (object(local) && object(remote) && (object(base) || base === undefined)) {
    const value: Record<string, unknown> = Object.create(null)
    let conflict = false
    for (const key of new Set([...Object.keys(local), ...Object.keys(remote), ...Object.keys(base || {})])) {
      const m = mergeValue(local[key], remote[key], object(base) ? base[key] : undefined, key)
      if (m.value !== undefined) value[key] = m.value
      conflict ||= m.conflict
    }
    return { value, conflict }
  }
  if (
    Array.isArray(local) &&
    Array.isArray(remote) &&
    idArray(local) &&
    idArray(remote) &&
    (base === undefined || (Array.isArray(base) && idArray(base)))
  ) {
    return mergeArray(local, remote, base as unknown[] | undefined)
  }
  return { value: local, conflict: true }
}
function mergeArray(local: unknown[], remote: unknown[], base?: unknown[], window = false): Merged {
  if (!idArray(local) || !idArray(remote) || (base && !idArray(base))) return { value: local, conflict: true }
  const lm = new Map(local.map((x) => [x.id, x])),
    rm = new Map(remote.map((x) => [x.id, x]))
  const bm = new Map((base as { id: string }[] | undefined)?.map((x) => [x.id, x]))
  const value: unknown[] = []
  let conflict = false
  // Local order is retained. Concurrent incompatible reorder is flagged, not silently discarded.
  const common = (xs: { id: string }[]) => xs.filter((x) => lm.has(x.id) && rm.has(x.id)).map((x) => x.id)
  const lo = common(local),
    ro = common(remote),
    bo = common((base || []) as { id: string }[])
  const insertions = (primary: string[], other: string[]) => {
    const order = [...primary]
    for (let i = 0; i < other.length; i++) {
      if (order.includes(other[i])) continue
      const following = other.slice(i + 1).find((id) => order.includes(id))
      if (following) order.splice(order.indexOf(following), 0, other[i])
      else order.push(other[i])
    }
    return order
  }
  let order = insertions([...lm.keys()], [...rm.keys()])
  if (!window && !equal(lo, ro)) {
    if (base && equal(lo, bo)) order = insertions([...rm.keys()], [...lm.keys()])
    else if (!base || !equal(ro, bo)) conflict = true
  }
  for (const id of new Set([...order, ...bm.keys()])) {
    const l = lm.get(id),
      r = rm.get(id)
    const m = window && (!l || !r) ? { value: l || r, conflict: false } : mergeValue(l, r, bm.get(id))
    if (m.value !== undefined) value.push(m.value)
    conflict ||= m.conflict
  }
  return { value, conflict }
}
const hash = (s: string) => {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(36)
}

/** Conflicting records remain visible as explicit copies; stamps never select entire records. */
export function mergeRecords<T extends { id: string }>(
  local: T[],
  remote: T[],
  base: T[] | undefined,
  tomb: Record<string, number>,
  stamp: (x: T) => number,
): { records: T[]; conflicts: number } {
  const lm = new Map(local.map((x) => [x.id, x])),
    rm = new Map(remote.map((x) => [x.id, x]))
  const bm = new Map(base?.map((x) => [x.id, x]))
  const records: T[] = [],
    copies: T[] = []
  const occupied = new Map([...lm, ...rm])
  let conflicts = 0
  const copy = (source: T) => {
    const raw = canonical(source)
    const stem = `${source.id}-conflict-${hash(raw)}`
    let id = stem,
      n = 2
    const candidate = (key: string) =>
      ({
        ...source,
        id: key,
        ...('title' in source ? { title: `${String(source.title)} (конфликт облака)` } : {}),
        ...('text' in source ? { text: `${String(source.text)}\n[Конфликт облака: сохранённая копия]` } : {}),
        ...('running' in source ? { running: false } : {}),
        // A copied document must not mirror over the original document's Markdown file.
        ...('blocks' in source ? { file: undefined } : {}),
      }) as T
    while (occupied.has(id)) {
      const previous = occupied.get(id),
        proposed = candidate(id)
      const comparable = (x: T) => {
        if (!('subtasks' in x || 'assignee' in x)) return x
        // Task key/updatedAt may be changed by duplicate-number repair after creating the copy.
        const { key: _key, updatedAt: _stamp, ...rest } = x as T & { key?: number; updatedAt?: number }
        return rest
      }
      if (previous && equal(comparable(previous), comparable(proposed))) return
      id = `${stem}-${n++}`
    }
    const c = candidate(id)
    occupied.set(id, c)
    copies.push(c)
  }
  for (const id of new Set([...lm.keys(), ...rm.keys()])) {
    const l = lm.get(id),
      r = rm.get(id),
      b = bm.get(id)
    const live = (x: T | undefined) => x && !(tomb[id] > stamp(x))
    if ((l && !live(l)) || (r && !live(r))) {
      // Delete vs edit is not resolved using wall-clock alone.
      for (const x of [l, r])
        if (x && (!b || !equal(x, b))) {
          copy(x)
          conflicts++
        }
      if (!live(l) && !live(r)) continue
    }
    const left = live(l) ? l : undefined,
      right = live(r) ? r : undefined
    // Top-level absence is only an explicit tombstone, not an old client's incomplete payload.
    if (!left || !right) {
      if (left || right) records.push((left || right)!)
      continue
    }
    const m = mergeValue(left, right, b)
    records.push(m.value as T)
    if (m.conflict) {
      copy(right)
      // Structural merge may select a remote field while conflicting elsewhere: retain local too.
      if (!equal(m.value, left)) copy(left)
      conflicts++
    }
  }
  return { records: [...records, ...copies], conflicts }
}
