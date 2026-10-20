# Durable vault delete outbox — owner handoff

## Status

**Implemented; owned production scope STOP.** Root `/data/tetrafree`, Node **v22.23.3** at `/data/fix-tetrafree/node22/node-v22.23.3-linux-x64/bin/node`. No git checkout is present; no commit/push performed. No package/version/lock/types/index/main/App/LLM/account changes by this owner. Parent owns confirmed account identity, Auth/Forms/startup/model gating integration.

Final desired regressions: **60/60 PASS**, including 21 new outbox/unit/integration cases and 39 prior persistence/vault cases (8 actual mutation-slice coverage subtests included). This is a fresh current run, not reused earlier acceptance or a characterization asserting a bug. Log: `vault-scoped-tests.log`. Exact eight owned source/fixture SHA before run: `vault-before.sha256`; all eight verified unchanged after tests: `vault-stability.log`.

Owned TypeScript diagnostics: **0**. Owned ESLint: **exit 0**. Scoped Prettier check: **exit 0**. Logs: `vault-typecheck.log`, `vault-eslint.log`, `vault-format.log`. Final command exits: tests=0, ESLint=0, format=0. No global check/build/formatter/browser/push was run.

## Owned changes

- `src/lib/vaultOutbox.ts` — independent version-1 localStorage journal, metadata only: backend/account scope, provider ID, monotonic generation, pending-delete flag, optional app-checkpoint revision for a replacement. No API secret, bearer, token hash, email or key-derived fingerprint is added to the journal. Validate versions/shapes/duplicates/bounds; reject unreadable/corrupt/future journal without deleting or overwriting its raw value. Readback detects silently dropped writes.
- `src/lib/vaultState.ts` — configure stable verified account resolver without vaultState → account → store dependency cycle. Durable scope is normalized backend URL plus stable account ID, not rotating session token. Token remains runtime stale-response cancellation context only. Monotonic intent generation handles empty → new → empty ABA. Newer durable intent supersedes an older runtime intent after token/account context reuse. Deletion ACK is CAS and leaves a sticky tombstone; replacement ACK may retire only the matching intent.
- `src/store/slices/settings.ts` — clear/remove records and verifies durable intent **before** modifying providers. Storage failure or unknown identity produces a Russian error toast and synchronous throw before mutation. Parent Forms must catch and not announce success/close. New nonempty key before login remains allowed in the existing fallback workflow; remote clear/remove without confirmed identity fails closed.
- `src/lib/vault.ts` — use parent's `confirmedAccountId()` proof. Reconcile stale hydrated app keys against matching tombstones and real `flushPersistence()` before GET/SET. A cleared key is not treated as a hydration placeholder even after DELETE ACK or process restart. Retry pending orphan-provider deletion; observing a remote key for an ACKed orphan tombstone also reissues deletion. Reject stale old-context ACK; same-context generation CAS protects ABA. Retry transient failures after 30 seconds, cancel obsolete/successful retry timers. Failed metadata ACK is not accepted as success. Corrupt metadata never counts as `isVaulted` or crashes its UI reader.
- `src/store/persistence-durable.test.ts` — existing desired assertions retained, vault fixtures now establish **actual verifySession auth/config + auth/me proof** rather than assigning a user or bearer and assuming identity.
- New tests: `src/lib/vaultOutbox.test.ts`, `src/lib/vaultOutbox.integration.test.ts`; fresh-process helper `src/lib/vaultOutbox.fixture.ts` is not a test entry.

## Crash ordering

1. Settings synchronously commits and verifies metadata intent; failure means no clear/remove and no successful action return.
2. In-memory clear/remove publishes normally and app persistence follows. Crash before this checkpoint is safe: boot gate must withhold model/workspace actions, establish confirmed account, then tombstone reconciliation overrides the old hydrated key and flushes actual current state.
3. Failed remote DELETE leaves pending intent durable. Fresh process retries without restoring or uploading the old key.
4. Successful DELETE must also commit metadata ACK. Failure leaves pending retry. ACK keeps the clear tombstone so a stale GET/old app snapshot cannot later recreate that secret.
5. Explicit replacement advances generation. Before SET it flushes the real app snapshot and records its checkpoint revision in metadata; on restart only a sufficiently new hydrated snapshot may supersede the clear. Remote SET plus matching durable metadata ACK are required before the key is treated as vaulted/stripped from fallback. Stale DELETE/SET ACK cannot retire a newer ABA intent.

**Conservative interrupted replacement boundary:** journal and application snapshot are separate storage records, not one atomic transaction. Crash before the replacement checkpoint proof is committed leaves deletion authoritative; an unacknowledged replacement may require re-entry. No secret is copied into metadata to bridge this gap. After proof is committed, the fresh-process failed-SET/reload test verifies the new key is retained and retried rather than cleared or replaced by the old server key.

## Startup/UI contract (parent integration)

Exports in `src/lib/vault.ts`:

```ts
prepareVaultRecovery(): Promise<void>
vaultStartupBlocked(): boolean
vaultRecoveryState(): { blocked: boolean; checking: boolean; error: string | null }
subscribeVaultRecovery(listener: () => void): () => void
```

`vaultRecoveryState` returns a stable snapshot suitable for `useSyncExternalStore`; no getter-driven state update loop. Backend/account changes update blocked state synchronously. Successful confirmed login automatically retries reconciliation; no remount/manual retry is required. Unknown/offline identity or corrupt/unreadable metadata preserves raw, rejects preparation, and keeps the gate blocked. A failed durable reconciliation remains blocked on repeated retries even if the in-memory key is already empty: emptiness is **not** a checkpoint proof. An unrelated backend's intents do not block this backend.

Required parent order: hydrate store → detect correct backend → await `prepareVaultRecovery()` → background writers and normal UI/model actions. On rejection keep recovery/export/sign-in available; do not allow Launcher/Workspace/model calls until unblocked. `setAccountRecoveryMode` must suppress sign-in-triggered sync while recovery is blocked. Parent reported this wiring in main/App/LLM and Forms catch/preimage guard; those files are outside this owner's acceptance.

## Fresh-process evidence / negative controls

Tests spawn independent Node processes with fresh module graphs, persistent file-backed localStorage, actual root hydration and **real registered `flushPersistence`** (not a no-op checkpoint). Processes exit without unload hooks. IndexedDB absence deliberately exercises the actual authority-marked localStorage fallback; the initial valid envelope is seeded explicitly, not by bypassing unsafe hydration. Remote responses are controlled test doubles, not a claim of real Windows/DPAPI/server integration.

- failed DELETE → abrupt exit → reload; repeated failure/reload; sticky tombstone after successful ACK;
- durable intent → exit before app clear checkpoint; old snapshot cannot overwrite clear during boot reconciliation;
- deleted provider absent from app snapshot is still deleted remotely, including ACKed sticky orphan observed again;
- token rotation same verified account resumes its own intent; different account/backend do not consume that intent;
- delayed GET + actual settings empty → new → empty and delayed DELETE + newer ABA;
- delayed old-account/backend DELETE ACK cannot acknowledge the old tombstone in the new context or clobber the new context key;
- quota/silently dropped metadata write, corrupt/future metadata raw, failed durable DELETE ACK;
- new nonempty anonymous fallback allowed, unknown identity clear rejected before state mutation;
- replacement app checkpoint + failed SET → fresh process preserves/retries new key;
- strict boot unknown identity blocks without modifying old durable app snapshot; failed checkpoint blocks through two retries; successful recovery releases only after durable clear; subsequent successful login **automatically** releases gate after that checkpoint;
- metadata payload contains neither fixture secret nor bearer token.

Test entry manifest: `/data/next-tetrafree/vault-test-files.txt`. Fixture list: `vault-test-fixtures.txt`. Parent must add both new test entries to package test; this owner did not edit package scripts.

## Remaining boundaries / new observations

- Browser localStorage API readback is the available logical durable checkpoint, **not an fsync/power-loss guarantee**. File-backed test storage and orderly process exit without unload are not hardware power-cut tests.
- Cross-window/profile concurrency is not a storage-level atomic CAS: read/modify/write localStorage can race between simultaneous windows. Generations/ACK CAS protect this runtime and reload; strict multiwindow arbitration needs a separate coordinator/Web Lock protocol.
- Stable proof is trusted through parent's `confirmedAccountId()`, verified against exact session/base/token/epoch. `user.id` or `checked` alone is insufficient; proof loss blocks clear until authentication is confirmed again.
- Local API secrets server is device/OS-user storage, not demonstrated server-enforced per-account secret isolation. This change scopes **client intent/replay/ACK authority**; it does not redesign the server vault tenancy.
- Sticky tombstones intentionally have no automatic expiry. Deleting browser storage, manually discarding metadata, importing older app data outside the gated startup path, or an unsupported future journal cannot be silently guessed/repaired; preserve/export and explicit recovery are required. The journal is bounded and fails closed when full.
- Actual Windows WebView2 localStorage, DPAPI, native quit/OS close, physical crash, installer and global release acceptance remain parent/Windows scope. No claim of those checks is made here.

## Final review addendum — token-only gateway edge

**Fixed and STOP again.** Only `src/lib/vault.ts`, `src/lib/vaultOutbox.fixture.ts`, and `src/lib/vaultOutbox.integration.test.ts` changed for this addendum. The previous 60-case run above remains historical; current scoped result is **61/61 PASS** (22 new + 39 existing).

Actual-source desired test first reproduced RED: after successful recovery, `setToken()` alone changed the runtime authority but did not emit account or recovery-store notifications. The cached guard returned false immediately when it had to return true. Evidence: `vault-token-edge-before.log` (one failing desired test, not characterization green).

`vaultStartupBlocked()` now purely returns cached blocked OR `(relevantRecovery() && recoveredScope !== vaultScope())`; metadata read/parse failure returns true. It performs no state writes, subscription notifications, or React snapshot replacement. `vaultRecoveryState()` remains the stable subscription-driven UI snapshot. Token-only invalidation is enforced synchronously at action boundaries even before verification/account publication.

The new fresh-process `startup-token-only` fixture asserts successful durable recovery first; then direct token rotation, identical account-state reference, zero account/recovery emissions, immediate repeated guard=true before any verification, unchanged cached snapshot identity and zero getter side effects. Real verification/reconciliation subsequently releases the guard. A malformed journal while the cache is clear also returns true without mutating the snapshot.

Current verification: `vault-token-edge-tests.log` **61/61 PASS**, owned TypeScript **exit 0**, changed-owned ESLint **exit 0**, changed-owned Prettier check **exit 0**. Logs: `vault-token-edge-types.log`, `vault-token-edge-eslint.log`, `vault-token-edge-format.log`. Three-file fixed snapshot `vault-token-edge-before.sha256`; all unchanged after tests/static checks in `vault-token-edge-stability.log`. No other production files edited; no global commands/browser/push.
