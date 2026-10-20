/** Metadata only. Never store an API key, bearer token, or a token-derived identifier here. */
export const VAULT_OUTBOX_KEY = 'tf-vault-delete-outbox:1'
export type VaultDelete = {
  scope: string
  id: string
  generation: number
  pending: boolean
  replacementRevision?: number
}
type Journal = { version: 1; generation: number; entries: VaultDelete[] }
const fail = () =>
  new Error(
    'Не удалось сохранить намерение удалить ключ. Изменение отменено. Проверь доступ к хранилищу устройства.',
  )
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 8192
export function readVaultOutbox(storage: Pick<Storage, 'getItem'> = localStorage): Journal {
  let raw: string | null
  try {
    raw = storage.getItem(VAULT_OUTBOX_KEY)
  } catch {
    throw fail()
  }
  if (raw === null) return { version: 1, generation: 0, entries: [] }
  let j: Journal
  try {
    j = JSON.parse(raw)
  } catch {
    throw fail()
  }
  if (
    !j ||
    j.version !== 1 ||
    !Number.isSafeInteger(j.generation) ||
    j.generation < 0 ||
    !Array.isArray(j.entries) ||
    j.entries.length > 10000
  )
    throw fail()
  const seen = new Set<string>()
  for (const e of j.entries) {
    if (
      !e ||
      !text(e.scope) ||
      !text(e.id) ||
      !Number.isSafeInteger(e.generation) ||
      e.generation <= 0 ||
      e.generation > j.generation ||
      typeof e.pending !== 'boolean' ||
      (e.replacementRevision !== undefined &&
        (!Number.isSafeInteger(e.replacementRevision) || e.replacementRevision < 0))
    )
      throw fail()
    const key = JSON.stringify([e.scope, e.id])
    if (seen.has(key)) throw fail()
    seen.add(key)
  }
  return {
    version: 1,
    generation: j.generation,
    entries: j.entries.map((e) => ({
      scope: e.scope,
      id: e.id,
      generation: e.generation,
      pending: e.pending,
      ...(e.replacementRevision === undefined ? {} : { replacementRevision: e.replacementRevision }),
    })),
  }
}
function commit(j: Journal, storage: Pick<Storage, 'getItem' | 'setItem'>) {
  const raw = JSON.stringify(j)
  try {
    storage.setItem(VAULT_OUTBOX_KEY, raw)
    if (storage.getItem(VAULT_OUTBOX_KEY) !== raw) throw fail()
  } catch {
    throw fail()
  }
}
export function enqueueVaultDelete(
  scope: string,
  id: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
  floor = 0,
) {
  if (!text(scope) || !text(id) || !Number.isSafeInteger(floor) || floor < 0) throw fail()
  const j = readVaultOutbox(storage)
  j.generation = Math.max(j.generation, floor)
  if (j.generation >= Number.MAX_SAFE_INTEGER) throw fail()
  const entry = { scope, id, generation: ++j.generation, pending: true }
  j.entries = j.entries.filter((e) => e.scope !== scope || e.id !== id)
  j.entries.push(entry)
  if (j.entries.length > 10000) throw fail()
  commit(j, storage)
  return entry.generation
}
/** ACK is a CAS. Deletion ACK retains the tombstone; replacement ACK may retire it. */
export function acknowledgeOutbox(
  scope: string,
  id: string,
  generation: number,
  replacement = false,
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
) {
  const j = readVaultOutbox(storage)
  const e = j.entries.find((e) => e.scope === scope && e.id === id)
  if (!e || e.generation !== generation) return false
  if (replacement) j.entries = j.entries.filter((x) => x !== e)
  else {
    e.pending = false
    delete e.replacementRevision
  }
  commit(j, storage)
  return true
}

/** Prove a replacement has an actual app checkpoint before a crash may supersede deletion. */
export function prepareOutboxReplacement(
  scope: string,
  id: string,
  generation: number,
  revision: number,
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
) {
  if (!Number.isSafeInteger(revision) || revision < 0) throw fail()
  const j = readVaultOutbox(storage)
  const e = j.entries.find((e) => e.scope === scope && e.id === id)
  if (!e) return true
  if (e.generation !== generation) return false
  e.replacementRevision = revision
  commit(j, storage)
  return true
}
