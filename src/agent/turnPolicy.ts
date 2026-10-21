/* Pure review summary: derived from current cards, not from files/store/approvals.
   Reviewing existing cards and finishing a live turn have different state precedence;
   do not silently reuse one policy for the other. */
import type { Part, TurnChanges } from '../types'

export type FilePart = Extract<Part, { k: 'file' }>
export const tally = (files: FilePart[]) => ({
  files: files.filter((f) => f.state !== 'error').length,
  add: files.reduce((a, f) => a + (f.state === 'error' ? 0 : f.add), 0),
  del: files.reduce((a, f) => a + (f.state === 'error' ? 0 : f.del), 0),
})

export function reviewedTurn(
  parts: readonly Part[],
  previousVersion?: number,
  version?: number,
): TurnChanges {
  const files = parts.filter((p): p is FilePart => p.k === 'file')
  const live_ = files.filter((f) => f.state !== 'error')
  const proposed = live_.filter((f) => f.state === 'proposed'),
    done = live_.filter((f) => f.state === 'done'),
    rev = live_.filter((f) => f.state === 'reverted')
  const state: TurnChanges['state'] = proposed.length
    ? done.length
      ? 'partial'
      : 'proposed'
    : done.length
      ? 'applied'
      : rev.length
        ? 'reverted'
        : 'rejected'
  return {
    state,
    version: version ?? previousVersion,
    ...tally(files.filter((f) => f.state === 'done' || f.state === 'proposed')),
  }
}
