# Server HTTP audit/refactor — baseline 3.2.0 / 20641ff

## Outcome / STOPPED

Defensive HTTP-boundary changes are complete. **Node v22.23.3: 47/47 scoped tests PASS**, syntax checks PASS. No server/listen/browser/global check/build/format/push/package/version commands were run. No live provider requests or shell commands were executed by the new route fixtures: child spawn and HTTP server creation are guarded mocks. Importing the existing server retains its existing harmless `git --version` availability probe.

Only these existing runtime files were edited:
- `server/tetra-server.mjs` — coherent HTTP extraction and request-boundary integration, not a router rewrite.
- `server/auth.mjs` — parent-authorized, narrow readBody fallback change for **413/408/499 only** (four-line catch body). No account-security redesign.

New runtime: **`server/http-request.mjs`**. Parent must add this exact module to Tauri resources. Parent owns resource/package/test command integration; this agent did not edit those files.

## Confirmed findings / status

| Finding | Baseline evidence | Fix / verification | Status |
|---|---|---|---|
| Body limit measured UTF16 characters, not received UTF8 bytes | Actual baseline readBody expression, only numeric limit scaled 50e6→32; small Cyrillic JSON exceeding byte budget was accepted | Byte accumulation before retaining chunks, content-length early budget rejection; Buffer fragments decoded only after collection | fixed; Node22 fixtures verified |
| Aborted/incomplete body promise could remain pending | Baseline emitted `aborted` then remained unresolved; timeout race reports pending | One settlement path for abort, premature close, read error, absolute 60s deadline and request AbortSignal | fixed; Node22 fixtures verified |
| Body data/end/error listeners survived successful settlement | Baseline listener count remained 1 | Owned listeners/timer removed on settlement; cached promise prevents competing consumers | fixed; Node22 fixtures verified |
| JSON array/primitive roots accepted by object-shaped HTTP endpoints | Actual baseline parsed `[]`, `1`, `true`, string without rejection | Object root required; **empty and null still become {}**; malformed/non-object JSON 400 | fixed; unit verified; legacy auth 400 fallback intentionally unchanged |
| Session invalidated while exec body was in flight yielded 500 / null dereference | Real middleware fixture changes seeded user's credential epoch while body pending; baseline status500, no process launch | Privileged readAuthorizedBody rechecks session and request signal; exec rechecks immediately before spawn and runId lookup cannot dereference null | fixed; real middleware / mocked process verified |
| Privileged preview request used auth snapshot captured before body | Source audit plus revoked in-flight middleware fixture | Recheck after body and immediately before preview.issue; reject401 before capability server creation | fixed at owned route boundary; no live preview listener used |
| Provider proxy ignored write(false), pulling all chunks into downstream queue | Real middleware + fake fetch async iterator: baseline producer advanced despite no drain | Shared streamResponse pauses upstream pulling until drain, splits writes at64KiB, aborts on disconnect and bounded15s drain deadline; partial failure destroys response rather than ending a misleading successful stream | fixed; mocked provider/response verified |
| Auth swallowed transport failure into {}, allowing empty-body actions | Actual accountRoutes + synthetic local dev-outbox DELETE: 413/408/499 cleared fixture mail instead of rejecting | Rethrow only those three transport statuses; deliberate empty DELETE still works; unrelated400 fallback preserved | fixed; auth RED3→GREEN5 |

## Cohesive extraction and compatible contracts

`http-request.mjs` owns HTTP primitives only: JSON byte-budget/parser/deadline, public status/error responses, allowlisted CORS/Host/socket access classification, AsyncLocalStorage request cancellation, and backpressure-aware response streaming. Application authorization, projects, filesystem/git route policy, preview capabilities and exec ownership remain in their existing layers.

- JSON response shape, route names, NDJSON exec terminal frames and preview POST `{id,name,folder,path}`→capability URL contract are unchanged.
- Shared privileged route IO gets a body reader that validates current authorization after the body await. Auth routes retain the raw reader and their existing route policy, except the explicitly authorized transport fallback fix.
- Session is checked again before exec spawn and preview issuance. This is **not** a claim of a transactional account/filesystem lock or automatic cancellation of already authorized running commands on logout.
- CORS preserves Vite/local cross-port and Tauri origins (`tauri://localhost`, HTTPS tauri.localhost); configured extra hosts retain same-host-origin behavior. Core JSON/preflight/proxy reflect only accepted Origin with Vary:Origin instead of wildcard. Denied/opaque (`null`) origins get no CORS grant. Existing external route modules were not rewritten.
- Host parsing uses URL authority validation; socket locality requires a valid actual IP, with Node BlockList normalization for compressed/mapped IPv6 and127/8. Missing socket address is **not** treated as local. Host alone is never proof of locality.
- Request context follows response finish/close, not handler return (important for exec/SSE). Normal request completion does not abort a running response. Terminal upload errors remain observed until incomplete request close; response-owned handlers are cleaned.
- Body overflow pauses accumulation and retains the response transport for a structured413, with Connection:close. No immediate req.destroy before response delivery. Body deadline defaults60s. Body budget remains nominal50,000,000 **bytes** (not characters).
- Empty/null body compatibility retained; JSON object roots are required elsewhere. Legacy auth still intentionally catches non-transport400 into{} per the narrow parent authorization; this report does not claim auth-wide schema validation.
- Native finalpath races, external filesystem writers/CAS limitations and process-tree guarantees are unchanged; not silently weakened or claimed fixed by the extraction.

## RED → GREEN evidence

Logs in this directory:
- `http-body-red.log`: **4 failing** baseline assertions (byte budget, abort pending, listeners, root type). Harness `http-body-red.test.mjs` reads saved **actual** baseline expression from `server-baseline.mjs`; only the limit constant is scaled to32 to keep fixtures small. This harness is audit evidence, not a passing characterization suite.
- `http-boundaries-red.log`: **2 failing** real middleware assertions (revoked exec500 vs401; producer continued pulling without drain). No external fetch/process/listener.
- `auth-transport-red.log`: **3 failing / 2 passing**, Node22; `auth-transport-green.log`: **5/5 PASS**.
- `server-node22-green.log`: final **47/47 PASS**, no skipped/cancelled tests. Includes the three new suites and existing server-security/server-routes-security suites.
- Earlier development logs use Node24.14.1; final acceptance above explicitly uses **Node22.23.3** provided by parent.
- `server-final-sha256.txt`: final owned source/test hashes before STOP.

Final command (scoped, not npm/global test):

```
/data/fix-tetrafree/node22/node-v22.23.3-linux-x64/bin/node --test server/http-request.test.mjs server/http-boundaries.test.mjs server/auth-http-transport.test.mjs server/server-security.test.mjs server/server-routes-security.test.mjs
```

`--check` passed for http-request.mjs, tetra-server.mjs, auth.mjs and all three new test files.

## Integration manifests

- Runtime resources: `server-new-modules.txt` (one entry).
- New portable suites for parent's npm test command: `server-new-test-files.txt` (three entries).
- Entire scoped verification selection: `server-test-files.txt` (five entries).

## Explicitly not verified / limitations

- **Needs Windows/native acceptance:** packaged Tauri resources, sidecar startup/shutdown, WebView2 Origin behavior, actual cmd.exe/ConPTY/Rust Job tree cleanup and installed runtime. Portable literals/mocks are not Windows pass.
- No live HTTP sockets were used to validate actual transport delivery/keepalive/close timing under slow uploads or slow providers. Node event/stream fixtures verify state transitions; native socket behavior remains acceptance work.
- Real OAuth, SMTP, MCP or model providers were not contacted. Existing preview fixture uses a fake listener only; no real interactive browser or preview server was started.
- Stream helper controls downstream writes/next chunk pulling, not a universal memory cap on an upstream implementation that produces one already-huge chunk or ignores cancellation.
- Cancellation is cooperative at the audited boundaries and Git request signal, not atomic rollback of filesystem side effects already started.
- No full global check/build/formatter has been run. Parent performs final integration/check after STOP.
