> HISTORICAL RESTORED REPORT: exact original report text replayed after environment rollback. Old referenced logs/SHA inventory did NOT survive. CURRENT evidence and limitations: sync-rollback-restoration.md; new owned50/50 PASS, independent re-acceptance pending.

# A04 final scoped handoff — durable age AND live-runtime guard

**Stable: owned production/test files stopped for independent acceptance.** Final author run **50/50 PASS**, owned ESLint 0 / TypeScript diagnostics 0. Global formatter/check/build/browser/push not run. No changes to persistence/index/backend/server/types/package by this owner.

This report supersedes the earlier generation-only handoff. The independent reviewer correctly found that durable snapshot age alone did not authorize overwriting a fresh post-hydration human edit.

## A04 change

The persistence owner supplied separate `capturePersistenceRuntimeRevision(): number`:
- Increments for core slice/public-store mutations after successful hydration, including pre-publication subscriber ordering.
- Starts/resets at successful hydration.
- Does NOT increment for plain PersistStorage.setItem, migration auto-write or explicit flush.
- Kept separate from exact `{current, hydrated}` generation pair.

**Fresh recovered journal decision now requires BOTH proofs:**

1. The actual hydrated durable envelope predates journal.local's `appRevision`.
2. No core runtime mutation has happened since hydration (`runtimeRevision === 0`).

Only then is automatic scoped journal replay allowed. A later/equal durable envelope is kept. When age is unknown, runtime API is missing, or runtime edits already exist, replay is fail-closed instead of whole-project/file replacement.

The blocked branch:
- leaves live file/metadata values intact;
- saves journal desired/prior into a visible unique recovery JSON file in the project;
- shows a warning/error;
- sends **0 PUT/batch** and does not advance clean baseline;
- persists `recoveryBlocked` **without changing the old journal generation**. Thus a second cached retry (or later reload of the same blocked journal) cannot bypass the guard merely because load.recovered becomes false. It remains manual recovery.

This deliberately errs on preserving both intents. Unrelated core runtime changes can conservatively block an old journal too; no attempt to guess which change was user intent using equal text/hashes.

## New actual fresh-process desired tests

Both cloud and disk:
1. Actual root PersistStorage.setItem + flush commits `sent` and captures its real envelope revision.
2. External write accepted; local undo becomes `base`; app checkpoint rejects, leaving newer journal.local undo.
3. Fresh child process hydrates the old app snapshot.
4. A **real store action after hydration, before first sync** writes `human fresh` (and cloud desc `human fresh description`).
5. Two sync attempts preserve human live values, keep server/disk `sent`, send 0 external writes, emit warning, and retain desired undo `base` in visible JSON recovery.

Not a hardcoded counter/value-only fixture. App generation and runtime reservation originate from actual root storage/actions. Transport and snapshot/restart environment remain controlled in-memory test models, not Windows/real network/power-loss E2E.

## Regression matrix retained

- Original ST06–09/ST11/ST18/D07 safety tests.
- Successful PUT/batch undo and restore-during-remove.
- Genuine old checkpoint + newer undo recovery (fresh process).
- Later **actual durable redo** equal to journal.prior outranks old journal.local (cloud file/desc, disk file).
- Unknown/legacy journal generation preserves live + desired artifact, 0 outgoing.
- A01 uncertain first creation does not resurrect; CAS-conflict retry retains dirty delete and preserves newer foreign text.
- A02 uncertain mkdir undo, another simultaneous local directory edit, rmdir restore, directory-only PUT and actual debounce watcher.

## Final artifacts

- `sync-runtime-tests.log`: **50/50 PASS**, final bytes.
- `sync-runtime-lint.log`: scoped eslint, 0.
- `sync-runtime-typecheck.log`: only 10 owned-file diagnostics, 0 (not global typecheck).
- `sync-runtime-sha256.txt`: final owned SHA inventory.
- `sync-test-files.txt` / `sync-generation-test-files.txt` / shared `test-files.txt`: same 4 test entries, no new package registration needed after syncJournal.test.ts registration.
- `syncRestart.fixture.ts` remains a child helper, not an additional test entry.

Earlier `sync-generation-fixes.md` documents A01/A02/A03 fixes and negative ABA proof. Earlier reports/logs are historical; do not use their interim open status or pass count as final current status.

## Honest retained limits

- Fail-closed journals require explicit review/recovery; this scope does not add a general resolution UI. Both intents are visible/exportable as project JSON rather than guessed/LWW. Some background sync can remain stopped after an unrelated runtime mutation; do not market this as transparent CRDT convergence.
- This is still not one atomic transaction spanning app state, journal, baseline and external IO, nor a certified exactly-once outbox for arbitrary crashes/multiple writers. Fully failed durable backends cannot persist new intent.
- Runtime zero / hydrated provenance are root-store API contracts. No cross-window/process locks/CAS, simultaneous hydration support or native WebView/power-loss/fsync testing was added.
- External OS writers can race the server's in-process hash/CAS check. Text/FNV recovery is not raw-byte/non-UTF8 backup or cryptographic CAS.
- Quotas may stop preparation/checkpoint; missing/ambiguous generation fails closed. Chat wire remains 80 for newly joining devices; existing local history is preserved. Metadata copies require review.

**Status:** author scoped tests for A01–A04 are green with durable ABA and genuine-old cases retained. Independent reviewer final acceptance is pending its stable snapshot + desired/regression run; this author does not self-declare that independent result.
