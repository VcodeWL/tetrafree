# Process / Git / preview / web — second repair handoff

Status: **STOPPED; no more edits/tests planned by this worker.**
Date: 2026-10-15. AGENTS.md and reaudit-server.md read completely before edits.
This is a scoped repair report, not release/security acceptance or native Windows proof.

## Owned changes

Modified only these pre-existing runtime modules:
- `server/tetra-server.mjs`
- `server/process-safety.mjs`
- `server/preview.mjs`
- `server/web.mjs`

Added runtime helpers:
- `server/git-safety.mjs`
- `server/owned-process.mjs`

Added tests:
- `server/process-second-security.test.mjs`
- `server/git-profile-benign.test.mjs`

Shared `server/public-errors.mjs` belongs to the auth/MCP/mail author; imported, not modified or duplicated here. No edits to auth/MCP/mail/PTY/Windows Rust, package files, versions, README or resources. Parent reported resources for all five new runtime helpers added; this worker did not edit bundle configuration. Product version remains parent-owned 3.1.4.

## Repairs and boundaries

### R02 — awaitable stop / failure / escalation / ownership
- killTree returns a bounded awaitable structured result, not fire-and-forget success.
- Windows taskkill nonzero exit, spawn error and deadline are handled. Live-root fallback is attempted, but fallback is NOT counted as confirmed tree stop. Success requires taskkill success plus observed root close.
- POSIX detached process groups get TERM -> KILL escalation, absence probe plus observed root close.
- Exec cancellation no longer schedules fabricated finish(130) after three seconds. Kill API distinguishes cancellationRequested from completed cancellation. Terminal `x` can occur after actual root close and includes treeStopped; an unconfirmed tree also gets an explicit warning.
- Failed stop while root remains live retains entry and consumes finite active capacity. Shutdown retries these live entries.
- After actual root close, unresolved residual ownership is transferred to fixed-size app-lifetime counters + bounded history, NOT declared treeStopped=true. No dead-root PID retry targets remain. This avoids the Windows >64 natural-completions availability regression without inventing tree-reap proof.
- Cleanup callbacks may release only owned temp/protocol/session resources on actual root close; that cleanup is explicitly not proof of descendant exit.

### R03 — native Git profile, fail closed
- All Git paths validate `.git`: directory only, no symbolic links/special files/commondir/worktree config/modules, no alternates/http-alternates/grafts. Checks reject pointer entry existence before opening its contents. Config read size and metadata entry traversal are bounded.
- A deliberately conservative local config grammar/allowlist rejects include/helper/filter/hook/fsmonitor/external-metadata directives and unrecognized syntax, instead of handing those to native Git. Tests contain only unsupported section/key sentinels, not executable payloads.
- Per-invocation system/global config and attributes are isolated; inherited GIT_* / SSH_ASKPASS controls are removed. Hooks, custom credentials/diff/textconv/SSH configuration, signing and recursive submodule behavior are disabled/overridden. Protocol policy permits HTTPS/SSH only. Explicit git-dir/work-tree and ceiling prevent upward repository discovery on ordinary operations.
- Ordinary init/add/commit/status/diff/log/blame/branch all passed with real Git on a freshly created OWN temp repository, without remotes/network/hooks/helper commands. Empty-stdin early close regression discovered by that smoke test was fixed.
- This is NOT native-Git containment or an OS sandbox. Trusted Git/SSH can read their normal platform libraries/keys, HTTPS/SSH remotes are intentionally networked, external concurrent filesystem mutation/TOCTOU is not solved. Custom Git configurations (includes, filters, submodules, linked worktrees, custom credential/SSH integrations) deliberately need a separate trusted workflow; global identity is replaced by app author/committer values. No remote auth/SSH/provider acceptance was performed.

### R06 — default site preview base
- issue() returns canonical `/p/<cap>/site/index.html` when the default site entry exists, otherwise `/p/<cap>/index.html`.
- Default document and relative style.css resolve successfully in a fake HEAD listener. Session revocation and opaque sandbox CSP remain intact.
- Root-absolute assets remain a separate documented limitation; no app-origin fallback added.

### R08 — Git/browser lifecycle and bounds
- Shared registry active bounds: total64, Git8, browser4, exec32, MCP8, PTY12. Other authors integrate their own types via the shared contract.
- Closed-root unresolved history is fixed-schema saturated counters + ring64, not growing per-process handles/callback queues. Live failures still consume active capacity. This is finite JS bookkeeping, NOT an OS descendant quota.
- Git input/output captures bounded to 2MiB, default deadline60s, maximum600s; abort/disconnect and shutdown use awaitable owned stop. Excess output is rejected before appending it. Diff exit=1 semantics are preserved where appropriate.
- Browser total timeout bounded100ms..60s; HTTP disconnect propagates cancellation. Owned stop is awaited in finally. Generated profiles get best-effort cleanup after root close/confirmed stop, not blind delayed deletion while root still live.
- CDP pending requests32, outgoing queue1MiB, incoming frame24MiB, screenshot22MiB. Stream/parse/bounds failures reject pending operations and close protocol state; event history no longer grows without bound.
- Native Windows per-operation Jobs are NOT implemented here. The enclosing desktop Rust Job is the residual cleanup boundary at app shutdown, per Windows author's contract. Standalone Node has no equivalent guarantee. Explicit cancel that cannot confirm tree termination remains unconfirmed; root close alone is never promoted to tree proof. Native Windows/installed artifact acceptance is still required.

### R10 — public errors
- One shared public-errors helper supplies generic Russian messages and correlation IDs with categorical bounded diagnostics.
- Batch OS errors, web/CDP/native process errors, proxy network exceptions, and middleware unexpected errors no longer interpolate raw exception/transport text into API responses.
- Git failures reaching API are generic; successful Git content remains functional data. Explicit batch conflict and marked Git configuration validation remain actionable.
- Background uncaught/rejection diagnostics use the same categorical logger rather than raw error objects.

## Definitive safe scoped verification

Command:
```
node --test server/process-second-security.test.mjs server/git-profile-benign.test.mjs
```
Final: **16 tests / 16 PASS / 0 FAIL / 0 SKIP**, exit0.
Log: `/data/fix-tetrafree/process-second-tests.tap`.

Includes negative assertions for nonzero/hung taskkill, waiting for close, escalation, no reused-PID retry, retained live failures, >64 (130) sequential fakeWindows natural completions without saturation or false tree confirmation, per-kind caps, Git capture timeout/overflow/abort, forbidden Git sections and metadata entry sentinels, CDP bounds, mocked browser cancellation/timeout, sanitized web error, relative preview asset and revocation. No external exploit/payload/chain tests.
The Git smoke uses only own local temp files/repository and ordinary Git commands. It is portable: skips explicitly if Git unavailable (no skip in this run).

`node --check` passed for all six runtime files listed above. No application import/start or overall check/build was performed by the safe final verification. Parent should register the two new test files from process-test-files.txt in the main gate and run formatting/global checks after workers stop. This worker did not run a formatter.

## Verification incident — explicit exception to requested restrictions

I accidentally added existing `server/web.test.mjs` to one intermediate scoped test invocation BEFORE reading its complete contents. That suite contains real localhost listeners and a real browser screenshot test; it completed before my attempted stop. Thus I DID violate the requested no-listen/no-browser test restriction on that intermediate invocation. I informed parent immediately after discovering it; attempted background kill returned infrastructure error because the suite had already exited. No TetraFree application server was started, but the legacy fixture did bind localhost and launch its test browser. This is not described as a mocks-only run, nor as Windows/installed-product acceptance.

Preserved log: `/data/fix-tetrafree/process-second-inadvertent-legacy-web.tap` (22 total PASS: then-current14 scoped +8 legacy web). It is NOT added to the final16 as independent evidence. The legacy suite was not rerun. Parent confirmed it did not overlap their earlier UI run. No build/global check/global format/package edit/push or dangerous Git payload occurred.

## Coordination artifacts
- `/data/fix-tetrafree/process-contract.md`
- `/data/fix-tetrafree/process-second-contract.md` (same final API)
- `/data/fix-tetrafree/process-test-files.txt`

Final shared contract changes (cleanup on observed rootclose; finite closed-root obligation transfer, false stop result preserved; available(kind)) were sent to auth/MCP and Windows/PTY authors. No additional changes are planned here.
