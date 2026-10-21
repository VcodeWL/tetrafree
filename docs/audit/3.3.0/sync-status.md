# Sync diagnostics / UX audit — stable owned handoff

**STOPPED / stable source.** Parent baseline: 3.2.0 / `20641ff`; read-only source baseline `/data/base` reports 3.2.0. Working copy has no `.git`, so this is a source-baseline comparison, not local Git ancestry proof. No push/commit/init, browser, global check/format/build, server execution or server/package/version/types/settings edits by this owner.

## Fixed findings with desired RED → GREEN

### SY01 — stale overlapping backend detection

`detectBackend` now carries a latest-detection epoch. A superseded success/failure cannot publish online/base/info/offline. An explicit URL selection immediately invalidates request authority (even when already checking), clears obsolete PTY retry timer and resets its bounded retry count. Old delayed PTY callbacks cannot run new detection for a superseded selection. Same-server health polling no longer erases an existing disk error without a real reconciliation.

Evidence: `backend-context-red.log` **0/7 PASS** on original code; subsequent green includes overlapping explicit selection success, stale failure, post-fetch JSON races, proxy fallback and stale exec cleanup. Additional tests cover base ABA and token ABA plus selection while already checking.

### SY02 — post-await backend/token authority switches

Backend request authority captures original base, backend context epoch, bearer headers and account-owner's monotonic `getTokenRevision()`. POST and GET response consumers guard after fetch AND JSON; exec guards awaited stream reads/frame delivery/final result. A→B→A base or token does not revive old authority. Proxy failure after a context change cannot silently retry directly against the model API.

Exec cancellation/failed-stream cleanup uses **original** base/token/runId, never a newly selected server/account. Existing preabort/cancel/timeout/UTF8/exit-frame behavior is retained. Sync's existing context guards also include both monotonic revisions. Stale catches cannot overwrite the current context's legacy lastError; delayed commit→mirror and mirror UI results are guarded. Existing lost-folder explicit-reset action now verifies its captured context before touching a baseline.

### SY03 — global lastSync falsely certifies another project / local dirty state

Small additive `syncStatus.ts` observation module separates backend reachability, per-pid/context disk pass and project-local checkpoint. `captureSyncHealth(pid?)` is synchronous/read-only and returns **only the documented whitelist**. No path/base/bearer/content/raw Error export. Parent diagnostics can pass it to its own stricter builder (which omits pid/timestamp).

Disk proof requires a completed nontruncated eligible-text pass, no failed/deferred paths, and unchanged file/directory references. A no-write pass racing a local edit is independently compared against acknowledged hashes rather than falsely stamping the newest live reference as verified. Later edits invalidate the timestamp. Context changes invalidate prior proof, including token/base ABA and folder/generation reset. `hasSynced` initial docsync gate is now context-scoped, not a UI proof. Legacy global backend fields remain for compatibility, with syncing correctly counting all busy projects.

Evidence:
- `sync-status-red.log`: **1/6 PASS, 5 desired FAIL** before wiring actual reconciliation observations.
- `sync-postscan-red.log`: **10/11 PASS, desired FAIL** for a newly witnessed no-write hash-await edit; health-only fix now green.
- Current suite covers another pid, unsynced edit, concurrent busy, truncation, failed checkpoint, backend switch, token ABA, simultaneous projects, and safe retries.

### SY04 — safe explicit retry and honest Russian status

`retryProjectSync(pid)` never clears baseline/journal/recovery. Same-context busy retry does not queue duplicate work. Explicit disk retry clears only the automatic badPaths suppression cache, so an unchanged file can actually retry after repaired permissions/space. Expected-hash CAS and existing recovery-before-overwrite remain unchanged. Offline/remote/signed-out/disabled retry confirms **only** the project-local app checkpoint; it sends no disk/network write and never reports disk/cloud delivery.

Evidence: `sync-retry-red.log`: **11/12 PASS, desired FAIL** for unchanged EACCES after permission repair before explicit-suppression fix. Final green confirms actual second batch and verified eligible files. Offline retry test asserts zero transport calls and byte-identical baseline.

StatusBar shows separate disk and project-checkpoint observations, no global lastSync/error proof; editor save is labeled as project state, not disk durability. Parent supplied additive editor pid; this owner only renders its badge for `ed.pid === activePid`. Tooltip uses correct Russian `сброса` (no replacement glyphs). Account/backend subscriptions invalidate visible status in normal account UI transitions; time-based refresh remains conservative.

### SY05 — Boot treats busy null as warning

A null reconcile caused by already-running work is normal background status, not an error warning. Boot uses same-project health, no other-project raw lastError. Backend/session/project guards suppress stale completion; context changes dismiss/restart the appropriate overlay. Partial/pending passes cannot display blanket “all files match disk”; timeout explicitly says result remains unconfirmed.

Evidence: actual component bodies executed with controlled hooks (not regex-only assertions, not browser DOM). `sync-ui-red.log` **0/2 PASS** against exact `/data/base` 3.2.0 component sources; current UI tests pass for active unchecked state, busy Boot and foreign-project editor badge. No browser used.

## Final current validation

Node: `/data/fix-tetrafree/node22/node-v22.23.3-linux-x64/bin/node` (22.23.3).

- `sync-scoped-green.log`: **88/88 PASS**, 0 skipped/cancelled.
- Includes new backend context / sync health / actual controlled TSX tests PLUS unchanged backend.exec, sync, syncJournal, team and teamMetadata regression suites. Original dirty-journal/ABA/runtime-human/recovery/CAS tests remain green.
- `sync-owned-lint.log`: owned ESLint 0.
- `sync-owned-types.log`: **only diagnostics located in eight owned files**, 0; not a global typecheck.
- `sync-stable.sha256`: final eight owned source/test hashes, checked unchanged at handoff.
- `sync-test-files.txt`: **three new test entries** parent must register in npm test. `sync-regression-files.txt` lists existing entries exercised; do not duplicate registration.
- `sync-status-contracts.md`: exact additive API semantics and privacy contract.

Owned files: backend.ts, sync.ts, new syncStatus.ts; StatusBar.tsx, Boot.tsx; new backend.context.test.ts, syncStatus.test.ts, syncStatus.ui.test.ts. No new runtime dependency. Small extraction only; merge/CAS/journal/flush ordering and reconciliation summary/null shape not rewritten. `checkpointProject` always invokes actual flush; it does not coalesce/bypass persistence calls.

Parent owns Settings/TitleBar/diagnostics collector and editor pid API/callers. Account owner owns getTokenRevision implementation. Parent integration is not self-certified by this report; its independent tests/overall check are separate.

## Real limits / remaining

- Disk verified is a scoped **observation of eligible text files at the last pass**, not continuous equality, directory/binary/ignored-file audit, Git push delivery, cloud delivery, whole-store checkpoint or native filesystem durability.
- Project checkpoint confirmed requires this owner's actual awaited flush and unchanged project/context. Other code may have successfully auto-persisted; absent this observation still reports unconfirmed rather than inventing proof. It cannot be promoted to whole-store durability in diagnostics.
- Existing ack journals, manual visible recovery and server in-process expectedHashes constraints still apply. No atomic transaction/CRDT/exactly-once claim. Both persistence backends failing can still prevent new durable intent; ambiguous journal can intentionally stop background sync until explicit recovery review.
- Authority guards prevent applying stale replies, not rollback of an already accepted external POST. They do not instantly abort every old pending socket/process on account change; exec still cleans up using original authority on cancellation/error/read/timeout boundaries. Proxy Response consumers remain responsible for their own subsequent streaming/account guards after the function returns.
- Runtime epochs are process-local; no cross-window/process lock, native Windows/WebView/IDB/power-loss/fsync/OAuth/live network testing. Benign in-memory fixtures are deliberately not evidence of those platforms.
- Legacy global backend fields remain compatibility-only. Parent must not use them as active-project disk proof; Settings/TitleBar integration is parent-owned. Manual retry does not resolve fail-closed journal ambiguity by dropping data.

No unresolved known loss was hidden by a “green” global claim. Existing journal/data-loss regressions were exercised unchanged. Owned production/test scope stopped for parent validation.
