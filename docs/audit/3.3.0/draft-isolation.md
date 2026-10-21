# Draft isolation — scoped fix, package 3.3

## Outcome
Fixed project-copy draft isolation without changing historical chat/message IDs, `Record<string,string>`, common types, persistence/index, or `PERSIST_VERSION`.

Owned production changes:
- `src/lib/chatDraft.ts` (new): explicit project/chat target validation; scoped draft keys; conservative legacy reads and explicit-copy recovery helper.
- `src/store/slices/chats.ts`: `setDraft(chatId,value,pid?)` writes only the validated project/chat key. Explicit missing/deleted pid never falls back to selected project. No-pid compatibility uses selected project only.
- `src/store/navigation.ts`: compose prefill reads/writes the captured project; focus event includes pid/chatId; stale intent refuses mutation.
- `src/workspace/Composer.tsx`: scoped reads/writes, current-origin send/event checks, old-draft recovery button, explicit captured runtime pid for queue/loop/send/stop controls.
- `src/workspace/ChatView.tsx`: scoped quoting without requiring a mounted Composer; current-origin guard, pid-bound focus; project/chat React keys reset Composer/Thread local state between clones; AgentTurn gets required pid plus project/message key; isRunning gets pid.

## Stable contract for other owners
`draftKey(pid,chatId)` is opaque (`draft:` + JSON tuple); use `readChatDraft(state,pid,chatId)` rather than raw indexing. New writers call `setDraft(chatId,value,capturedPid)`; engine/commands owner was informed and implements explicit pid at its call sites. Omitted pid exists for compatibility, not for async origin tracking.

Composer/ChatView runtime adaptation uses owner8155's agreed APIs: `queueFor(state,pid,chatId)`, `loopFor(state,pid,chatId)`, queue mutation final pid, `prioritize(chat,id,pid)` (no dir), `submit(...,pid)`, `stopTurn(chat,pid)`, `loopStop(chat,why,pid)`, `sendMessage(...,0,{pid})`, `isRunning(chat,pid)`. No direct q[chatId] reads. Existing send-now scheduling semantics retained; delayed callback carries original pid. Agent runtime implementation/tests belong to owner8155, not this change.

## Legacy/data handling
- Existing `drafts[chatId]` strings are not migrated, overwritten, deleted, or consumed.
- Absent a scoped entry, a legacy string is automatically read only when chatId has exactly one owner among current live projects. Ambiguous copied IDs show an empty editor, not another project's legacy text.
- A scoped empty string is an intentional-clear marker, preventing raw legacy from reappearing after clear or after another owner is deleted.
- Explicit “Скопировать старый черновик в этот чат” appends to the freshly read current target text. It never overwrites nonempty current text or clears raw legacy. Source attribution is unknown and described honestly in button title/toast. Stale callbacks cannot recover into another project/chat.
- Shape remains `Record<string,string>`; additive opaque keys need no version bump/migration. Older binaries will retain opaque entries but will not understand scoped draft semantics. No downgrade-writing guarantee is claimed.

## Evidence / RED -> GREEN
Initial actual-action regression: 9 cases, 7 fail / 2 pass before scoped setter, captured in `draft-red.log`.
Final: `tsx --test src/lib/chatDraft.test.ts src/store/navigation.test.ts`: **27 pass / 0 fail**, `draft-green.log`.
- Actual createChat + duplicateProject retain identical IDs and isolate A/B drafts.
- Stale A writer/input after switching B touches only A; deleted origin cannot fall back to B.
- Unique raw exact-byte preservation; ambiguous raw hidden; explicit recovery appends fresh text; stale recovery refuses; scoped clear never resurrects legacy.
- Actual Composer JSX/closures under inert hook/module mocks: textarea, stale send/onChange, recovery, origin deletion.
- Actual Composer with real queue module/store: B cannot display A queue; stale A remove preserves B queue; B send carries exact pid in opts.
- Actual ChatView MsgActions quote closure: stale A cannot quote into B; active B appends freshest scoped text; deleted origin cannot mutate copy; raw legacy intact.
- Navigation suite includes cold/warm lifecycle and event cleanup plus duplicate legacy/prefill and pid-bound event cases.

Scoped semantic/syntax TS diagnostics: **7 owned files, 0 diagnostics**, `draft-types.log` and reproducible `draft-typecheck.cjs` (includes ambient vite env; not a global project check).
Scoped ESLint: **pass**, `draft-lint.log`.
Scoped Prettier check: **pass**, `draft-format-check.log`.

## Test files / integration
New test: `src/lib/chatDraft.test.ts`.
Existing modified test: `src/store/navigation.test.ts`.
Exact manifest: `draft-test-files.txt` (also `testlist.txt`). Parent owns adding new test path to package test script; package/version/lock were not changed here.

## Limitations / findings
- No global check/build/format, browser/listener, Windows/WebView2/native acceptance, external network/model call, commit, or push was performed. UI tests execute real source with benign inert mocks; not browser E2E.
- Legacy map has no origin metadata: uniqueness is measured among live projects. Historical origin after deletion/import cannot be proven. Ambiguous current IDs require explicit copy, as agreed; legacy raw remains available.
- Compound encoding distinguishes pid/chat tuples. Existing generated chat IDs use the normal c-prefixed ID space; arbitrary crafted imported legacy IDs equal to the reserved scoped-key spelling are not separately migrated/versioned by this scoped patch.
- No unrelated UI action or persistence runtime was audited wholesale. Parent/agent owners handle their files and combined checks. Repository git metadata was unavailable during final optional diff inspection; no git operation changed files.

## Parent-requested fixture follow-up
Parent reported UI06/07 fixture rejects the new real navigation dependency. Added only actual `chatDraft` import/routing in `src/lib/editorLifecycle.ui.test.ts`; no no-op replacement, production behavior or assertions changed. That suite: **7/7 pass**, `draft-editor-fixture.log`, scoped Prettier pass. Manifest now includes this existing modified suite. Total separately executed suites: **34/34 pass** (27 draft/navigation + 7 editor lifecycle). Core TS scope remained seven owned files; no global diagnostics claimed.

## Independent D08/D09 follow-up — stable
Independent reviewer found two additional stale MsgActions callbacks: pin selected duplicate B from captured A; create-task copied A text into B and toast action opened in B. Minimal production follow-up restricted to `ChatView.tsx` MsgActions (plus now-unused getProject import removal): current selected pid/chat and existing human message with exact captured text are required; pin additionally checks captured pinned state and calls patchMsg with explicit pid; create-task calls saveTask with explicit pid and validates the created task; toast open rechecks source/current origin and original task existence.
New actual-source/real-slice tests: stale pin and valid B pin; stale task and valid A task; stale toast and valid original toast; removed task, changed/deleted message and deleted project. **RED 3/3 fail → GREEN 3/3 pass**, logs `msgactions-red.log`, `msgactions-green.log`. Combined draft/navigation **30/30**, scoped TS7 files0, two-file ESLint pass. Own-format completed before stable notification. Reviewer received STOP before edits and stable SHA for independent rerun. `msgactions-sha256.txt` records hashes; ChatView stable SHA256 `41847cbda2e0f30e0b31a2ef1f1074499825317a5f897a2a6ffaae1721c514ad`.

## Browser React sibling-key warning follow-up — stable STOP
Parent browser run found Thread and Composer siblings shared the same project/chat key. Minimal production correction changes only their key expressions to `thread:${draftKey(pid,chatId)}` and `composer:${draftKey(pid,chatId)}`; pid/chat remount semantics retained. New regression extracts the actual two sibling JSX elements from ChatView, transpiles their key expressions, checks sibling uniqueness, repeat stability, and distinct keys for both roles when project or chat changes. **RED 1 fail → GREEN**, `reactkeys-red.log`; combined draft/navigation **31/31 PASS**, `reactkeys-green.log`; scoped TS7 files0 and two-file ESLint pass. No browser rerun claimed here; parent reruns full checks/browser/independent acceptance after this change. Final production STOP SHA256 ChatView: `013819fc47e165aabb51a3b660e2a683283c27014a11b121c6a88f96ea971e7b`. No other production change in this follow-up.
