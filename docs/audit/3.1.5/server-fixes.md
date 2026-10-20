# TetraFree server defensive repair

## Status and evidence

Owned files modified: `server/tetra-server.mjs`, `server/auth.mjs`, `server/mail.mjs`, `server/mcp.mjs`, `server/web.mjs`; `src/screens/Auth.tsx` only for unified MFA response handling (OAuth, existing password login and verify). New runtime helpers: `server/fs-safety.mjs`, `server/process-safety.mjs`, `server/preview.mjs`. Three new unit files listed in `server-test-files.txt`.

Read complete root AGENTS.md (only AGENTS.md found), server audit and Windows audit, including W04/W05/W07/W10/W11. No other owned files, package/version/lock, Rust/PTY/conpty/scripts/CI changed by this agent. No push. No full check/build/server/browser/prettier run.

| Finding | Status | Fix/evidence | Remaining acceptance |
|---|---|---|---|
| SEC01 / S01 preview | fixed; code verified | Dedicated lazy loopback HTTP origin, project+session short-lived random capability, no API; CSP opaque sandbox preserves DOM/canvas/scripts/forms. Fake listener unit verifies capability scope/revocation/headers; no network. Legacy same-origin links explicitly 410. | Needs Windows/WebView2 and browser acceptance; frontend integration owned by main. Storage/SW intentionally unavailable, root-absolute project asset URLs require relative base; external project API/backend is not proxied. |
| SEC02 / S02 final index | fixed; code verified | Shared finalFile selects directory index THEN realpath+regular-file check, preview excludes dotfiles/node_modules. Benign synthetic symlink boundary fixture passes. Static app fallback final path also checked. | Needs Windows NTFS junction/device/ADS and filesystem races acceptance. No race-free sandbox claim. |
| SEC03 / S03 IP normalization | fixed; code verified | IPv6 validated and expanded numerically, mapped tail classified as IPv4; fail-closed nonglobal/transition/reserved/documentation policy, URL and DNS use same classifier. Equivalent forms tested without DNS/network. | Real network/provider behavior not tested. Conservative range policy may reject special-purpose endpoints intentionally. |
| SEC04 / S04 pending registration | fixed; code verified | Re-register never replaces pending name/hash. Same password is idempotent 201, different password 409 with resend/reset instruction; concurrent creation rechecks after scrypt. Email verify challenge owner binds UID+credential hash. Synthetic account/router unit checks unchanged credentials and legitimate verification. | Real SMTP/email delivery not tested; old unbound verify challenges require resend after upgrade. |
| SEC05 / S05 unified MFA | fixed; code verified | Verify/password/reset/OAuth exchange call postAuthentication; enabled local TOTP yields limited five-minute ticket, no session. UI handles OAuth + existing password login 200 need=2fa. Fixture verifies gate does not create a session; source-bound exchange call checked. | Actual provider OAuth callback and native UI interaction not exercised; no claim of live OAuth acceptance. |
| SEC06 / S06 SMTP TLS | fixed; code verified | Mandatory implicit TLS or STARTTLS, hard failure before AUTH/mail when upgrade missing or cert unauthorized. Fake SMTP transport tests missing TLS, invalid cert and authorized upgrade; no sockets. | Real certificate chain/SMTP deployments not tested. No cleartext relay exception. |
| SEC07 / S07 fs/git | fixed; code verified | Shared lexical+projected-real containment; fail closed except true missing leaves. rmdirs/prune/reveal/walk/git selected paths/cwd/managed metadata/backups/static covered. Deleting link validates parent (does not follow target); child traversal rejected. Git file pathspec wildcard/magic rejected; .git symlinks/indirect worktree/common-dir rejected; metadata symlinks rejected, core.worktree forced for repo operations. Fixture diff/discard/blame with external parent rejected and benign fixture intact. | Needs Windows semantics. Explicit user folder browsing/cloning remains intentional selection, not restricted to default managed ROOT. No TOCTOU/OS sandbox guarantee. Git metadata traversal adds cost for large repositories. |
| SEC08 / S08 MCP initialization | fixed; code verified | Single-flight ready promise awaited by every consumer; stop/eviction rejects pending generation; failed old generation cannot delete replacement. HTTP abort on close, no notifications/requests after close. Controlled-promise unit coverage. | Real stdio/npx/Windows .cmd quoting acceptance not done. |
| SEC09 / S09 MCP response ID | fixed; code verified | Shared JSON-RPC version/exact-ID/result-vs-error/object-result validation for JSON/SSE/stdio. Inbound JSON/SSE/stdio bounded 2MiB. Fake fetch wrong-ID + schema units. | No remote MCP server or stress test run. |
| W04 exec tree cancel | fixed; code verified; needs Windows | taskkill /PID /T /F on Windows; POSIX group signal; manual/timeout/disconnect use same bounded close lifecycle. Mock launch asserts tree args, actual Windows taskkill not run. | Job Object owned by Windows agent remains final guarantee. taskkill is best-effort, not a proof all descendants exit. |
| W05 UTF8 | fixed; code verified; needs Windows | Per-stream StringDecoder for exec and setEncoding for Git, final flush. Fake exec child emits byte-split Russian/emoji and stderr, assertions exact. Windows wrapper sets chcp65001 before command. | chcp is an explicit UTF8 policy, NOT a universal OEM/native-binary transcoder. CP866/native mixed output still needs Windows acceptance. |
| W07 exec backpressure | fixed; code verified | Pause both child streams on res.write false, resume drain; response queue bound256KiB and slow-drain15s disconnect+cancel. Fake bounded queue unit. | No stress/slow-network test; PTY implementation owned by Windows agent. |
| W10 cwd/status | fixed; code verified; needs Windows | Separate user .cmd + call wrapper, status saved on next line, cwd emitted after command, delayed expansion disabled; private temp files cleaned. Mock exec returns code7/cwd sub correctly on Linux pipeline. | Real cmd quoting/exit /b/npm.cmd/%/!/Russian paths and 32-bit status acceptance required; no native Windows execution claim. |
| W11 child environment | fixed; code verified | Sanitized inheritance for exec/Git/MCP resolve+spawn/browser/reveal/editors; drops SMTP/OAuth/backend private settings and injected Git location/config env. Explicit project/MCP env remains intentional. | Env sanitizer is a denylist of known server-private vars, not an arbitrary-secret detector. PTY env owned by Windows agent. |

## CAS contract (agreed with parent)

`POST /api/fs/batch` optional `expectedHashes: Record<string,string|null>`; hash is existing `fnv(text)` used by `/api/fs/hashes`, null means missing file. Checked immediately before each write/remove. Mismatch leaves that path unchanged and returns existing **HTTP 200 partial-success** response with `failed: [{path,code:'CONFLICT',error:'Файл на диске изменился — перечитай его перед записью или удалением'}]`. This supersedes original whole-batch 409 request by explicit parent agreement. `failed` remains an array.

Own batch writers serialize by canonical project root. This is **NOT native atomic compare+write**: external editor/process may change files after comparison or while Node write/delete executes. No OS-level atomic lock is promised; fnv is a compatibility/concurrency checksum, not cryptographic integrity.

## Preview frontend contract (sent to main)

Authenticated `POST /api/preview {id?,name?,folder?,path?:string}` -> `{url:string,expiresAt:number}` (epoch milliseconds, TTL15min). Returned absolute URL is `http://127.0.0.1:<ephemeral>/p/<32hexcap>/<encoded path segments>`. Default path resolves site/index.html then index.html. Main may request once with `path:''` and append encoded relative paths to its returned base URL, or request a specific page via path. Refresh on expiry/reopening. No bearer/session-wide preview token in URL.

Iframe sandbox must omit `allow-same-origin`; use `allow-scripts allow-forms allow-modals allow-popups`, referrerPolicy no-referrer, external opening noopener. Separate listener serves no app/API. Opaque origin disables storage/service workers while preserving normal DOM/script/form/canvas behavior; assets on preview use CORS*. Relative assets work, root-absolute `/assets/...` require project relative base. Do not silently fall back to legacy app-origin URL or raw same-origin blob.

## Packaging / lifecycle handoff

Windows bundle.resources must include exactly these new runtime files: `server/fs-safety.mjs`, `server/process-safety.mjs`, `server/preview.mjs`. Main owns package.test entries for three files in server-test-files.txt. No resource or package edits by this agent.

Parent-control stdin enabled only in TF_SERVE=1 main: bounded line parser `{"type":"tetra-shutdown"}\n`, EOF also shuts down, idempotent. shutdownServer closes tracked standalone HTTP/preview/MCP, stops all execChildren (not only runId ones), waits bounded3.2s plus concurrent shutdownPty(), flushes auth DB, then exits. SIGINT/SIGTERM main now use same graceful path; old auth immediate signal exit removed. Real Rust/Job lifecycle acceptance is Windows-owned.

## Checks actually executed

- `node --check` on eight runtime modules: pass.
- `node --test $(cat /data/fix-tetrafree/server-test-files.txt)`: **22 pass / 0 fail**; log server-unit.log.
- Scoped `eslint src/screens/Auth.tsx`: pass, server-auth-eslint.log (server .mjs ignored by repository lint config).
- No listen/start/browser/shared-server invocation. Preview uses fake listener; SMTP net/tls and MCP fetch mocked. Exec child mocked (no commands executed in exec unit). Benign native Git init/status setup only inside isolated temp fixtures for containment. No external targets, account takeover chains, exploitation payloads or flooding.
- No formatter run per explicit instruction; main may format after ownership handoff.

Full check/build, native Windows, actual OAuth/SMTP/MCP and browser preview integration remain unverified.

## Additional exec cancellation repair

Session-scoped runId registry: active duplicate IDs return409; unknown `/api/exec/kill` accepted200 `{ok:true,cancelled:true,running:false}` creates tombstone. At most1024 unexpired tombstones with15min TTL; full unknown registry returns429 rather than silently evicting an accepted cancellation. In-flight preparation retains its own cancellation bit independently of tombstone expiry, checked synchronously immediately before spawn; aborted/disconnected request also never launches after preparation. Up to64 identified pending preparations. Canceled `/api/exec` returns NDJSON terminal x/code130 without launching. Units cover kill before request and kill during async preparation with zero process launches. Tombstones are bounded, not permanent cancellation identities across process restarts or arrivals after15min. This is not a recall of already executed subprocess side effects.
