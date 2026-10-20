# Sync / metadata repair handoff

## Scope and status

Owned changes only:
- `src/lib/sync.ts`
- `src/lib/team.ts`
- New `src/lib/teamMetadata.ts`, `src/lib/syncRecovery.ts`
- New `src/lib/sync.test.ts`, `src/lib/team.test.ts`, `src/lib/teamMetadata.test.ts`

Read `AGENTS.md`, both 3.1.4 storage/domain audits, `/data/fix-tetrafree/contracts.md`, persistence API notes and server CAS notes. No edits to backend.ts, server, domain slices, types, package/version/release files. No push, browser, global formatter/check/build. Other owners' shared-computer changes were not reverted.

`sync-test-files.txt` lists the 3 new tests; the same missing entries were appended (not replaced) in shared `test-files.txt` for parent integration. Package.test registration belongs to parent.

## Fixed IDs / exact behavior

- **ST06 / S06** — compare-before-delete runs for drop-only and mixed pull/drop passes, inside the synchronous current-project mutation. A local edit during hashes/read survives; its old baseline remains. Pull accepts only string content whose actual `fnv` equals the scan hash. Project-folder/backend/token changes and explicit forgetBase generation invalidate an in-flight pass.
- **ST07 / S07** — before a conflicting overwrite OR delete, read the foreign disk text, compare to scan, put it under an unoccupied `.disk-conflict[.N]` project path, and await `flushPersistence()` before the destructive batch. Unreadable/missing/read-scan mismatch defers that path; no destructive operation for it. Checkpoint failure aborts destructive work. Identical pending recovery copies are reused on rejected-checkpoint retry rather than growing every poll. Warning no longer promises that uncommitted foreign data is in Git/history.
- **CAS contract integrated** — `bBatch(p, write, remove, dirs?, expectedHashes?)`; fifth argument contains every planned file write/removal, null for scanned absence. Uses actual backend `fnv` (JS string code units + length, identical to existing hashes contract; not a cryptographic/raw-byte hash). Response remains `{failed?: {path,code,error}[]}`. `code==='CONFLICT'` does not acknowledge the planned content, does not install badPaths suppression, and queues a fresh scan. Other successful paths retain partial-success functionality. Successful directory operations only are tracked.
- **ST08 / S08** — wire remains bounded to the last 80 messages, but a received window is never treated as a full local chat snapshot. Union by message ID preserves the local prefix even when local equals ancestor, ancestor is absent, or an older sender returns a shorter window. Local order is sorted by message time after merge. No implicit message deletion due to absence.
- **ST09 / S09** — removed global JSON reviver. Convert only typed person references: Doc.createdBy, human Actor.id (chat creator/task assignee), human Message.author, task Comment.by, LineComment.by. Literal prose/title/block text, filenames, agent names, Memory.by and Version.author (display names), IDs of non-person entities remain untouched.
- **ST11 / S11 merge side** — fields merge independently of stamp winning. Remote memory text/chat rename with old/equal stamp survives independent local metadata edits. Memory.at and Chat.lastAt are merged as mutation clocks (max), not whole-record selectors. Domain owner supplied monotonic mutation timestamps in slices; those slices were not edited here.
- **ST18 / S18** — `.cloud[.N]` fallback reserves all local files, incoming remote filenames, baseline names and directory targets before choosing a copy. Windows-style case and trailing-dot/space aliases are considered. File-parent collision flattens the recovery filename instead of an infinite retry. Existing directories permit recovery children. Previously existing `.cloud` files are not overwritten, including remote keys processed later.
- **D07** — additive optional wire metadata payload in cloud Base enables three-way structural merge: independent task fields, document blocks by ID, subtasks/comments, messages and line-comment fields. Independent block insertions retain common-anchor position; incompatible reorder/field/delete-edit overlap is an explicit conflict, not whole-object LWW. Unknown old checkpoint ancestor also takes the conflict-copy route. Both versions remain represented: local-oriented merged primary plus visible remote conflict copy, and a local copy as well when the merge selected remote fields elsewhere. IDs are collision-checked/deterministic; task key repair does not cause endless duplicate conflict copies. Doc conflict copies deliberately clear `file` so Markdown mirroring cannot overwrite the original document file. Project scalar conflicts are retained in a uniquely named `metadata.cloud.json[.N]` file. User sees a conflict toast.
- **ST14 / S14 partial integration** — every cloud/disk baseline advance awaits real persistence.flushPersistence(), including invite publication, invite acceptance and running-chat read path. Rejection/unavailable API never advances baseline or ancestor. Disk write and cloud PUT/checkpoint generation drift preserves newer local content and keeps the old checkpoint. Missing/corrupt cloud checkpoint forces since=0/full fetch rather than treating current edits as a common ancestor. Late cloud errors after a changed account/project/backend context do not detach the replacement project.
- **ST10 / S10 and D01** — delegated to domain owner (detach duplicate/import identity and project-context actions). Not claimed as independently implemented in this slice. Existing invitation/member/presence/history/deploy behavior retained; unrelated API shapes were not changed.

## Tests and evidence

Final targeted run: **32/32 passed** (9 disk sync, 10 actual cloudNow integration, 13 pure metadata/recovery cases).

```
./node_modules/.bin/tsx --test src/lib/sync.test.ts src/lib/team.test.ts src/lib/teamMetadata.test.ts
./node_modules/.bin/eslint src/lib/sync.ts src/lib/team.ts src/lib/teamMetadata.ts src/lib/syncRecovery.ts src/lib/sync.test.ts src/lib/team.test.ts src/lib/teamMetadata.test.ts
```

- `/data/fix-tetrafree/sync-tests.log`: final 32/32 scoped run.
- `/data/fix-tetrafree/sync-lint.log`: scoped eslint, no diagnostics.
- `/data/fix-tetrafree/sync-typecheck.log`: TypeScript compiler program rooted in the seven owned files, reports diagnostics **only in owned files**, 0. Not a repository-wide typecheck.
- Prettier ran only on the seven owned files.

Tests run the real reconcile/cloudNow/store + controlled fetch and checkpoint callback. The checkpoint seam explicitly snapshots store state or rejects/gates it; these integration tests are NOT native IndexedDB/real network/Windows filesystem/crash E2E. Node hydration uses an explicitly revisioned test-only LS authority snapshot. Initial interim harness failures were fixed; final log supersedes them. Existing merge3 tests are untouched; parent may run its full suite after handoff.

Regressions include: drop-only await edit; mixed read/delete edit; hash/read mismatch; unique durable foreign recovery before batch; expectedHashes forwarding; CONFLICT partial failure; reject checkpoint; batch-generation drift; folder switch; repeated failed-checkpoint recovery; 100-message local vs 80-window and shorter-old-client windows; typed-ID roundtrip; real metadata fields/blocks; unknown-baseline conflict copies; Windows alias/future incoming target preservation; failed checkpoint after successful PUT; newer edit during PUT; missing base since=0; running chat read failure; conflict task ID/key dedup; delete-edit/tomb conflicts; independent block insertion anchors; independent memory field changes with different clocks.

## New findings addressed while implementing

1. Treating current project as the ancestor when cloud checkpoint is absent suppresses initial edits. Replaced with full fetch and conservative conflict copies.
2. Same stale cloud 404 could detach a newly attached/replaced context; error effects now require matching context.
3. Mixing directory names with occupied-file ancestors in the unique-name helper could loop forever for normal `src/file` conflicts. Directories are separate; parent-file collision flattens. Both regressions added.
4. Repeated quota failure could add identical `.disk-conflict.N` every poll. Existing safe equal recovery copies are reused, regression added.
5. Renumbering a task conflict copy could defeat its deterministic dedup. Derived key/updatedAt repair is ignored for comparing an existing task copy to that exact source copy.
6. Chat root-level ancestor fast path could bypass message-window union on a shorter old-client payload. Window-aware merge now precedes that shortcut.
7. A doc conflict copy retaining its original mirrored `file` would risk mirror overwrite. Conflict doc copies no longer share that file path.

## Remaining limits / do NOT claim atomic safety or zero data loss

1. **No shared transaction/journal across Zustand durable snapshot + tf-sync/tf-cloud localStorage baselines + cloud ancestor texts + server/disk.** Persistence owner added its own state-authority journal, but that is not a sync outbox/checkpoint journal. Awaited ordering + runtime generation/context checks close the reproduced state-before-baseline case; they do NOT prove arbitrary crash/reload/cross-window correctness. Incomplete/legacy checkpoint migration is conservative when base is absent, but there is no exhaustive crash recovery state machine.
2. Server CAS is **in-process project-lock/CAS only**, per server handoff. An unrelated editor/process can write between server hash check and filesystem mutation. This remains a real unclosed data-loss race for the newest foreign edit. Client preserves the scan-verified text, not bytes changed later. Do not market this as an OS-atomic compare-and-swap or durable write-ahead journal. Directory operations do not have file-content CAS.
3. Recovery is for the backend's existing UTF-8 TEXT contract, not a byte-exact backup of arbitrary binary/non-UTF8 encodings. read/hashes decode to strings; this client cannot recover original undecodable bytes. FNV has collisions and is not cryptographic. Native invalid-encoding/large-file/fs failure tests were not run.
4. Baselines/metadata ancestors are still stored in localStorage. Large docs/images or quota can reject the richer checkpoint; cloud error is exposed and baseline remains old, but repeated work can require freeing space/export. No hidden eviction of the ancestor in exchange for claiming a safe checkpoint. Recovery copies consume real project/cloud quota. No automatic pruning of conflict copies was added.
5. Cloud chat transport still sends only 80 messages: existing local history is preserved, but a **newly joining device does not receive older history from the server**. No cursor/pagination/server archival protocol in this scope. Absence is not a chat-message deletion protocol; explicit message tombstones remain future work.
6. Metadata merge is not CRDT. Plain string/non-ID arrays (labels/tools/table rows etc.) concurrently changed on both sides use conflict copies, not semantic element merge. Concurrent incompatible record reorders also use copies. Copies need user review; same-clock/no-ancestor ambiguity may produce conservative extra copies instead of guessing. Top-level removals require tombstones; retained 90-day tomb expiry may still resurrect very old offline data.
7. Existing badPaths suppression for non-CONFLICT failures (e.g. EPERM) remains until content changes/restart; not repaired as part of these IDs. Cross-window global store writers and metadata/user-ID schema fuzzing were not proven safe.
8. No Windows/Tauri/native IDB unload, real power loss, multi-WebView, live two-member server, real filesystem/binary test, browser run or repository-wide check/build performed by this owner.

Parent should integrate new tests into package.test, run global check/build only after all owners have stopped, and retain the above limits in release/repair notes. Especially do not state that all uncommitted working-tree versions are now in Git or that external-writer CAS is atomic.
