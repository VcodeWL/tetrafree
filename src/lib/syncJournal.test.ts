import test from 'node:test'
import assert from 'node:assert/strict'
import { createSyncJournal, undoAncestor } from './syncJournal'
const values = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  },
})
test('ack journal survives fresh instance independently of app checkpoint and clears with a durable tombstone', async () => {
  const journal = createSyncJournal<{ files: { note: string } }, { note: string }>(),
    key = 'journal-unit'
  await journal.load(key)
  await journal.save(key, {
    phase: 'prepared',
    scope: 'test',
    ack: { files: { note: 'base' } },
    prior: { note: 'sent' },
    local: { note: 'sent' },
  })
  await journal.save(key, {
    phase: 'accepted',
    scope: 'test',
    ack: { files: { note: 'sent' } },
    prior: { note: 'sent' },
    local: { note: 'base' },
  })
  const fresh = createSyncJournal<{ files: { note: string } }, { note: string }>(),
    restored = await fresh.load(key)
  assert.equal(restored.recovered, true)
  assert.equal(restored.intent!.ack.files.note, 'sent')
  assert.equal(restored.intent!.local.note, 'base')
  await fresh.save(key, null)
  assert.equal((await createSyncJournal().load(key)).intent, null)
})
test('uncertain-request ancestor distinguishes undo from unchanged, without classifying unsent newer values clean', () => {
  assert.deepEqual(
    undoAncestor(
      { desc: 'base', other: 'old' },
      { desc: 'sent', other: 'old' },
      { desc: 'base', other: 'newer' },
    ),
    { desc: 'sent', other: 'old' },
  )
})

test('directory membership tracks both uncertain mkdir undo and rmdir restore independently', async () => {
  const { mergeDirs } = await import('./syncJournal')
  assert.deepEqual(mergeDirs(['new-local'], ['empty'], [], ['empty']), ['new-local'])
  assert.deepEqual(mergeDirs(['restored'], [], ['restored'], []), ['restored'])
})

test('missing checkpoint generation never permits value-based replay', async () => {
  const { journalReplayPolicy } = await import('./syncJournal')
  assert.equal(journalReplayPolicy({}), 'ambiguous')
})
