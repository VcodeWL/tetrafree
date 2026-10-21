# Diagnostics — scoped implementation + audit handoff

Baseline supplied by parent: 3.2.0 / 20641ff. Scope completed: two new production files and two new portable suites only. Settings/App/ModalRoot/types/backend/account/sync/package/version untouched. This is an author implementation report; legacy finding has a separate actual-source characterization witness.

## Finding D01 — Medium / privacy, explicit legacy copy

`src/modals/Settings.tsx:1371–1387`, copy action at `:1401`: old `diagnostics()` includes navigator.userAgent, arbitrary backend info/shell, b.lastError, project name/path and selected model string. Free-form exception/backend strings are not sanitized. This conflicts with the requested metadata-only support export. **No automatic exfiltration found**: clipboard copy is explicit, and real keys inside an actual exception were not observed/claimed.

Reproduction: external `diagnostics/legacy-settings.test.cjs` extracts the actual function and supplies benign synthetic project/path/exception/UA/shell/model markers. All six appear in its output. **1/1 characterization PASS** proves the old behavior, not its repair. Settings replacement remains parent-owned. Do not add this historical witness to npm test or treat it as desired acceptance after replacement.

## Implemented

### `src/lib/diagnostics.ts`

- Pure `collectDiagnostics(raw?: unknown)` and `diagnosticsJSON(raw?: unknown)`. No store/backend/account/sync, network, persistence, clipboard or localStorage dependencies; only the known APP_VERSION constant.
- Fixed schema/keys, fixed enums/maps, strict booleans and nonnegative finite safe integer counts. No state traversal/spread, no coercion, getter/toJSON calls, input JSON parsing or raw string passthrough. Plain/null-prototype own data records only; cycles/unknown large graphs ignored; throwing/revoked proxies are contained. JS Proxy introspection traps can execute code supplied by an already-running caller; this is not a sandbox for malicious JavaScript. No getters/toJSON are deliberately invoked.
- Numeric semantic versions normalized, platform mapped to a fixed enum; APP_VERSION cannot be overridden by input. Optional bounded epoch millis becomes UTC; no generated current time or UA fingerprint.
- Counts saturate at 1,000,000; totalBytes at 1,000,000,000,000. Invalid/missing counters are null, not fake zero. Missing checks are not_checked. Hydration never synthesizes durability verified. Parent is responsible for supplying actual observations, not inferring health from backend availability.
- Optional sync input accepts captureSyncHealth result but selects only backend/disk/checkpoint enums, failedFiles/conflicts and truncated/canRetry flags. **No projectId, lastDiskCheckAt, context, path, scope or identity output.** Project checkpoint does not promote store durability or checks.sync to success.
- Serialization rebuilds the schema and enforces <=4096 ASCII bytes. Export does not accept a caller's purportedly sanitized object as authoritative.

### `src/modals/Diagnostics.tsx`

`<DiagnosticsModal collect={() => rawSnapshot} />`; collector is synchronous/read-only and parent-owned. Sanitized JSON is captured on mount/explicit refresh, previewed in a read-only textarea, and copied/downloaded only on user action. Copy/download use exactly the preview string; they do not re-read live data or upload anything. React development StrictMode may evaluate mount collection twice; collector must never perform checks/writes.

Collector failure disables export with fixed text; clipboard unavailable/rejection cannot report success or expose exception text; no silent execCommand fallback. Download message reports JSON preparation, not confirmed filesystem save. Clipboard is single-flight, refresh/download disabled while pending, modal remains closable; late resolve/reject after unmount cannot write UI state.

## Evidence / tests

```
TSX_DISABLE_CACHE=1 node_modules/.bin/tsx --test src/lib/diagnostics.test.ts src/modals/Diagnostics.test.ts
```

**19/19 desired regressions PASS** (12 pure + 7 component).

Privacy suite poisons EVERY string leaf individually and together, injects synthetic key/token/name/path/prompt/file/URL/error/log/UA/scope fields at EVERY record level, checks omission of unknown keys, null/inherited/accessor/proxy/cyclic inputs, non-finite/unsafe counts, caps, optional UTC, backend version/platform strictness, exact fixed keys and export-size bound. Sync witness confirms IDs/context/time absent and no upgrade to a global healthy status.

UI suite uses current component source + actual builder, controlled hooks/clipboard/download mocks: no clipboard/download at mount, exact preview export, explicit refresh, rejection/collection/download errors, double click and late unmount. No actual clipboard/network/browser involved. It is a compiler/component fixture, not browser DOM/accessibility acceptance.

Scoped ESLint for four new files: **0 errors/warnings**. Scoped TypeScript compiler diagnostics for those files: **0**. Logs: `diagnostics/tests.log`, `eslint.log`, `typecheck.log`, `legacy-finding.log`; source hashes: `diagnostics/tested-sources.sha256`. No formatter/format check/global check/build/browser/server/commit/push run.

## Parent integration / stable STOP

Exact field/enums/semantics contract: `/data/audit-next-tetrafree/diagnostics-contract.md`.
Test registration list: `/data/audit-next-tetrafree/diagnostics-test-files.txt`:
- `src/lib/diagnostics.test.ts`
- `src/modals/Diagnostics.test.ts`

Parent owns collector adapter, Settings legacy replacement, TitleBar/ModalRoot wiring and npm test registration. Parent should leave store durability and unobserved last checks at not_checked; never treat sync project checkpoint or token proof as global storage/key safety. Raw sync metadata may be supplied under `sync` only; there is no raw output spread.

Implementation does not itself inspect disk contents, validate real persistence, verify account/token proof or retry sync. No claim of whole-application/no-key-leak proof, native Windows runtime or browser acceptance. Production scope is stable; diagnostics owner STOP after handoff.
