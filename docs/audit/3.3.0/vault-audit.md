# Fresh benign session/vault audit — post-3.2.0

## Outcome / stable handoff

**Owned scope STOP.** Baseline specified by parent: 3.2.0 `20641ff908166ac93d5c4afe6bf20c6ebd2218ac`, immutable source copy `/data/base`; working source `/data/tetrafree`. AGENTS read completely before editing. Runtime: **Node v22.23.3**, `/data/fix-tetrafree/node22/node-v22.23.3-linux-x64/bin/node`.

This is a **new audit**, not just the old 61-case run:

- **18 new independent-process actual-source session/vault scenarios**: 17 desired failures reproduced across audit waves, plus an already-passing delayed-old-logout control.
- **3 new token contract controls**: unchanged token, ABA/removal revisions, storage failure not rolling back runtime authority.
- Current final scoped suite: **86/86 PASS** = 21 new cases + 65 prior scoped identity/persistence/vault cases (including the eight actual mutation-slice coverage subtests).
- Owned TypeScript diagnostics **0**, owned ESLint **exit 0**, owned-only Prettier check **exit 0**.
- Eight changed-owned files unchanged from pre-test SHA through tests and static checks: `vault-before.sha256`, `vault-stability.log`.

Logs: `vault-final-tests.log`, `vault-types.log`, `vault-eslint.log`, `vault-format.log`. Source/fixture ownership list: `vault-owned-files.txt`. New test manifest: **`vault-newtestsmanifest.txt`** (`src/lib/accountAudit.test.ts`, `src/lib/token.test.ts`); helper fixture: `vault-fixtures.txt`. Parent must add the two test entries to package test; this owner did not change package scripts.

No main/App/index/Settings UI/backend/sync/version/package/lock changes by this owner. No global format/check/build/listen/browser/push. Only owned files were formatted. Other authors work concurrently; the SHA claim is **owned scope**, not a unified whole-project snapshot or global release gate.

## Audit method / evidence quality

`accountAudit.test.ts` spawns a **fresh Node process/module graph** for every scenario and runs real `account.ts`, `token.ts`, `vault.ts`, `vaultState.ts`, real Zustand store/slices, actual hydration, and the real registered `flushPersistence()`. Controlled in-process HTTP responses replace the transport; there is no real network, service/account, secret, exploit chain, or Windows claim. App persistence uses the real authority-marked localStorage fallback with an explicitly seeded valid versioned envelope. Minimal browser event shims allow the actual `initAccount()` storage handler to execute. Audit stdout contains the case name and desired PASS, not credentials.

The first harness attempt lacked `document.addEventListener` and was corrected **before accepting RED evidence**; that harness failure is not counted as a product defect. The saved `vault-audit-red.log` is the corrected actual-source run: **11 desired failures, 1 passing control**. It is not a characterization suite asserting the bad behavior.

Additional RED evidence:

- `vault-audit-second-red.log`: 3 further desired failures.
- `vault-audit-replacement-red.log`: checkpointed replacement lost on reauthentication, found during fix review.
- **`vault-audit-replacement-baseline-red.log`**: same replacement loss reproduced using an isolated copy of the untouched `/data/base/src` plus the audit fixture, with an actual changed session token. This establishes a baseline defect, not merely an artifact of the new epoch guard. Baseline source was copied, not modified.
- `vault-audit-exit-reentry-red.log`: 2 desired failures for login reentry during logout/expiry publication.
- `vault-audit-first-green.log`, `vault-audit-replacement-green.log`: intermediate fix checks. Only `vault-final-tests.log` is the final combined acceptance here.

## Confirmed issues and minimal fixes

| ID | Desired actual-source probe(s) / reproduced bad outcome | Fix |
| --- | --- | --- |
| VA01 | `token-aba`: A → B → A made the old request context/proof current again. | Add monotonic credential-free `getTokenRevision()`; session comparisons include it, as does vault runtime authority. |
| VA02 | `verify-order`, `verify-stale401`: older same-epoch `/auth/me` success overwrote newer profile; older 401 expired the newer successful verification. | Latest-started verification ticket; request relevance checked **before** processing HTTP errors/expiry. Old read success/error/catch cannot publish or expire the current result. |
| VA03 | `config-order`, `invite-order`: old reads overwrote newer config/invites inside the same session. | Separate latest-read tickets with the same private relevance-checked request helper. No server revision is invented. |
| VA04 | `proof-publication`, `reentrant-logout`, `signin-throws`, `logout-reentrant-login`, `expiry-reentrant-login`: new proof observable while root profile was old; publication failure left confirmed proof; login/exit continuation could overwrite an authority change caused by a synchronous subscriber. | Root `signIn` before proof/user publication; invalidate previous proof first; capture/recheck authority after publishing to either store. Logout/expiry recheck after clearing account before root signOut/toast. Superseded publication never starts resync or signs out a newer login. |
| VA05 | `null-token-expiry`: actual storage-removal handler left stale root authed/user when another path had already set the token null. | Remove early return; expiry always invalidates proof/epoch and clears account/root state unless superseded by a newer authority. |
| VA06 | `verify-restores-signin`: a valid same-profile session restored after logout proved account identity but left root `authed=false`. | Verification signs in when unauthenticated even when profile text already matches. |
| VA07 | `storage-stale-event`: queued remote token-removal notification erased a newer local login. | Actual storage handler compares the event payload with current localStorage before adopting it; stale events ignored. `storage.clear()` null-key events handled. Unreadable storage fails closed. |
| VA08 | `vault-provider-snapshot`: p1 SET pending; p2 changed; loop sent p2 OLD value with p2 NEW intent generation, falsely associating payload and authority. | Snapshot each key **with its generation**, before any await; revalidate current value, generation and context before/after checkpoint and before ACK. Obsolete items are recaptured rather than sent. |
| VA09 | `vault-session-epoch`: reapplying a session with the same token/account failed to invalidate a pending old vault GET. | Vault runtime authority includes account epoch and monotonic token revision. Durable scope remains backend/account only. |
| VA10 | `recovery-flight-rotation`: preparation for an empty/old journal was reused after token rotation + a new durable delete intent; newer call resolved without verifying/reconciling its authority. | Coalesce only matching scope/journal-generation requests. A newer authority waits for the previous flight to settle, then executes its own preparation. |
| VA11 | `vault-reauth-replacement`: after actual replacement flush/proof and while SET pending, same-account token rotation cleared NEW replacement and could send DELETE because immutable hydrated revision was older than the runtime checkpoint. | Metadata-only per-backend/account runtime proof of **already-flushed, already-journaled** replacement generation/revision survives token/epoch rotation. Fresh process still requires the real hydrated revision. A newer delete generation cannot inherit an old replacement proof. |

### Explicitly tested passing controls

- Old logout HTTP 401 after a new login still cannot expire/overwrite the new session (`old-logout-reply`).
- A same-value `setToken` call does not invent a revision change.
- Changed token, ABA, and removal advance revisions synchronously, including if the storage write throws.
- Prior vault desired tests remain green: failed DELETE + fresh process reload, orphan deletion, sticky tombstones, metadata corruption/quota/readback, stale ACK and ABA, account/backend isolation, strict startup checkpoint gate, token-only pure action guard, successful-login automatic gate release, replacement proof across process restart.

## API / integration contract

### Token

```ts
getTokenRevision(): number
```

Starts at 0 per process, synchronously increments only when `cur !== next` **before** storage write. A → B → A is two increments; same token no increment; failed localStorage persistence does not roll back runtime authority. Numeric metadata only. It does **not** claim the bearer itself was durably stored. Backend/sync owner was notified and integrated this API independently; their files were not edited here.

### Account

`captureSession()` retains epoch/token/base and adds `tokenRevision`. Consumers must capture contexts through this function, not reconstruct an old three-field context or persist it. Such incomplete contexts fail closed. `api(method,path,body?)`, `applySession`, `verifySession`, `confirmedAccountId`, and recovery-mode public APIs retain their external calling forms. Relevance callback is a **private** request detail, not an exported bypass.

`confirmedAccountId()` remains exact-session verified identity, not `checked` or user presence. Newly confirmed proof is published only after root signIn succeeds; after every subscriber-visible publication, a changed context stops the old continuation. Recovery mode still suppresses account-triggered resync.

### Vault

`configureVaultIdentity(resolve, hydrated?, sessionEpoch?)` gains an optional third callback; existing two-argument users remain supported. Runtime cancellation scope includes token revision and epoch; **no raw token/revision/epoch was added to the durable outbox**. `prepareVaultRecovery()` remains Promise<void>, and `vaultStartupBlocked()` remains a pure fail-closed action guard with stable subscription-driven React snapshot unchanged.

VA11 does not replace proof with `current > hydrated`: the runtime replacement proof is set only after real app flush, current value/generation revalidation, and durable metadata readback by the existing replacement preparation path. It contains only scope, provider ID, generation/revision. Persisted app/outbox schemas and global store version are unchanged.

## Code-reviewed boundaries (not new acceptance claims)

- Logical localStorage readback/root checkpoint is not fsync or physical power-loss proof. The journal/app snapshot remain separate records. A replacement interrupted **before** its proof commit can still conservatively require re-entry; the patch does not put a secret in metadata to bridge that gap.
- Multiwindow localStorage read-modify-write is not cross-process atomic CAS; no locks/coordinator were added. Cross-window notification ordering is tested, not arbitrary simultaneous journal writers.
- Token persistence intentionally remains best-effort as before; runtime revision correctness when storage fails is tested, durable login survival under quota is not promised.
- Vault server tenancy is not redesigned: client intents are account/backend scoped, but server device/OS-user vault isolation was not audited here.
- The transport has no newly added universal timeout/cancel protocol. An indefinitely pending body/network operation can keep its preparation pending; new transport deadlines and UI cancellation are not accepted by these fixtures.
- Vault directly fetches secrets and its scope binds URL/token/account epoch. Capability/status/locality flips at an unchanged URL were **not separately exercised in this owner audit**. Backend owner has an independent context audit; do not infer that its transport guards automatically cover vault's direct fetch.
- Generic provider import/restore writes bypassing settings intent recording, arbitrary historical app snapshots after already-completed startup recovery, and external manual deletion of metadata are not fully covered. No claim that intent can be inferred safely from such writes is made.

## Not verified

Real Windows/WebView2, DPAPI/native vault, real auth/OAuth/MFA/SMTP, physical crash, simultaneous windows/journal writers, actual server account isolation, native close/OS shutdown, full application integration/global test/build, and production deployment. Parent owns those gates and other source scopes. No claim of “no remaining bugs” or global release acceptance.
