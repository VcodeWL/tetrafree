# Independent review — background operations centre

## Outcome

**Accepted at POSTFORMAT STOP with no active findings.**

The final reviewed bytes match `/data/ops-tetrafree/postformat.sha256`. The
independent external fixture suite passed **17/17** with no failures, skips, or
cancellations.

This was a read-only production review. No repository source, repository test,
configuration, package, or generated production file was changed.

## Findings

### Active findings

None.

### Closed during review

The initial projection copied and scanned each chat's complete message history
on every one-second poll, even for an idle chat with no live control. It also
hashed every project ID on modal mount. This was an availability/performance
boundedness issue, not a data disclosure or dispatch issue.

The final source fixes it:

- the latest agent message is inspected only when a live turn control exists;
- at most the last 20 messages are inspected;
- stage and progress inspect only the last 50 parts per pass;
- project identity hashing is capped at the first 500 projects.

Independent final regressions confirmed:

- an idle 5,000-message chat caused **0 iterator reads** outside the bounded
  history window;
- a live chat read only message indices in the final 20-message window;
- stage/progress read only part indices in the final 50-part window.

## Final source identity

The repository has no usable Git commit identity for this review, so acceptance
is bound to exact SHA-256 values:

| File                          | SHA-256                                                            |
| ----------------------------- | ------------------------------------------------------------------ |
| `src/agent/operations.ts`     | `fc377189381c9e0154c29bc4dbeacc7aa70ba30203bf1cec46c3b63a69ae8356` |
| `src/modals/Operations.tsx`   | `18c6ef12fc6d90fa7b1aeadd07342b1a75f9e44dbc1c750041b6b84d672a96d3` |
| `src/agent/engine.ts`         | `33cac0e6ceb5386af43dc663ec34c9325b8e161d84f467d0e4cf03510269f524` |
| `src/agent/ci.ts`             | `b3a4d5b794b84d997cc1becf9198927d353f523ca91cc61d4b16f31a2175666c` |
| `src/components/TitleBar.tsx` | `d51487051f614644755b64ad9ad1fcf19be7c9954deaf3d42dfd6b0992df84f6` |
| `src/modals/ModalRoot.tsx`    | `ff0749a5e2efba218aa9810c7caa4d2c19690bcd92ba30e31379b7acef42d73c` |
| `src/modals/Palette.tsx`      | `3cfcf77ce038d9e6fd277d70d5c938510fc4751100d2954c66ca6ee03573eff9` |

Supporting source hashes are recorded in
`/data/ops-tetrafree/review/reviewed-sources.sha256`.

## Boundary review

### Projection and source ownership

- Projection and modal mount/polling do not dispatch, resume, cancel, or retry
  work.
- Runtime rows carry the captured project ID; historical chat IDs in another
  project do not retarget controls.
- Missing live controls turn persisted `running` state into an attention/orphan
  row rather than pretending execution continues.
- Queue confirmation captures the exact queue array. Deletion or queue
  replacement invalidates the action; newly added items are preserved.
- Loop cancellation captures the exact loop object and checks that the source
  chat still exists.
- Sync retry checks project selection plus backend-context and token revisions
  before dispatch and again after the awaited operation.
- Automation retry requires the exact terminal journal record and existing,
  selected source project. It remains explicitly confirmed.

### Runtime cancellation controls

- `engine.captureTurnControl(chatId, pid)` is explicit-project and read-only.
  Cancellation rechecks the exact controller/timer and the original
  chat/message/start-time ownership anchor.
- Deleted or replaced chats/messages, changed `startedAt`/`createdAt`,
  replacement controllers/timers, and repeated cancellation all invalidate a
  captured handle.
- Individual turn cancellation removes only the captured queued timer, stops
  the exact project/chat loop, and aborts only the captured controller. It does
  **not** clear queued prompt objects.
- Cleanup ordering does not delete a replacement controller inserted by a
  synchronous observer.
- `ci.capturePipelineControl(pid, runId)` checks the exact active project, run,
  and controller. A stale handle cannot abort a replacement pipeline.
- `engine.captureRetryControls()` exposes only project/chat/message/part
  metadata for actual registry entries. Cancellation is one-shot, rejects
  stale registry/card ownership, and remains `stopping` until unwind.
- Standalone retry rows do not expose command or output payloads.

### Truthful status and history

- `stopping` is presented as “cancellation requested,” not confirmed process
  termination.
- Pipeline copy explicitly does not claim the native process tree has stopped.
- Quiet-for-two-minutes is advisory observation, not a hang diagnosis.
- Terminal chat history explicitly does not prove file persistence, review
  completion, checkpoint success, or cloud synchronization.
- Pipeline logs and queued prompt text are not serialized into operation rows.
- Output is capped at 250 rows; large project/chat scans, recent message
  history, message parts, pipeline runs, automation journal, and project hashes
  have explicit bounds or existing bounded registries.

### UI and entry points

- Destructive queue clearing requires explicit confirmation; dismissing the
  confirmation has no effect.
- Actions are single-flight.
- A late promise resolution or rejection after unmount performs no state write.
- A late result from an old project scope does not render a notice in the new
  scope.
- Exceptions are replaced with fixed user-facing text rather than echoed.
- TitleBar, ModalRoot, and Palette all route to the same `operations` modal;
  opening it does not trigger work.

## Independent evidence

Command:

```text
node --test /data/ops-tetrafree/review/review.test.cjs
```

Result:

```text
tests 17
pass 17
fail 0
cancelled 0
skipped 0
```

Artifacts:

- `/data/ops-tetrafree/review/review.test.cjs`
- `/data/ops-tetrafree/review/tests.log`
- `/data/ops-tetrafree/review/tested-sources.sha256`
- `/data/ops-tetrafree/review/reviewed-sources.sha256`

The fixture uses TypeScript transpilation to execute the current production
projection/modal and the actual current control function bodies with controlled
stores, timers, and controllers. `fetch` is installed as an assertion failure.
It does not reuse author assertions or test helpers.

## Limits

- No browser, server, listener, network, native process, provider, build,
  formatter, global test, global typecheck, or push was run by this independent
  review.
- Full `runTurn`, backend execution, and native process-tree termination were
  not exercised. The accepted contract is an abort request and truthful
  `stopping` state, not proof of operating-system process termination.
- Author-reported targeted tests, lint, and whole-project TypeScript results
  were observed but were not substituted for the independent 17-test run.
