# Server acceptance — final bounded independent revalidation

## Decision / current status

**Scoped HTTP acceptance PASS; final current run Node v22.23.3: 57/57 HTTP checks plus 1/1 repaired process/helper integration test = 58/58. Global npm test NOT independently accepted.** TAP fail/cancelled/skipped = 0, subject to the Git branch coverage qualification below.

Parent reported global server **183/184**, one stale static assertion in `process-second-security.test.mjs` searching the old location of `requestScope.run`. That count is **parent-reported**, not my global run. Author's test-only repair is now source-reviewed and independently executed **as one exact filtered test**, with actual helper import; it passes. This does not imply a final 184/184/global npm test run.

**Snapshot chronology matters:** original runtime hashes matched during the fresh pre-format57/57 rerun. Before report save, tetra-server/http-request hashes changed and visible code was reformatted; the initial report write correctly stopped on SHA mismatch. No claim of byte/semantic identity across this change is made. Subsequently all57 checks and the repaired integration test were rerun on the new hashes. Final start/end stability: **True**.

The earlier acceptance markdown and results JSON were missing in this snapshot, while fixture sources/logs survived. This report is restored using new current runs, not old transcript success. Production and repository tests were **not edited by this reviewer**. No formatter/global check/build was run by this reviewer.

## Current vs reported / baseline

- Complete AGENTS.md, author `server-audit-refactor.md`, `server-test-files.txt`, HTTP source and scoped tests were read during this review. Surviving harness was rechecked before the current executions.
- `/data/base3.2.0` remains absent. Saved `/data/audit-next-tetrafree/server-baseline.mjs` supports direct tetra-server comparison; retained diff: `server-acceptance-fixtures/server-baseline.diff`. Its stated provenance3.2.0/20641ff is author-reported, not independently proven against the missing checkout.
- Complete old auth source is unavailable. Current transport catch is source/test verified; exact narrow auth delta against3.2.0 is not independently proven. Current `http-request.mjs` actual source is reviewed/tested, not a copied fixture implementation.
- Author's47/47 manifest selection has been independently rerun, but under IO guard with one direct Node execution per file. Final formatting means previous author byte hashes are no longer all equal; per-file comparison is in `current-results.json`. Only final start/end values support the new acceptance.

## Bounded evidence matrix

| Area | Source evidence | Verified now / limit |
|---|---|---|
| Body bytes | `http-request.mjs`, readBody: Buffer byte accounting, default50,000,000, Content-Length precheck,413/closeConnection | Split UTF8, inclusive emoji budget, one-byte overflow, pause/cleanup. Scaled benign fixtures; no50MB load test. |
| Abort / settlement | readBody single finish/cache/owned-listener cleanup; runRequest response-lifetime ALS | Aborted/pre-aborted/premature close/signal, cached rejection, listener tests; actual middleware upload error DELETE →499 without clearing own synthetic outbox. No native HTTP timing claim. |
| Absolute deadline | One default60,000ms timer;408/closeConnection | Short real timer plus independent timer mock: one default60000 timer, not reset by data, cleanup. No60s wall-clock soak. |
| Auth after await | tetra-server readAuthorizedBody/requireAccount; current check immediately before preview.issue/exec spawn | Revoked in-flight body exec/preview401 without spawn/listener; independent revoke during actual exec projectDir/stat await →401, spawn mock not reached. Not an account/filesystem transaction. |
| Auth fallback | auth accountRoutes readBody catch rethrows413/408/499; legacy400 fallback retained | Synthetic outbox negative assertions for all three statuses; intentional empty DELETE and legacy400 controls pass. Not auth-wide schema validation. |
| Proxy backpressure | streamResponse64KiB writes, drain wait/default15s, request signal propagation | Drain/timeout/cancel/iterator cleanup; independent three sequential drain stalls within one140KB upstream chunk, byte equality and producer suspension. Not a universal upstream memory cap. |
| Proxy failure/disconnect | Proxy partial response destroys after headers; signal passed into fake fetch | Independent partial iterator failure →destroy rather than successful end; downstream disconnect aborts fetch signal, closes iterator, removes drain listener. Mocked provider/response, no network. |
| CORS/locality | Parsed Host/Origin and actual IP locality; accepted Origin reflection/Vary, deny null/untrusted | Vite/Tauri, mapped/IPv6 loopback, extra same-host, exact preflight; nonlocal/missing socket never local merely from Host. No WebView2 real-run. |
| Corrected process/helper integration | Ownership/stop/no-fabricated-completion source assertions retained; helper import/wiring checked; actual runRequest imported | Exact filtered test1/1: ALS preserved over await; completed request close not cancellation; unfinished response close cancels after handler returned; owned listeners removed. No process tree run. |

Saved server diff aligns with HTTP extraction, privileged reader wiring, final exec/preview auth checks and proxy drain/cancel integration. No new confirmed scoped defect/exact RED found; no production fix request generated. Historical author RED logs are not a baseline rerun performed by this acceptance.

## Current logs

| Suite | Current PASS | Log |
|---|---:|---|
| `http-request` | 18/18 | `server-acceptance-fixtures/final-http-request.log` |
| `http-boundaries` | 4/4 | `server-acceptance-fixtures/final-http-boundaries.log` |
| `auth-http-transport` | 5/5 | `server-acceptance-fixtures/final-auth-http-transport.log` |
| `server-security` | 12/12 | `server-acceptance-fixtures/final-server-security.log` |
| `server-routes-security` | 8/8 | `server-acceptance-fixtures/final-server-routes-security.log` |
| `independent` | 10/10 | `server-acceptance-fixtures/final-independent.log` |
| `corrected-integration` | 1/1 | `server-acceptance-fixtures/final-corrected-integration.log` |

57 checks use Node `/data/fix-tetrafree/node22/node-v22.23.3-linux-x64/bin/node --import /data/audit-next-tetrafree/server-acceptance-fixtures/no-io-guard.mjs FILE`. Independent FILE is the external `independent-current.test.mjs`; five others are from the project manifest.

Repaired test command additionally uses `--test --experimental-test-isolation=none --test-name-pattern='^server integration retains ownership and never fabricates completion on cancellation timer$'` on `server/process-second-security.test.mjs`: exactly one test, no runner subprocess isolation.

Guard denies actual child-process launch APIs, net listen/connect, HTTP(S) requests, default fetch, datagram and primary DNS APIs. Fixtures use EventEmitters/fake fetch/child/listener and own disposable data. Logs show only **blocked** import availability probes python3/python/git in suites importing server; no actual process/network/listener/browser activity. Corrected-integration guard log is empty.

**47/47 caveat:** old Git route test (`server-routes-security.test.mjs`, “Git file routes reject resolved external parent…”) continues past Git-specific assertions if Git unavailable. Guard makes hasGit false. TAP PASS is therefore not proof of those Git branches. Existing Windows cases are mock/string checks, not native execution.

## Final SHA stability

| File | SHA256 final start = end (if stable=True above) |
|---|---|
| `tetra-server.mjs` | `bdfd7515bfbcaaf53868478bc3a464d6b0079c4c32c968d2b5d7c69878a895ee` |
| `auth.mjs` | `8cfd496e7c75c00fce1a25acf1f00f31b202f677c598483535a3c4c7657bc2f1` |
| `http-request.mjs` | `8a76874b2d96f4c20295671e8416207586f67806a43b58df9c82d9fe98eee04a` |
| `process-second-security.test.mjs` | `17928c13ff03239da1389cdff371afb9345a81e0e608e91a3a177dae609b545a` |

Evidence: `server-acceptance-fixtures/final-start.sha256`, `final-end.sha256`, `current-results.json`. Old `start.sha256`/`preformat-start.sha256` intentionally retained as prior snapshot evidence, not current byte acceptance. Four-file equality is not whole-worktree immutability, semantic proof of formatting-only change, or a promise against later changes.

## Remaining gates / bounded stop

- Parent's **final npm test/global check/build status remains pending here**, despite targeted repair now passing. Parent owns resources/test manifests/packaging and final formatter integration. Any subsequent source changes need final SHA/test reconciliation.
- Missing baseline checkout/auth baseline; actual upload/keepalive/socket delivery/slow-provider behavior not verified. Cancellation is cooperative, not rollback of side effects; upstream huge chunks/ignoring abort are not universally bounded.
- No new broad R01–R10, SMTP/OAuth/MCP/provider/SSRF, CI/release/lock audit performed.
- **Windows real-run not claimed:** installed Tauri/WebView2, cmd.exe/ConPTY/Job/process trees, Rust lifecycle/updater require separate acceptance.
- Reviewer made no production/test edits, no global formatter/check/build/release/push. Bounded HTTP + repaired helper integration validation is complete.
