# Agent audit / clone runtime isolation / bounded policy extraction

## Status: production STOP

Assigned scope is stable. No more production edits planned; parent/reviewer can hash against `agent-production.sha256`. AGENTS.md read in full, original audit and shared contracts consulted. Parent baseline is 3.2.0 / 20641ff; package showed 3.2.0, but `/data/baseexact` and Git metadata were not available to this worker. Exact initial owned sources were saved under `agent-baseline/` with `agent-baseline.sha256`; do not treat this as an independently verified Git checkout identity.

## Confirmed defects fixed (desired negative tests, not bad-behavior assertions)

1. N01: late cancellation/rejection of an old command retry could overwrite a replacement card's output. Retry owns the exact current card object, controller and origin. Patch ownership is updated before synchronous store observers are notified. Late callbacks cannot target a replacement/deleted card.
2. N02: selected project A→B→A could revive a pending retry. Store subscription aborts on first loss of the captured project/card; checks before launch, output and completion prevent late success.
3. N03/N04: stale recovery confirmation could authorize a changed proposal payload or changed revert before-image while disk/store files stayed equal. Approval now includes a snapshot of the relevant cards; callbacks bind captured pid, displayed cards and expected file images, and recheck all before applying/reverting. Existing CAS/recovery copies remain intact.
4. N05: a synchronous reservation/journal observer could call Stop-all, yet the engine still entered the model adapter. Added guard after reservation immediately before accounting/transport entry.
5. N06: automation approval revoked during asynchronous MCP bootstrap was not revalidated at the next dispatch. Engine AutomationExecution.allowed callback revalidates the currently approved hash/current enabled raw specification at effect boundaries.
6. N07/N08/N09/N10/N11: cloned projects preserving chat/message/part IDs collided in controllers, queued prompts, live-buffer cleanup, command retry locks/stop and stale recovery actions. Runtime keys now encode explicit origin tuples. Historical IDs and version references are not rewritten.

Evidence: `agent-red.log` = 6 failures / 54 passes; `agent-fix-green.log` = 60/60. `agent-clone-red.log` = 5 failures / 60 passes before runtime isolation. The N10 transport mock was then refined to exclude best-effort `/kill` requests from executable launches. Its final desired assertion was rerun against saved original engine source, with current dependencies and mocked transport: `agent-N10-refined-red.log` = 1 failed (only one launch instead of two). This is a focused component RED, not a complete baseline checkout run. Current final scoped run is green. Additional N12/N13 prove ambiguous partial retry stop is a no-op, and live cleanup without pid fails closed.

## Agreed runtime APIs

- New `runtimeKey(pid,chatId)` and `retryKey(pid,chatId,msgId,partId)` encode JSON tuples. They are ephemeral runtime identities only.
- Queue selectors: `queueFor(state,pid,chatId): readonly Queued[]`, `queueGet(chatId,pid?)`. Stable frozen empty selector. All queue mutation/control functions have optional pid last: enqueue(chat,text,atts,extra?,pid?), dequeue(chat,id,pid?), peek/shift/clearQueue(chat,pid?), queueGeneration(chat,pid?), moveQueued(chat,id,dir,pid?), prioritize(chat,id,pid?). **prioritize has no dir.** No-pid queue is an isolated legacy bucket, not selected-project fallback. clearAllQueues belongs to Stop-all.
- isRunning(chat,pid?), stopTurn(chat,pid?), retryCommand(chat,msg,part,pid?). stopRetry(part,pid?,chat?,msg?) acts only on a unique matching retry in the known pid; incomplete ambiguous identity is a no-op. Production consumers must pass full captured origin.
- Recovery optional pid at end: applyProposed(chat,msg,part?,picked?,force?,approval?,pid?), rejectProposed(chat,msg,part?,pid?), revertTurn(chat,msg,force?,approval?,pid?). An explicit stale origin cannot retarget the selected clone; recovery requires selected origin still matching.
- live.endChat(chat,pid?): unknown origin is a no-op; explicit origin does not clear clone buffers.
- submit(chat,text,atts,running,pid?), resolveSlash(chat,text,atts?,pid?) validate captured existing target. Engine/commands draft clears pass captured pid to domain setDraft; no direct drafts[chat] reads.
- loopFor(state,pid,chat), loopStop(chat,why?,pid?), loopActive(chat,pid?), loopNote(chat,note,pid?), loopPassEnded(chat,text,failed,pid?). Runner.send(chat,opts,pid?) and busy(chat,pid?) receive captured pid. Existing loopStart and loopLabel are preserved.
- Loops intentionally remain **single selected-project**, with strict stored-pid checks rather than a global map rewrite: same-chat second loop refused while original exists; switching away cancels original session/timer. Foreign stop/note/end cannot touch it, and stale preparation cannot revive after A→B→A. Internal map is not a public selector contract.

Parent and domain owner integrated UI adapters separately; this worker did not edit UI/domain/types files. Legacy engine/loop no-pid calls retain selected-project behavior for compatibility, not a safe cross-project identity contract. All owned production calls pass captured pid.

## Cohesive extraction / APIs and line counts

Characterization preceded extraction:
- fixed verification script priority, invalid package fallback and no filename interpolation;
- exact UTF-8 request reserve and 16,000 output cap versus independent length-based usage estimate;
- review-state precedence, counts, add/delete totals and previous/explicit version retention, including rejected/reverted/error mixes.

New `enginePolicy.ts` is a pure policy module with no runtime store/transport/timer dependencies:
- AUTOMATION_MAX_TOKENS (single source for wire cap and reserve);
- usageEstimate(accounting,outChars,modelId,local) replaces three duplicated accounting calculations;
- requestReservation(system,messages,local,prices) distinguishes unknown/invalid tariffs from known zero/local and preserves image allowance;
- verifyCommand(files,changed) selects only fixed npm script commands, never interpolates filenames.

New `turnPolicy.ts` owns pure reviewedTurn(parts,previousVersion?,version?) plus tally(files). Review classification is deliberately distinct from live-turn finish classification. Turn's public tally export remains compatible by re-export. Engine orchestration, liveLoop flow and transaction/recovery effects remain where they were; no redesign.

Measured engine: initial 1,256 lines; after lifecycle/isolation fixes but before extraction 1,305; final 1,235. **Extraction removed 70 engine lines; net versus original -21 after adding the isolation fixes.** Turn 392→389. New enginePolicy 50, turnPolicy 30, runtimeKey 6 lines. This is decomposition/testability, not a claim of reducing total repository code. New policy matrices use pure inputs; component characterization still exercises actual engine call sites.

## Verification and manifest

- Final scoped run: **154/154 passed**, 0 failed/cancelled/skipped (`agent-final-tests.log`). Nine explicit test suites listed in `agent-scoped-test-run.txt`, Node 22.23.3 + tsx. These are portable unit/component tests with mocked stores/providers/tool/exec transports, plus pure parser/queue/budget policies. No real shell, remote provider, targets, browser, Windows or billing test was executed.
- Changed registered test files: `agent-test-files.txt` (alias `agent-testmanifest.txt`). No new test file requires package registration. Existing harness changed: `src/agent/test-helpers/harness.ts` exports test-only seams and mock MCP-bootstrap gate; production public APIs unchanged except additive agreed pid/callback parameters.
- Scoped TypeScript program: 0 diagnostics in explicitly assigned source/test files (`agent-typecheck.cjs`, `agent-typecheck.log`). Not a whole-app build. Scoped eslint exact changed source/tests/helper: exit 0 (`agent-eslint.log`). No formatter/global check/build/browser/server/push/package/version/types edits.
- Pure/characterization checks before extraction: `agent-pre-extraction.log` 84/84; after accounting extraction 85/85; review classification characterized independently before its extraction (`agent-review-characterization.log`, 69/69), all included in final 154.

## Limits / non-claims

Danger remains heuristic, not a sandbox. AutoVerify standalone .js/.py checks intentionally remain unavailable without a safe structured-argv endpoint; fixed npm scripts remain available. Budget reservation/usage/cost remain estimates, never exact billing guarantees; unknown tariff fails closed for new automatic model requests when a limit is configured. Manual retry is a user-authorized shell action, not a newly introduced shell sandbox. Cancellation prevents further app dispatch/late writes; actual process-tree cancellation and Windows/provider behavior need native acceptance. Queue runtime state remains in-memory and retained inactive-project entries wait for a valid later dispatch. Protocol Markdown fences were rechecked with existing portable regression suite; no parser rewrite was needed here.
