# Восстановление приёмки после rollback — CURRENT против HISTORY

Отчёт восстановлен из сохранённого attachment предыдущего turn, а не заново составлен по авторским claims. Полная исходная копия отдельно: `/data/fix-tetrafree/reaudit-storage/historical-final-acceptance-storage.md`. **Всё ниже раздела HISTORY относится к прошлой приёмке, включая строки candidate, 102/102 и 25/25 integrity. Эти числа не являются новым прогоном после rollback.** При расхождении текущих строк используйте таблицу CURRENT ниже.

## CURRENT — независимо повторено после rollback

Фактические часы sandbox: **2026-10-20 17:40 UTC**, Node **v24.14.1** (`restored-environment.log`). Это среда текущего прогона; историческая дата 2026-10-15 далее не изменена. Node22/global654 и current25/172 из сообщения parent **не запускались и не подтверждаются данным аудитором**.

**Вердикт CURRENT: исходные R01–R08 + runtime R07-ABA — CLOSED SCOPED по повторённым desired fixtures. Новых failures в этом узком повторе не обнаружено. Не release acceptance и не повтор всего первоначального аудита/account/docsync/generation coverage.**

Все следующие логи — `/data/fix-tetrafree/reaudit-storage/`, созданы заново после rollback:

| Свежий evidence | Результат |
|---|---|
| `restored-vault-aba-desired.log` / прежний собственный `vault-aba-desired.mts` | **PASS DESIRED**. Реальные saveProvider TEMP→empty во время задержанного GET; generation строго возрастает; flush до/после GET оставляет memory/committed synthetic IDB empty; vaulted=false, DELETE=1, SET=0, pending снят ACK, clear intent сохранён. |
| `restored-vault-runtime-controls.log` / восстановленный собственный `vault-runtime-controls.mts` | **3/3 PASS**, каждый в свежем процессе: legitimate placeholder hydration DELETE=0/SET=0; explicit same-empty DELETE=1; failed DELETE synthetic503 → same-empty retry DELETE=2 и pending снят. |
| `restored-acceptance-8.log` / собственный `acceptance.mts` | **11/11 PASS**, 0 failed: все восемь finding safety assertions, downgrade/corrupt fail-closed, реальный store checkpoint/commit wait, merge3/CRLF controls. Это safety, не characterization старого дефекта. |
| `restored-hydration.log` / `hydration.mts` | **4/4 PASS**, свежие процессы pending / future / old / v6. |
| `restored-desktop.log` / production `src/lib/desktop.checkpoint.test.ts` | **4/4 PASS**, 0 failed/cancelled/skipped. Explicit close/update ждут successful flush; rejected flush не закрывает/не устанавливает. Tauri mocked, не native exit E2E. |
| `restored-before.json`, `restored-integrity.json` | **13/13 выбранных production targets неизменны** между началом и завершением прогона; changed=[]; не whole-repo/dependency-graph integrity claim. |

### CURRENT — 8 + ABA и точные code anchors

Пути относительно `/data/tetrafree/`; строки прочитаны в текущем candidate. Severity — исходного дефекта, не утверждение о продолжающейся уязвимости.

| ID / прежняя severity | Текущий статус и evidence | Текущий code anchor |
|---|---|---|
| R01 / P2 | CLOSED SCOPED: tombstone + failed LS cleanup не воскрешают OLD, authority не позволяет lower revision | `src/store/persistence.ts:241–247,271–287` |
| R02 / P2 contract gap | CLOSED SCOPED: failed fallback journal rejects flush; explicit retry создаёт читаемый fallback | `src/store/persistence.ts:146–151` |
| R03 / P2 | CLOSED SCOPED: свежий текст image-target сохраняется, image добавляется отдельно | `src/workspace/DocView.tsx:73–96` |
| R04 / P1 | CLOSED SCOPED: настоящий backup import сбрасывает auto/mirror/running | `src/lib/backup.ts:79–87` → `detachProject` |
| R05 / P1 | CLOSED SCOPED: memory undo возвращает note/tombstone в origin A после switch B | `src/modals/Activity.tsx:243`, `src/store/slices/memory.ts:46–49` |
| R06 / P1 | CLOSED SCOPED: rename/delete callback изменяет origin A, не duplicate B | `src/workspace/Sidebar.tsx:425,450`, `src/store/slices/docs.ts:47–60` |
| R07 / P2 | CLOSED SCOPED runtime: delayed GET не отменяет explicit clear; remote delete выполняется | `src/lib/vault.ts:51–89`, `src/store/slices/settings.ts:29–45` |
| R08 / P2 | CLOSED SCOPED: исходный benign large insertion с независимым append без RangeError, точный результат | `src/lib/merge3.ts:77–91` |
| R07-ABA / P2 | CLOSED SCOPED runtime: тот же независимый desired witness + 3 controls проходят сейчас | `src/lib/vaultState.ts:21–40`; `src/lib/vault.ts:69–76,101–124,138–139`; settings intent до set `:29–45` |

ABA code gate проверен чтением: capture generation до await GET, matching generation + отсутствие scoped clear для remote fill; каждый explicit save/delete фиксирует intent перед store notification, включая equal-empty; stale ACK не снимает newer pending; generation включён в subscriber signature.

### CURRENT — остаточные границы, не закрытые зелёным fixture

- **P2 / pending contract gap: durable remote-delete intent после failed DELETE + crash/reload НЕ принят.** `src/lib/vaultState.ts:21–23` — runtime Map; `src/store/persistence.ts:320–340` (`partialize`, providers `:331`) не сохраняет intents. Наш failed-delete retry проходит только в одном runtime; crash/reload тест не выполнялся. Fix proposal: versioned backend/account-scoped durable outbox/clear-intent, committed до local mutation, recovery и matching-generation ACK cleanup; не сохранять bearer token как идентификатор scope. Это прежний явно открытый durability gap, не новый доказанный crash exploit.
- **Broad native exit pending.** Текущие explicit gates `src/lib/desktop.ts:13–26,83–85` и 4 mocked tests — не доказательство всех OS/tray/Rust/kill/restart paths. Fix/acceptance proposal: отдельно инвентаризировать native close/restart paths, подключить checkpoint где возможно и проверить реальный Windows lifecycle; аварийное завершение не обещать покрыть frontend await.
- Browser IDB/WebView2/DPAPI, реальные quota/crash/multiwindow и реальные аккаунты/сеть не использовались. IDB/LS/fetch — synthetic in-memory; production store/actions/vault/merge3 и извлечённые настоящие callbacks исполняются fixture, не полный React/DOM.
- AGENTS.md прочитан целиком заново. Production READ ONLY; scripts/logs только в audit directory, восстановленный отчёт — в явно запрошенном path. Нет global check/build/prettier/browser/server/listeners/push. 8-file/102 suite **не повторялась** сейчас. Новые broad audit темы не открывались.

## HISTORY — восстановленный исходный final report, не новый прогон

# Final acceptance — storage / domain / vault ABA

Дата: 2026-10-15, независимая повторная проверка `/data/tetrafree` (на финальном чтении package.json **3.1.5**). Production READ ONLY для аудитора.

## Вердикт

**ACCEPTED в пределах синтетической portable-приёмки: R01–R08 и исходный R07-ABA runtime witness.** Оставшийся в предыдущем `reaudit-storage.md` статус OPEN для **этого ABA-сценария** заменяется на **PASS DESIRED / CLOSED SCOPED**.

Это **не** полная release/Windows/native-exit приёмка. В частности:

1. **Durable vault delete-intent/outbox после failed remote delete + crash/reload остаётся pending.** Runtime generation/clear/pendingDelete теперь работают, но не сохраняются на диск. Не приравнивать runtime ABA fix к сохранению намерения удаления после перезапуска.
2. **Broad native exit остаётся pending.** Explicit frontend close/update gates проверены; все пути закрытия WebView/Tauri/трея/OS/процесса, реальный restart/updater и аварийное завершение этим не покрыты.
3. Browser IndexedDB/Windows WebView2/DPAPI/реальные quota/crash/multiwindow не проверялись. Global check/build/push аудитор не запускал.

Прочитан обновлённый AGENTS.md целиком. Авторский `/data/fix-tetrafree/persistence-aba-fixes.md` использован как указатель scope; его «65 tests pass» **не** принято как независимое доказательство. Ниже результаты реально повторённых checks.

## 8 + ABA status

Пути в таблице относительно `/data/tetrafree/`. Строки относятся к проверенному candidate, а не начальным находкам из исторического отчёта.

| ID / прежняя severity | Итог | Независимый witness / code evidence |
|---|---|---|
| **R01 / P2** tombstone + stale LS | **CLOSED SCOPED** | `acceptance.mts`, R01: failed LS cleanup не воскрешает OLD; tombstone остаётся IDB. Дополнительно отсутствующий authoritative IDB с lower-revision LS fail-closed. `src/store/persistence.ts:222–228,252–268`. |
| **R02 / P2 contract gap** fallback authority | **CLOSED SCOPED** | R02: failed journal отклоняет flush, NEW raw остаётся retryable; после исправления journal явный retry создаёт читаемый fallback при failed IDB read. `persistence.ts:136–141`. Это проверка usable checkpoint, не только наличия raw bytes. |
| **R03 / P2** image replacement после await | **CLOSED SCOPED** | R03: реальный фрагмент fresh/addImages с настоящим updateDoc сохраняет свежий текст target block и вставляет image рядом. CAS в `src/workspace/DocView.tsx:78–89`; scoped suite также проверяет изменение структуры placeholder и изменение ещё до начала compression. |
| **R04 / P1** backup import bypass detach | **CLOSED SCOPED** | R04: настоящий importBackup создаёт новую identity, сбрасывает auto/mirror/running; нет cloud/path привязки. `src/lib/backup.ts:79–87` → `detachProject`. Scoped suite отдельно покрывает свободный исходный pid, а не только occupied id. Команды/пайплайны не запускались. |
| **R05 / P1** memory undo в текущий проект | **CLOSED SCOPED** | R05: извлечённый актуальный production callback восстанавливает A после переключения на B, снимает tombstone A, не меняет B. `src/modals/Activity.tsx:233–243`, `src/store/slices/memory.ts:46–49`. Прямой pid action и deleted-origin cases также в scoped suite. |
| **R06 / P1** doc rename/delete в копии | **CLOSED SCOPED** | R06: callback захвачен для A; копия B получена настоящим duplicateProject. Rename/delete воздействуют A, не B. `src/workspace/Sidebar.tsx:425,450`, `src/store/slices/docs.ts:49–60`. Deleted-origin не перенаправляется на matching id в B. |
| **R07 / P2** vault stale GET vs clear | **CLOSED SCOPED (runtime)** | R07: настоящий saveProvider clear + flush во время GET; после remote response ключ остаётся пустым, delete выполняется. Generation/clear gate в `src/lib/vault.ts:51–76`; mutations записывают intent до set/subscribers (`src/store/slices/settings.ts:29–45`). |
| **R08 / P2** merge3 large spread RangeError | **CLOSED SCOPED** | R08: тот же benign input <1 MiB / 150000 вставленных строк + независимый append даёт точный ожидаемый текст без conflict/RangeError. `src/lib/merge3.ts:77–91` теперь append-итерацией и для conflict sides. |
| **R07-ABA / P2** empty→temporary→empty | **CLOSED SCOPED (runtime)** | **Тот же независимый witness**, отдельно перевёрнутый на desired assertions: `vault-aba-desired.mts`, результат ниже. Не characterization старого бага. Durable outbox/reload не включён в этот статус. |

Исходные repro/scripts/logs сохранены; они документируют первоначально плохое поведение, а не текущее состояние. Новый отчёт не переписывает историю так, будто defects никогда не существовали.

## Независимый desired ABA witness

Файлы: `/data/fix-tetrafree/reaudit-storage/vault-aba-desired.mts` и `vault-aba-desired.log`.

Сохранён исходный порядок из моего `vault-aba.mts`, но assertions проверяют **безопасный результат**, а не ожидают восстановление remote key:

1. Реальный `hydrateStore()`, provider с пустым ключом; настоящий `startVault()` отправляет GET в synthetic responder, ответ удерживается.
2. Настоящий `saveProvider(TEMP)` → настоящий `saveProvider(empty)`; отдельно проверяется `generation0 < generation1 < generation2`.
3. Настоящий `flushPersistence()`; **до** ответа GET память и committed synthetic IDB snapshot содержат empty.
4. Завершение GET со старым синтетическим remote key; ожидание effects, затем новый flush.
5. Desired assertions: память **empty**, committed snapshot **empty**, `isVaulted=false`, **deletes=1**, **sets=0**. Pending-delete снят ACK, но clear intent остаётся, чтобы retry GET не счёл пустоту hydration-placeholder.

Фактический лог:

```text
PASS DESIRED R07-ABA: persisted empty -> temp -> empty, strictly increasing generation; final memory/durable empty; vaulted=false; deletes=1; sets=0; pending cleared; clear intent retained
```

Code evidence новой защиты:

- `src/lib/vaultState.ts:21–39`: in-memory intent с монотонным generation, scoped clear/pending delete, ACK только для matching generation; запись intent отзывает прежний acknowledgement.
- `src/store/slices/settings.ts:29–45`: intent фиксируется **до** публикации store mutation, в том числе explicit same-empty save и deleteProvider.
- `src/lib/vault.ts:51–76`: GET захватывает generation; remote-fill разрешён лишь при неизменном generation и отсутствии clear intent, а не по одному `before.key === current.key`.
- `vault.ts:101–124`: SET/DELETE completion сопоставляется с generation; stale completion вызывает следующий проход и не снимает новое delete-intent.
- `vault.ts:138–139`: subscriber signature включает mutation generation, поэтому explicit same-empty save не пропускается как semantic no-op, но idle не создаёт сам себе synthetic provider changes.

## Дополнительные независимые vault controls

`vault-runtime-controls.mts` запускается **отдельным свежим процессом для каждого mode**; лог `vault-runtime-controls.log`:

| Mode | Безопасное ожидание | Результат |
|---|---|---|
| `placeholder` | Нет локальной мутации: старый ключ законно восстанавливается из vault и подтверждается, без SET/DELETE | PASS, deletes=0, sets=0 |
| `same-empty` | Explicit empty→empty save во время GET — clear intent, не hydration-placeholder | PASS, key empty, deletes=1, sets=0 |
| `retry` | Первый DELETE получает synthetic 503; runtime pending-delete сохраняется; новый same-empty save увеличивает generation и повторяет DELETE | PASS, после retry key/durable snapshot empty, deletes=2, sets=0, pending снят |

Эти controls не позволяют ошибочно «починить» ABA полным запретом законного vault hydration и отдельно проверяют runtime retry, а не только первый happy-path DELETE.

## Повтор исходных findings, hydration и scoped suites

Артефакты находятся в `/data/fix-tetrafree/reaudit-storage/`.

| Артефакт | Что исполнено в этой финальной приёмке | Результат |
|---|---|---|
| `final-acceptance-8.log` | Мой `acceptance.mts`: R01–R08 с desired assertions + downgrade/corrupt, real-store commit wait, merge3/CRLF controls | **11/11 PASS** |
| `vault-aba-desired.log` | Тот же трёхшаговый ABA witness, assertions на safe state/effects/generation | **PASS DESIRED** |
| `vault-runtime-controls.log` | Свежие процессы placeholder / same-empty / retry | **3/3 PASS** |
| `final-aba-hydration.log` | Свежие процессы реального стора pending / future / old / v6 | **4/4 PASS** |
| `final-aba-scoped-tests.log` | 8 конкретных production test files, включая desktop checkpoint | **102/102 PASS**, fail/cancelled/skipped=0 |

Scoped test files: `src/store/persistence-durable.test.ts`, `src/store/persistence.test.ts`, `src/store/snapshots.test.ts`, `src/lib/docplan.test.ts`, `src/lib/merge3.test.ts`, `src/lib/vaultState.test.ts`, `src/store/slices/domain.test.ts`, `src/lib/desktop.checkpoint.test.ts`.

Реально выполненные команды:

```sh
/data/tetrafree/node_modules/.bin/tsx /data/fix-tetrafree/reaudit-storage/vault-aba-desired.mts
/data/tetrafree/node_modules/.bin/tsx /data/fix-tetrafree/reaudit-storage/acceptance.mts

# Отдельный процесс для каждого mode:
/data/tetrafree/node_modules/.bin/tsx /data/fix-tetrafree/reaudit-storage/vault-runtime-controls.mts MODE
# MODE: placeholder, same-empty, retry
/data/tetrafree/node_modules/.bin/tsx /data/fix-tetrafree/reaudit-storage/hydration.mts MODE
# MODE: pending, future, old, v6

/data/tetrafree/node_modules/.bin/tsx --test \
  /data/tetrafree/src/store/persistence-durable.test.ts \
  /data/tetrafree/src/store/persistence.test.ts \
  /data/tetrafree/src/store/snapshots.test.ts \
  /data/tetrafree/src/lib/docplan.test.ts \
  /data/tetrafree/src/lib/merge3.test.ts \
  /data/tetrafree/src/lib/vaultState.test.ts \
  /data/tetrafree/src/store/slices/domain.test.ts \
  /data/tetrafree/src/lib/desktop.checkpoint.test.ts
```

**Scope/stability:** `final-aba-before.json` / `final-aba-integrity.json`: **25/25 выбранных targets без изменений** между чтением и окончанием проверок, включая vault/vaultState/settings/persistence/store/domain callbacks/desktop. `final-aba-harness.sha256` фиксирует audit scripts. Это acceptance конкретного стабильного fixture, **не** ожидание stop-файлов/заморозки всего параллельно редактируемого repo и не полный dependency-graph integrity claim.

## Explicit desktop close/update gates

Проверено чтением `src/lib/desktop.ts:13–21,78–80` и повтором настоящего `desktop.checkpoint.test.ts` в выбранной suite:

- Explicit `winClose()` ждёт flush до запроса native close.
- Failed flush не закрывает окно, даёт warning.
- `updInstall()` не вызывает `update_install` до successful flush.
- Failed flush блокирует install.

Все **4/4 PASS** действительно повторены, а не только приняты со слов parent. Тест transpile-исполняет настоящий desktop.ts, заменяет Tauri APIs и flush управляемыми deps. Реального native window/update/download/сети нет; никакие реальные listeners не запускались.

**Broad native exit — pending**, как и сообщил parent. Этот frontend gate нельзя выдавать за закрытие OS shutdown/kill/power loss, Rust/window-manager/tray exit или всех native restart paths. Я не проводил Windows lifecycle E2E и не запускал установщик/обновление.

## Остаточная vault durability-граница — явно не закрыта

`vaultState.ts:21–23` хранит generation/clear/pendingDelete только в runtime Map. Эти intents отсутствуют в persisted state (`src/store/persistence.ts:301` и далее, `partialize`). Новый код сохраняет empty ключ и корректно повторяет failed remote DELETE **в текущем процессе**, но не обещает, что после crash/reload незавершённое удаление останется отличимо от stripped empty placeholder.

Это согласуется с честным pending автора. Нужен отдельный versioned, backend/account-scoped durable outbox/clear-intent с ordering перед local mutation, безопасной scope identity (без сохранения bearer token в outbox), recovery и matching-generation ACK cleanup. Такой механизм в этой приёмке **не реализован и не принят**. Реальный crash/reload с remote service не воспроизводился; отсутствие durable intent подтверждается кодом, а не выдаётся за Windows crash-test.

Таким образом: **исходные 8 + runtime ABA приняты; более широкая гарантия «ключ удалён навсегда даже при failed remote DELETE и перезапуске» не принята.**

## Ограничения и действия аудитора

- Production не редактировался. Новые audit scripts/logs/checksums только в `/data/fix-tetrafree/reaudit-storage/`; этот финальный отчёт — в `/data/fix-tetrafree/final-acceptance-storage.md`.
- Хранилища и транзакции — controlled in-memory fault/order model; store/Zustand/Immer/actions/vault/backup/merge3 — production. UI callback tests извлекают настоящий source callback, но не эмулируют полный React/DOM lifecycle.
- Все внешние запросы запрещены либо подменены строго локальным responder. Только synthetic key/token strings, без реальных аккаунтов/секретов/сетевых сервисов.
- Нет browser/server/listeners, глобальных check/build/prettier, native Rust build/runtime, команд пайплайнов, push. Никаких эксплуатационных payload/цепочек.
- Эта scoped приёмка не снимает другие parent/release blockers и не распространяется на будущие изменения. Исторический `reaudit-storage.md` сохраняется как evidence начальных findings и промежуточного ABA repro; для текущего runtime статуса использовать данный отчёт.
