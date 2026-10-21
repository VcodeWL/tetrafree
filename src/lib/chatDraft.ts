/** Legacy keys remain byte-for-byte intact; new entries live in a disjoint namespace. */
export const draftKey = (pid: string, chatId: string) => 'draft:' + JSON.stringify([pid, chatId])

export interface ChatDraftState {
  projects: readonly { id: string; chats: readonly { id: string }[] }[]
  drafts: Record<string, string>
  projectId?: string | null
  screen?: string
  center?: { kind: string; id?: string }
}
const own = (record: Record<string, string>, key: string) => Object.prototype.hasOwnProperty.call(record, key)
export const hasDraftTarget = (s: ChatDraftState, pid: string | null | undefined, chatId: string) =>
  !!pid && !!s.projects.find((p) => p.id === pid)?.chats.some((c) => c.id === chatId)

/** Explicit pid only. A missing/deleted origin never falls back to the current project. */
export function readChatDraft(s: ChatDraftState, pid: string | null | undefined, chatId: string): string {
  if (!pid || !hasDraftTarget(s, pid, chatId)) return ''
  const key = draftKey(pid, chatId)
  if (own(s.drafts, key)) return s.drafts[key] // '' is an intentional clear, not a missing value.
  const owners = s.projects.filter((p) => p.chats.some((c) => c.id === chatId)).length
  return owners === 1 && own(s.drafts, chatId) ? s.drafts[chatId] : ''
}

export function isCurrentDraftTarget(s: ChatDraftState, pid: string | null | undefined, chatId: string) {
  return (
    !!pid &&
    s.projectId === pid &&
    s.screen === 'workspace' &&
    s.center?.kind === 'chat' &&
    s.center.id === chatId &&
    hasDraftTarget(s, pid, chatId)
  )
}

/** Only expose availability automatically, never ambiguous legacy contents in the composer. */
export function recoverableLegacyDraft(
  s: ChatDraftState,
  pid: string | null | undefined,
  chatId: string,
): string | undefined {
  if (!pid || !hasDraftTarget(s, pid, chatId) || !own(s.drafts, chatId) || !s.drafts[chatId]) return undefined
  const scoped = own(s.drafts, draftKey(pid, chatId))
  const ambiguous = s.projects.filter((p) => p.chats.some((c) => c.id === chatId)).length > 1
  return scoped || ambiguous ? s.drafts[chatId] : undefined
}

/** Called only by explicit recovery UI. Append, don't overwrite; don't consume the legacy source. */
export function copyLegacyDraftText(
  s: ChatDraftState,
  pid: string | null | undefined,
  chatId: string,
): string | undefined {
  if (!isCurrentDraftTarget(s, pid, chatId)) return undefined
  const legacy = recoverableLegacyDraft(s, pid, chatId)
  if (legacy === undefined) return undefined
  const current = readChatDraft(s, pid, chatId)
  return current ? current + '\n\n' + legacy : legacy
}
