# Windows / PTY second pass — FINAL policy integration

Read FINAL `/data/fix-tetrafree/process-contract.md` and process agent's explicit updated cleanup/capacity guidance. This report SUPERSEDES the intermediate second-pass report with the earlier retain-all-closed-roots policy.

Changed only `server/pty.mjs`, new `server/pty-ownership.test.mjs`, and test-list/report handoff. No modifications to process-safety.mjs, tetra-server.mjs, web.mjs, mcp.mjs, public-errors.mjs. No global check/build, no Prettier, no push.

## Final adapter behavior

- `serverProcesses.available('pty')` is checked BEFORE spawn, synchronously with immediate `own(child,'pty',cleanup)`. Registry own() invokes observeChild itself; there are no unobserved direct killTree calls. Active per-kind and global capacity failures use shared publicError/publicFailure with503, before any unowned process exists.
- `cleanup({treeStopped,rootClosed})` now copies the ACTUAL supplied booleans. Invoking cleanup is never upgraded to tree success. It releases ONLY PTY-owned session/ring/protocol state, not user project resources.
- Rootclosed+false releases active session capacity and transfers residual ownership to registry's bounded aggregate. PTY diagnostics separately retain saturating `treeStop.unconfirmedClosedTrees` and `treeStop.last={treeStopped:false,rootClosed:true,at}` without PID/child handles.
- Replay history is separate from active sessions: at most **12** closed snapshots, each a ring <=256KiB, TTL **60s**, with NO Child/owned/PID references. It cannot lock the active PTY12 cap after natural exits. Snapshot expiry/eviction clears the timer when evicted. Aggregate obligations are not called successful reaps.
- A still-LIVE root with false stop remains in active session and registry capacity; it is not dropped to make room. Explicit close and server shutdown await owned.stop. Close only returns200 for confirmed stopped; false returns honest503. A retired false history close never signals an old numeric PID again.
- `shutdownPty()` prevents new spawns, awaits live owned.stop attempts, and returns per-attempt results. Prior closed-root obligations are reported as an extra `{stopped:false,reason:'closed-root-obligations',unconfirmedClosedTrees}` summary, rather than inferring success from an empty active map. It does NOT retry retired dead-root PIDs.
- Async stop logic is removed from synchronous process exit hooks. Parent/server shutdown must await the shared APIs. No early stdinEOF before the stop strategy: this avoids making a helper exit before taskkill can attempt confirmation.
- Open/input/resize/stream request shapes remain unchanged. Existing validation/backpressure, native STARTF_USESTDHANDLES source, sidecar/smoke gates remain intact. Input/resize validation also applies to closed replay snapshots. Adding fields to status and returning shutdown summaries is additive for existing callers ignoring the old return value.

## Actual evidence

`node --test $(cat /data/fix-tetrafree/windows-test-files.txt)` -> **26 pass / 0 fail / 0 skip**, final log `windows/second-final-tests.log`. JS syntax checks pass. Parent test list now includes `server/pty-ownership.test.mjs`; no package script changes by this owner.

The new portable adapter suite executes the ACTUAL pty.mjs source in a VM with OS process spawning substituted, using the REAL shared createProcessRegistry and public errors. This is adapter evidence, NOT native Windows execution:

1. Saturated capacity rejects with safe503 before spawn; zero unowned processes.
2. **130 sequential mock terminal natural closes with stopfalse:** every new open succeeds; active registry returns to0; closedRootObligations reaches130; recent registry ring stays<=64; PTY replay count stays exactly12. Diagnostics retain treeStopped=false. All retired owned.stop calls, close-history requests and shutdown cause NO repeat stop/PID kill calls. Shutdown reports the false aggregate.
3. LIVE failed stop remains owned and blocks capacity. HTTP close and shutdown wait for stop; only explicit confirmed true releases the live session. Shutdown retries the live entry, never a retired PID.

Existing real Linux PTY route test passes against the updated shared API. Existing owned dimension/backpressure, ConPTY static-source, smoke-assertion, sidecar filesystem, bundle and release-note regressions all pass in the26 scoped total.

## Limitations — unchanged, do not overclaim

- Root close and finite history/aggregate accounting are NOT descendant-tree proof. Global Windows desktop Rust Job remains the residual app-lifetime boundary; no new native per-operation Job guarantee is claimed. Standalone Node has no equivalent guaranteed residual-tree cleanup. Bounded JS bookkeeping is not an OS descendant quota/sandbox.
- No native Windows taskkill/ConPTY/Job/installer execution or signed-artifact verification in this pass. First-pass full Tauri cross-check remained blocked by missing MSVC lib.exe; partial FFI typecheck is not a full build/native pass.
- External editor ownership and missing durable frontend checkpoint IPC/desktop-close gate from windows-fixes.md remain pending. No new persistence claim.
- Callers must inspect shutdown false statuses / registry closedRootObligations; empty active entries do not certify all trees stopped.

FINAL adapter/report complete. Main may consolidate tests/format/check after ownership handoff. No more edits running by this owner.
