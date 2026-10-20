# FINAL shared process contract — second repair pass

## API
- `serverProcesses` singleton and `createProcessRegistry({limit=64, stop=killTree, historyLimit=64, kindLimits})`.
- `available(kind)` BEFORE spawn. Defaults active limits: Git 8, browser 4, exec 32, MCP 8, PTY 12; total 64. Entries are registered synchronously immediately after spawn via `own(child,kind,cleanup)`.
- `owned.stop()` is awaitable/single-flight. Result `{stopped:boolean,reason?:string}`; stop failure does not reject. Once retired it returns its previous result without signalling a numeric PID again.
- `cleanup(state)` is invoked once after confirmed stop OR observed **root close**, with `{treeStopped:boolean,rootClosed:boolean}`. This is a CHANGED contract versus the first draft. Cleanup is only for owned temporary/protocol/session resources, never user-project deletion. Its invocation is NOT proof of descendant exit.
- Root `close` always triggers stop. No root-exit==tree-reap inference.

## Capacity / residual ownership
- Live roots whose stop fails remain in `entries` and continue consuming active capacity. They are retried on shutdown.
- Roots with observed close and unconfirmed tree stop transfer out of active capacity. A fixed schema `closedRootObligations` counter set (saturating numbers), plus `recentClosed` ring (64 default), records unresolved app-lifetime obligations. There are no retained dead-root PID kill targets, child handles or callback queues. `stopped` remains FALSE, never upgraded based only on root close.
- This transfer is essential for Windows availability: >64 naturally completed Git commands must not fill active registry. The 130 sequential fakeWindows regression and live-failed-stop capacity test both pass.
- The Windows desktop enclosing Rust Job owns residual descendants until app shutdown. This JS layer does NOT claim per-operation native Job proof. In standalone Node there is no equivalent guaranteed residual-tree cleanup. Neither path is an OS sandbox; detached/breakaway cases remain outside these JS guarantees. Fixed ledger memory does not impose an OS descendant quota.
- After rootclose+Windows taskkill failure, do NOT retry that numeric PID later: it may have been reused. Retired owned.stop returns the recorded FALSE. The global app Job, not a stale PID, is the remaining desktop cleanup boundary.

## Tree-stop primitive
- `killTree(child,signal='SIGTERM',platform=process.platform,launch=spawn,options={})` -> Promise result. Direct callers must `observeChild(child)` immediately after spawn; registry does that.
- Windows: taskkill `/PID <own PID> /T /F`, nonzero exit/error/deadline handling, fallback only against a still-live root, total default deadline 1500ms; true requires taskkill success AND observed root close.
- POSIX: detached process group, TERM then KILL after 700ms, group-absence probe AND observed root close; total default deadline 1500ms.
- `await serverProcesses.shutdown()` refuses new ownership and awaits current live-root stop attempts; returns their results. Read `closedRootObligations` separately: an empty active map does not mean all descendant trees were proven stopped.

## Shared errors / bundle / tests
- Use the ONE shared `public-errors.mjs`: `publicError` + `publicFailure(error,fallback,status,scope)` -> `{status,error}`. No duplicate helper.
- New runtime bundle resources for parent: `server/git-safety.mjs`, `server/owned-process.mjs`, and other author's shared `server/public-errors.mjs`.
- New test files for parent gate: `server/process-second-security.test.mjs`, `server/git-profile-benign.test.mjs`.
