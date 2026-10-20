# Post-rollback exact persistence restoration

## Scope / метод

После сообщения об откате среды проверены текущие own files и contracts.md. Частичный generation API уже был в rollback-копии; runtime API, chats publish и поздние tests отсутствовали. Vault ABA generation/intent/settings и его tests сохранились, не переписывались.

Сохранены исходные rollback-копии: `persistence-rollback-before/{persistence.ts,index.ts,persistence-durable.test.ts}`.

Восстановлены **только** мои:
- `src/store/persistence.ts`: runtimeReader/export capturePersistenceRuntimeRevision, third callback register, adapter runtime counter, increment на reserve while writable, reset при successful completeHydration;
- `src/store/index.ts`: registration runtime reader, chatsActions(publish), остальные 7 slices/public API уже были publish;
- `src/store/persistence-durable.test.ts`: точные поздние generation/runtime/chat/all8-slice tests из собственной истории tool patches, включая окончательную ES2021-safe `.messages.slice(-1)[0]` вместо `.at`.

После локального Prettier только этих 3 файлов SHA **фактически вычислены**, а не подобраны. Все три результата точно совпали с ранее сохранёнными финальными SHA из истории сессии:

```
85c6268e6a46ef6c323b24083f29239d9ff471049279a5113cb5cd969a73dfac  src/store/index.ts
24ef4a9d8180cf2c3b33c30b313721d105c0890f0d94035bc7b81baeee975be2  src/store/persistence.ts
fdfee7620b3209d2781ca7b4cb519b93a647830aed9162854628509ae7dbd93e  src/store/persistence-durable.test.ts
```

Manifest `persistence-restored.sha256`, также восстановлен `persistence-slice-coverage.sha256`. После нового тестового прогона sha256sum -c дал **3/3 OK**. Production source больше не изменяется; stable restoration handoff передан parent, sync owner и reviewer.

## Новый post-rollback verification (не исторический PASS)

Owner runner: **Node v24.14.1** (`persistence-restored-node.log`). Финальный Node22/global run — отдельная работа parent, здесь не заявляется.

1. Полный собственный scoped набор: **80/80 PASS**, 0 fail/cancelled/skipped.
   - `persistence-restored-tests.log`
   - настоящие store/actions/middleware/flush, controlled in-memory IDB/fetch;
   - selected envelope, migration N→N+1 vs hydratedN, failed write no fake proof, subscriber ordering, runtime0 при storage/migration/flush, actual chat-only, all8 slice paths, vault ABA и предыдущие regressions.
2. Chat-only отдельным свежим процессом: **1/1 PASS** (`persistence-restored-chat-fresh.log`): createChat, renameChat, pushMsg реальны, runtime >0 перед notifications, state меняется и действительно flushes.
3. Scoped ESLint restored 3 files — **0 ошибок**, пустой `persistence-restored-eslint.log`.
4. Scoped owned TypeScript diagnostics — **0**, `persistence-restored-types.log`, проверяющий сохранённый `check-vault-aba-types.cjs`.
5. Source/test SHA после проверки — все **OK**.

```
./node_modules/.bin/tsx --test src/store/persistence-durable.test.ts src/store/persistence.test.ts src/store/snapshots.test.ts src/lib/docplan.test.ts src/lib/merge3.test.ts src/lib/vaultState.test.ts
./node_modules/.bin/tsx --test --test-name-pattern='^runtime coverage: actual createChat' src/store/persistence-durable.test.ts
```

## Reports восстановлены

- `persistence-generation-api.md`: generation/runtime contract и fresh replay guard.
- `persistence-slice-coverage.md`: реальный chat bypass и all8 coverage.
- `persistence-generation-test-files.txt`, `persistence-slice-coverage-test-files.txt`: оба указывают на существующий persistence-durable.test.ts; новых test files нет.

Сами отчёты реконструированы по истории с честным разделением прежних и новых результатов; byte-identical предыдущих report-файлов не заявляется. Исчезнувшие старые before/acceptance логи не фабриковались. Предыдущие independent25/172 — **исторические**, не новый post-rollback safety verdict. Reviewer восстанавливает exact fixtures и снимает свежий unified snapshot после stable sync restoration.

## API contract

- `capturePersistenceGeneration():{current,hydrated}` — current issued/reserved watermark, не durable proof; hydrated actual selected supported durable envelope revision и не меняется от migration/set/flush.
- `capturePersistenceRuntimeRevision():number` — root-only coarse mutation counter: successful hydration starts0; runtime reservation до публикации increment; plain storage writes/migration/flush не increment.
- Fresh authoritative redo требует **hydrated < journal.appRevision && runtimeRevision === 0**. При older hydrated + runtime>0 — preserve live, visible desired/prior recovery JSON, 0 outgoing/no clean advancement. hydrated>=journal target — obsolete/no replay. Missing legacy proofs — fail closed/recovery, не value comparison.
- Все8 slices **ui/projects/files/chats/docs/tasks/settings/memory** и public api.setState используют publish. Core hydration set не является runtime user mutation.

## Remaining / честные границы

Не менял main/HMR, account/backend, sync/team/их fixtures, package/version/types/lock, Node22 integration или чужую документацию. GitHub push/коммит не выполнялся. Global check/build/browser/global formatter не запускались.

Эти tests — не browser-IDB/Windows/WebView2/DPAPI, не power-loss/OS fsync и не multiwindow guarantee. Outbox durable vault delete intent после remote-delete-failure + process reload остаётся честно pending. Whole sync replay acceptance принадлежит независимому reviewer, не подменяется owner80.
