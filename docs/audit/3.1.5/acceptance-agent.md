# TetraFree — FRESH независимая приёмка после rollback

## Текущий FINAL VERDICT: PASS в проверенном agent/sync scope

**Свежий результат после rollback: до форматирования — 25/25 desired и 172/172 scoped regressions PASS; после последующего parent global-format — ещё один НОВЫЙ 25/25 desired PASS на окончательных bytes.** Во всех этих запусках 0 fail/cancelled/skipped. 172 regressions повторены после restoration, но НЕ повторены после форматирования; parent Node22/global gate выполняется отдельно. Исторический pre-rollback PASS здесь не переиспользуется.

Исходные **F01–F06** и найденные при acceptance **A01–A04** закрыты проверенными desired invariants на новом snapshot. Открытых подтверждённых findings данного аудита на нём не осталось. Это не release/Windows/power-loss/global-check acceptance.

## Последняя post-format проверка текущих bytes

Parent после свежего 25/172 прогона применил global formatting. Для exact-current evidence снят **ещё один** manifest и заново выполнены все 25 desired tests:

- Snapshot: `reaudit-agent/postformat-verified-snapshot/manifest.json`, timestamp **2026-10-20T17:38:23.621077+00:00**.
- `reaudit-agent/postformat-verified.tap`: **25 tests / 25 pass / 0 fail/cancelled/skipped**, duration 5145 ms.
- `reaudit-agent/postformat-verified-stability.json`: productionChangedDuringRun=[], fixturesChangedDuringRun=[], originalWitnessChanged=[].
- Отличия от rollback-verified snapshot перечислены в `postformat-source-delta.json`: 11 source/test файлов. Parent заявил formatting-only; окончательный desired PASS получен непосредственно на этих новых bytes, а не выведен из этого заявления.
- Ниже source-пути/строки и 172 regression evidence относятся к явно сохранённому **pre-format rollback-verified snapshot**. Окончательные строки можно проверить в postformat snapshot; форматирование сдвинуло часть agent-строк.
- Parent global654/check/build Node22 — отдельный gate; этот аудитор его не запускал и данным verdict не подменяет.

## Отдельно: история и восстановление evidence

Ранее в transcript действительно были 25/25 и 172/172 PASS (в частности session events 577/588/597). Их финальные файлы/snapshot 14:10 утрачены при rollback и **НЕ используются как evidence нынешнего PASS**. Доступные pre-rollback журналы 13:56 и старые snapshots остаются историческими.

Внешние fixtures восстановлены поверх сохранившейся базы 13:56 точным воспроизведением fixture-only Python bodies из history events **399,405,438,515,527,545**. В event527 историческое добавление текста finding в report не выполнялось; воспроизведены только fixture-изменения. Оригиналы базы и replay bodies: `reaudit-agent/rollback-1356-fixtures/`. Provenance с SHA source-result/patch/fixtures: `reaudit-agent/restore-fixtures-provenance.json`. После replay сохранены все 25 случаев; original bad-behavior witnesses и harness не менялись.

## Новый snapshot, logs, SHA

- Snapshot time: **2026-10-20T17:35:55.276705+00:00**. Полная копия 51 production/test файла + 4 внешних fixtures: `reaudit-agent/rollback-verified-snapshot/manifest.json`. Номера code-строк ниже относятся к этому срезу.
- Перед snapshot отдельно сверены **6 фактических SHA** с handoff владельцев: index.ts, persistence.ts, persistence-durable.test.ts, sync.ts, team.ts, syncJournal.ts — все совпали.
- `reaudit-agent/rollback-verified.tap`: **25/25 PASS**; duration 5294 ms.
- `reaudit-agent/rollback-verified-regression.tap`: **172/172 PASS**; duration 18980 ms.
- `reaudit-agent/rollback-verified-stability.json`: после обоих прогонов sourceChanged=[], fixturesChanged=[], originalWitnessChanged=[]. Повторная проверка также выполнена перед финальной записью verdict.
- Машиночитаемый итог: `reaudit-agent/rollback-verified-verdict.json`.

Runner данного аудитора — Node24.14.1, tsx. Parent выполняет свой Node22/global-check отдельно. Проверки выполнялись из `/data/tetrafree`:

```sh
TSX_DISABLE_CACHE=1 ./node_modules/.bin/tsx --test /data/fix-tetrafree/reaudit-agent/acceptance.test.ts
TSX_DISABLE_CACHE=1 ./node_modules/.bin/tsx --test /data/fix-tetrafree/reaudit-agent/acceptance-lifecycle-regression.test.ts src/agent/protocol.test.ts src/agent/queue.test.ts src/lib/backend.exec.test.ts src/lib/sync.test.ts src/lib/team.test.ts src/lib/teamMetadata.test.ts src/lib/syncJournal.test.ts src/lib/merge3.test.ts src/store/persistence-durable.test.ts
```

Использован внешний lifecycle-copy с redirect imports на реальные production modules и внешний harness. Original engine lifecycle harness напрямую не запускался: он пишет bundles внутри src. Наши bundles находятся только вне проекта. Все transport/storage adapters in-memory; дочерние Node processes не поднимают приложение/listeners и не выполняют shell/MCP/web tools.

## F01–F06: текущая независимая матрица

| ID / исходная severity | Current code evidence | Desired evidence (`acceptance.test.ts`) | Verdict |
|---|---|---|---|
| F01 HIGH — repeated-edit stale input/CAS | `src/agent/engine.ts:967`, `turn.ts:146–162`, beginEdit пинит вычисляемый input и CAS; pending chain остаётся proposal | :82 human prefix; :93 human deletion; :102 partial stream pin; :113 dependent proposal | PASS |
| F02 HIGH — cloud ACK vs local undo | `src/lib/team.ts:773–825`: prepared/accepted/local journal отдельно от clean checkpoint | :192 file+metadata undo; :244 old-snapshot recovery; :274 lost response; :335 actual late-durable ABA; :383 actual old checkpoint | PASS |
| F03 HIGH — disk ACK vs local undo | `src/lib/sync.ts:342–379,477–508`: accepted paths/dirty intent сохраняются независимо от clean baseline | :200 undo; :215 restore during remove; :257 restart; :281 lost response; :352 real late-durable ABA; :396 real old checkpoint | PASS |
| F04 MEDIUM — Markdown container fences | `src/agent/protocol.ts:24–48,71–94`: container-aware literal ranges, отдельно explicit file-header fallback | :123 blockquote/list; :128 nested/partial/tilde/tab/long fences; outside benign read + fallback | PASS |
| F05 MEDIUM — isolated empty dirs | `src/lib/team.ts:640,768–778`, `syncJournal.ts::mergeDirs`: dirs/request membership входят в merge/PUT | :228 isolated mkdir/rmdir + remote add/delete; :306 uncertain mkdir undo | PASS |
| F06 LOW — unhandled fireAuto rejection | `src/agent/autorun.ts:82–116`: supervised inner, controlled failure, finally lock release | :140 digest failure/retry/no private diagnostic; lifecycle runtime/reporting failure checks | PASS |

Queue/fileguard/projectfs/Turn abort/lifecycle и backend bExec/bBatch также покрыты scoped regressions: transport cancellation/invalid EOF/partial CONFLICT не принимаются за успешный ACK. Это не доказательство остановки реального Windows process tree или atomic OS CAS. Отдельного `cloudMerge` файла/символа в проекте нет; проверены `team.ts`, `teamMetadata.ts`, `merge3.ts`.

## A01–A04: дополнительные boundaries, подтверждённые заново

### A01 HIGH — first-create undo после accepted batch с lost response: PASS

`sync.ts:254–279` не классифицирует prepared attempted creation как обычный remote-only import. Desired :294 после двух reconcile не воскрешает локально удалённый benign new-note.txt. Подтверждено новым `rollback-verified.tap`, не старым witness.

### A02 MEDIUM — mkdir undo после accepted PUT с lost response: PASS

`team.ts:640` передаёт requestLocal.dirs; `mergeDirs` учитывает explicitly changed membership во время await. Desired :306 local dirs остаются [], server dirs также [].

### A03 HIGH — restart ABA, последующий durable redo == journal.prior: PASS

`commitLaterAppState` :312 использует **настоящий root PersistStorage**: `store.useStore.persist.getOptions().storage.setItem('tetrafree',...)` + `.flush()`, не fabricated higher revision. Assertions проверяют actual envelope/authority, durableRevision>=before.current, durableRevision>journal.appRevision, durableRevision==after.current==authority.revision. Fresh child обязан hydrate именно переданную envelope revision.

Фактический НОВЫЙ log:

```text
cloud: journal.appRevision=125 < before.current=127 < durableRevision=128; authority={backend:ls,revision:128}; recovered=sent; desc=sent description; puts=0
disk:  journal.appRevision=136 < before.current=138 < durableRevision=139; authority={backend:ls,revision:139}; recovered=sent; disk=sent; batches=0
```

Generation decision: `syncJournal.ts:111–130`; captured loaded envelope не подменяется current issuance. **Оба real late-durable ABA :335/:352 PASS.** Genuine failed-checkpoint recovery также не выключен: :383/:396 создают настоящий pre-request checkpoint через actual setItem+flush и восстанавливают более новое journal undo. Два explicit revision2 old-snapshot cases оставлены отдельно и не считаются late-durable proof.

### A04 HIGH — новые post-hydration runtime правки + whole-snapshot replay: PASS

Текущий guard требует age-proof и runtimeRevision==0 для fresh old-state replay. `syncJournal.ts:111–130`; runtime provenance в `persistence.ts:25–34,193–207,261`. При ambiguity `sync.ts:151–178` / `team.ts:560–575` сохраняют live + visible desired/prior JSON + warning; `recoveryBlocked` записывается preserveGeneration=true. Clean baseline/outgoing остановлены, cached retry не снимает блокировку.

В `store/index.ts:62` восстановлено **chatsActions(publish)**; все восемь factories/public API проходят pre-publication reservation. Новые независимые :414/:427/:457 PASS: fresh process → actual old checkpoint hydrate → настоящий post-hydration store.up note/desc либо настоящий createChat → **2 sync retries**.

Child оставляет **настоящий registered checkpoint**, не noop. Assertions проверяют active human state, реальные durableFiles/durableChats, сохранённый recovery intent, visible warning и **0 PUT/batch**. Actual chat-only evidence нового лога: runtimeBefore=0, runtimeAfterEdit=1, chats=[human fresh chat]. Новый чат остаётся и в active state, и в durable envelope. All-eight real-action runtime coverage дополнительно входит в 172 regressions.

## Границы verdict

- Ambiguous journals требуют явного recovery: обе версии видимы/exportable в JSON, но общего resolution UI эта работа не добавляет. Даже unrelated runtime UI mutation может консервативно остановить replay.
- Не доказаны arbitrary crash/exactly-once outbox, единая транзакция app+journal+baseline+external IO, real IDB/WebView power loss/fsync.
- Нет cross-window/process lock/CAS; внешний OS writer может обойти in-process server lock. FNV/text recovery не является cryptographic/raw-byte CAS.
- Не запускались Windows/Tauri/ConPTY, browser/listeners/network, реальные providers, shell/tools. Global check/build/prettier/push этим reviewer не выполнялись и не сертифицируются.
- **Production/src/package/server мной не менялись.** Только внешние fixtures/snapshots/report и scoped benign tests. Original witnesses неизменны; exploit payload/цепочки не создавались.

**Итог: текущая post-rollback независимая safety acceptance agent/sync scope — PASS; прежний исторический PASS не подменял повторную проверку.**
