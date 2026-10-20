# TetraFree — второй независимый защитный аудит agent / sync

## Итог

**Открыто: 6 findings — 3 High, 2 Medium, 1 Low.** Основные блокеры: CAS повторной правки агента проверяет не тот исходный текст; подтверждённая внешняя запись теряет своё acknowledged-состояние при локальном undo — отдельно в cloud и disk sync.

Проект **не изменялся мной**. Не запускались check/build/prettier, браузер, приложение, HTTP/SSE listeners или реальные сетевые запросы. Не выполнялись shell-команды из тестируемого приложения, реальные MCP/web tools, push. Все мои fixtures, bundles, снимки и логи — в `/data/fix-tetrafree/reaudit-agent/`; этот отчёт — единственный файл вне этой подпапки. Работе авторов не вмешивался.

Прочитаны целиком `/data/tetrafree/AGENTS.md`, `contracts.md`, `agent-contract.md`, `persistence-api.md`. Просмотрены engine, Turn, autorun, protocol, queue, fileguard/projectfs, backend bExec/bBatch, sync, team, teamMetadata, merge3, syncRecovery, соответствующие store/persistence и серверные границы. Отдельного файла/символа `cloudMerge` в текущем `src` нет: облачное слияние реализовано в `team.ts::tickOnce/applyMeta`, `teamMetadata.ts`, `merge3.ts` — именно они проверены.

### Версия доказательств

Репозиторий менялся другими авторами во время аудита. Все номера строк ниже относятся к финальному срезу **2026-10-15 13:30:46 UTC**, сохранённому в `reaudit-agent/final-snapshot/` с оригинальными относительными путями. SHA-256 — `final-snapshot/manifest.json`. На первом финальном прогоне 8 witness-тестов все эти исходники оставались неизменными (`stability.json`). Затем выполнена дополнительная проверка окончательных bytes после завершения sync-автора — см. дополнение ниже. Ранний `snapshot/` — только промежуточный срез, не основание для findings.

## F01 — HIGH — Повторный edit применяет stale T.after под CAS нового живого файла

**Код:** `/data/tetrafree/src/agent/engine.ts:963–991`, особенно **967, 975, 978**; `src/agent/turn.ts:114–118, 151–178`.

В `syncSegs` исходник повторной правки берётся из `T.after`, если файл уже встречался в ходе:

```ts
const cur = T.before.has(path) && T.after.has(path) ? T.after.get(path) : fileOf(pid, path)
```

Но `T.begin()` создаёт новый baseline из текущего живого `fileOf`, а не из `cur`, использованного для вычисления результата. `endWrite()` сравнивает baseline с тем же текущим файлом и считает CAS успешным. Ручная правка **между** двумя агентными операциями поэтому не вызывает `proposed`: результат, вычисленный из старого агентного текста, записывается поверх неё. Ручное удаление между шагами аналогично превращается в незапрошенное повторное создание.

**Benign evidence:** `reaudit-agent/agent.test.ts:79` (R01) и `:107` (R08); лог `final-independent.tap`.

- После первой правки пользовательский текст: `human alpha\nbeta agent`.
- Вторая правка изменяет только `beta agent` → `beta final`, но активный файл становится `alpha\nbeta final`; обе карточки `done`, recovery-файлов нет.
- После ручного удаления в R08 файл также появляется снова с состоянием `done`.

Это не отказ обычного CAS «изменили во время стрима», который покрыт существующими тестами: здесь неверно связан **источник вычисления** с baseline следующей операции. Полный `before` второй карточки может содержать вытесненный текст — не утверждаю необратимую утрату всех байтов из всей истории; но конфликт/согласие пропущены, активная ручная правка потеряна, обычный откат всего хода не равен её восстановлению.

**Исправление:** для применяемых правок вычислять результат из проверенного живого исходника либо хранить baseline именно вычисляемого `cur` и переводить расхождение в proposal. Отдельно различать цепочку ещё не принятых предложений и уже применённые правки. Добавить оба regression-сценария.

## F02 — HIGH — Cloud: успешный PUT + локальный undo теряет acknowledged ancestor и отменяет undo

**Код:** `src/lib/team.ts:494–506, 518–528, 640–660`; для метаданных — `team.ts:554–559` и `src/lib/teamMetadata.ts:66–68`.

После успешного PUT построены правильные `base = { rev, files: fh, meta: mh, metadata: meta }` и `bt = out`. Но при локальном изменении во время PUT/flush строка **658** возвращает `true` **до** сохранения этого acknowledged-состояния. Следующий проход снова загружает старый ancestor с диска. Если пользователь за время PUT осознанно вернул файл/поле к значению старого ancestor, следующий merge считает его «локально не менялось» и забирает собственную предыдущую отправку обратно из облака. Ни конфликт, ни recovery не создаются.

Барьер `flushPersistence()` реально awaited: это **не** пропущенный await. Ошибка в том, что теряется факт уже подтверждённой внешней записи; удержать старый clean-baseline недостаточно.

**Benign evidence:** `reaudit-agent/cloud.test.ts:121` (R02), `:139` (R03), реальный Zustand/store/team/persistence API, mock только транспорта и durable callback.

- Файл: ancestor `base`, отправлено `sent`, во время PUT локально возвращено `base`.
- Результат: `local.note.txt = sent`, `server.note.txt = sent`, `puts=1`, `gets=2`, без `.cloud`-копии.
- Метаданные: `desc` возвращён к `base description` во время PUT; после follow-up снова `sent description`, metadata recovery отсутствует.

Существующий тест про `newer local` не покрывает возврат к старому ancestor: значение, отличное от обоих состояний, попадает в другой merge-branch.

**Исправление:** сохранять подтверждённую отправку и её ancestor отдельно от признака «текущий local чистый»; локальные изменения после отправки должны оставаться dirty относительно фактически принятого сервером состояния. Не продвигать clean-checkpoint без durable barrier, но и не забывать acknowledged PUT. Нужны regression-тесты undo/revert для файлов и метаданных, включая последующий полный GET и перезапуск.

## F03 — HIGH — Disk sync: успешная запись + локальный undo поглощается следующим pull

**Код:** `src/lib/sync.ts:186–203, 273–280, 368–388`.

Аналогичная потеря acknowledged-состояния на дисковом контуре. После успешного `bBatch` строка **377** замечает отличие текущего файла от отправленного, ставит retry и выбрасывает ошибку до записи `next` baseline. Если пользователь успел вернуть локальный файл к прежнему baseline, следующая сверка видит `storeSame=true`, считает новую дисковую версию чужим изменением и делает pull поверх локального undo. CAS сервера этому не препятствует: проверка предыдущего дискового текста была корректна, проблема наступает после успешной записи.

**Benign evidence:** `reaudit-agent/disk.test.ts:91` (R07), лог `final-independent.tap`.

```text
first: null
после первого прохода local: base
second: { pushed: 0, pulled: 1, removed: 0, conflicts: 0, truncated: false }
итог local: sent; disk: sent; batches: 1
```

Транспорт и «диск» полностью in-memory; использованы реальные `reconcile`, store и hash API. Реальные файлы проекта не записывались. Тест останавливает только тестовые retry-таймеры и явно вызывает второй проход.

**Исправление:** отдельно учитывать успешно подтверждённую дисковую запись и dirty-изменения local после отправки; старый baseline нельзя использовать как единственное доказательство отсутствия локального изменения. Durable checkpoint и generation-проверки сохранить. Добавить undo-during-batch и restore-during-remove regression-тесты.

## F04 — MEDIUM — Markdown container fences не защищают документационные примеры от protocol parser

**Код:** `src/agent/protocol.ts:22–25, 47–75`.

`FENCE` распознаёт только fence в начале физической строки с 0–3 пробелами. Корректный Markdown fence внутри blockquote (`> …`) либо вложенного list-item с четырьмя пробелами не распознаётся. Независимый глобальный `OPEN` затем воспринимает находящийся внутри документационного блока протокольный тег как операцию.

**Benign evidence:** `reaudit-agent/agent.test.ts:91` (R05). Проверялся **только parse**, без dispatch: пример с безвредным чтением `guide.txt`, помещённый в blockquote fence и во вложенный list fence, в обоих случаях дал `ops=1`, `kind=read`, вместо нуля операций. Никаких payload для записи/команд или цепочек эксплуатации не создавалось.

Существующие top-level tests для тройных/длинных/tilde fences проходят и не покрывают Markdown containers.

**Исправление:** распознавать fenced-code blocks с Markdown container context и исключать их диапазоны из поиска протокольных тегов; сохранить явный file-header fallback отдельно. Проверить также незакрытые container fences во время streaming. Не исправлять простым удалением `>`/отступов из всего ответа — это меняет содержимое файлов.

## F05 — MEDIUM — Изолированные изменения пустых директорий не попадают в cloud PUT

**Код:** `src/lib/team.ts:25–30, 628–644, 870–874`.

`Base` не хранит dirs; решение об отправке основано только на `sameFiles` и `mh !== base.meta`. Директории не входят в `exportMeta`. `dirs: p.dirs` сериализуется лишь внутри уже выбранного PUT; изменение только пустых папок этот PUT не выбирает. В сигнатуре debounce watcher директории тоже отсутствуют. Даже явный `cloudNow()` не исправляет ситуацию — очередной poll возвращает same и ничего не отправляет.

**Benign evidence:** `reaudit-agent/cloud.test.ts:156` (R04): реальный `addDir('empty')`, затем `cloudNow`; результат `dirs=["empty"]`, `puts=0`.

**Последствие:** расхождение структуры проекта между участниками, отсутствие пустых папок на другом устройстве; не утверждаю потерю содержимого непустых файлов.

**Исправление:** включить нормализованные dirs в cloud acknowledged/checkpoint и generation/signature comparison. Задать явную merge-политику удаления директорий, а не только union на получении. Добавить тесты isolated mkdir/rmdir.

## F06 — LOW — Ошибка fireAuto уходит rejection в unsupervised background callers

**Код:** `src/agent/autorun.ts:82–94, 113, 185–191, 212–225, 252–254`; источник async-ошибки — `src/agent/automations.ts:202–205`; ручной UI-путь — `src/modals/Automations.tsx:74–87`.

`fireAuto` имеет `finally`, но не `catch`; ошибка `await autoHash` (и другая runtime-ошибка исполнителя) наружу возвращается rejected Promise вместо `{ ok:false,note }`. Планировщик/файловый/task/open paths вызывают его через `void` без rejection handler. Поэтому при ошибке инфраструктуры нет контролируемого результата/журнала, а фоновый Promise остаётся необработанным. Этот finding не утверждает обход approval или запуск после revoke.

**Benign fault-injection evidence:** `reaudit-agent/agent.test.ts:98` (R06) временно подменяет только `crypto.subtle.digest` на rejected Promise и через `assert.rejects` подтверждает проброс ошибки из реального `fireAuto`. Тест сознательно **перехватывает** rejection; реальный global unhandled-event/listener не создавался. Отсутствие обработки в production callers установлено чтением кода. Обычный happy path digest не падает в тестах — severity Low из-за условного failure-mode.

**Исправление:** единая supervised boundary: обработать runtime-ошибки в `fireAuto` с честным failure result/log либо `.catch` у каждого detached caller, сохранив `firing.delete` в finally. Ошибки не должны помечаться успешным запуском.

## Что перепроверено и НЕ числится открытым finding

- **Cancel-before-launch:** в начале чтения сервер не имел cancellation tombstones, но автор исправил это до финального среза. Сейчас `server/tetra-server.mjs:302–314, 770–788, 811–816, 882–895` содержит session-bound key, bounded tombstones, pending cancellation bit и проверку непосредственно перед spawn. Старое наблюдение исключено из открытых findings. Это статическая проверка нового server fix, не end-to-end Windows verification.
- **bExec:** `src/lib/backend.ts:196–276`: preabort не отправляет POST; transport имеет свой AbortSignal; cancel/failure отправляет kill; output-only EOF и повреждённый NDJSON не считаются успешным code=0. Подтверждено выбранными `backend.exec.test.ts`. Не утверждаю доказанную остановку реального Windows process tree.
- **bBatch API:** `backend.ts:114–128` действительно передаёт пятый `expectedHashes`; `sync.ts:276–279` формирует ожидаемые хеши. На сервере `tetra-server.mjs:676–695` предусмотрен `CONFLICT` и отдельный `failed[path]`. Не найдено старого несовпадения формы аргументов API. Внешний редактор не участвует во внутрипроцессном `withProjectLock` — это не проверка атомарности относительно всех произвольных OS-писателей.
- **Abort и ownership агента:** перенесённые lifecycle tests проходят для старого/нового controller, late MCP result, запрета последующих tool dispatch, отменённых файловых мутаций, queue pause/Stop/generation, project switching. In-flight MCP/web APIs действительно не имеют cancellation argument: поздний результат отбрасывается, но уже запущенный внешний вызов не отзывается — ровно ограничение `agent-contract.md`, не новый finding.
- **Proposed/revert CAS:** текущие tests проходят для stale delete/rename/create, обоих концов rename, повторного подтверждения, project-pinned approval, legacy folder proposals, больших before-images и отсутствующего legacy original. `fileguard.ts:25–32` проверяет запись recovery в in-memory project; это само по себе не доказательство fsync/успешного durable flush. Crash/power-loss после forced UI accept отдельно не моделировался.
- **Persistence barriers:** sync/team действительно используют `await flushPersistence()` и проверяют актуальность состояния; существующие checkpoint-failure tests проходят. F02/F03 — дополнительные failure modes уже после успешной внешней записи, а не отрицание этих исправлений.
- **Metadata merge:** проходят tests независимых полей задач/docs, windowed chat history, person-ID conversion, conflict copies/tombstones и collision-safe recovery names. Merge3 checked на независимых изменениях, конфликтных строках и CRLF marker resolution. F02 дополнительно покрывает metadata undo при PUT.
- **autoVerify:** standalone JS/Python filename checks намеренно отключены; остаются фиксированные имена npm scripts. Это реальное уменьшение функциональности, согласованное в contract, не восстановленные filename checks и не shell sandbox.

## Выполненные проверки и воспроизводимость

Рабочая папка команд — `/data/tetrafree`, `TSX_DISABLE_CACHE=1`. Все fetch в выполняемых application-тестах заменены локальными функциями; cloud/disk транспорты реализованы в памяти. Новые assertions не требуют ключей, Windows, HTTP listeners или сетевого доступа.

1. Выбранные существующие unit suites: protocol, queue, backend.exec, teamMetadata, sync, team — **52/52** (`reaudit-agent/regression.tap`).
2. Lifecycle suite перенесён в `reaudit-agent/lifecycle-regression.test.ts`, поскольку исходный test harness создаёт временный `.unit-*.mjs` внутри `src`. Мой harness перенаправляет все bundles в разрешённую fixtures-папку; плюс merge3 suite — **41/41** (`lifecycle-regression.tap`).
3. Новые witness tests: **8/8 подтверждают наблюдаемые дефекты** (`final-independent.tap`). Их зелёный статус означает совпадение с описанным плохим результатом, **не** успешную проверку desired safety invariants. Связь: R01/R08 → F01; R02/R03 → F02; R07 → F03; R05 → F04; R04 → F05; R06 → F06.

Всего выполнено 93 существующих regression checks и 8 новых witness checks. Первоначальные ошибки настройки внешнего harness (синтаксис добавленного test-only export / module resolution esbuild) исправлены только в fixtures; это не findings проекта и не скрытые падения приложения. Финальные логи сохранены отдельно.

Повторить 8 независимых checks:

```bash
cd /data/tetrafree
TSX_DISABLE_CACHE=1 ./node_modules/.bin/tsx --test \
  /data/fix-tetrafree/reaudit-agent/agent.test.ts \
  /data/fix-tetrafree/reaudit-agent/cloud.test.ts \
  /data/fix-tetrafree/reaudit-agent/disk.test.ts
```

Fixtures импортируют текущие read-only исходники, не замороженный snapshot. После дальнейших авторских исправлений ожидаемо может измениться результат assertions «наблюдаемый дефект»; SHA manifest позволяет установить точный проверенный срез.

## Ограничения / решение по готовности

Это scoped defensive audit, не полная сертификация проекта. Не проверялись реальные Windows/Tauri/ConPTY/OS process trees, физический fsync/аварийное отключение, настоящие cloud/SSE/backend соединения, MCP/web providers, browser rendering. Указанные code fences проверялись parse-only с безопасным чтением. Ни exploit payload, ни эксплуатационная цепочка не создавались.

**Рекомендация:** не считать agent+sync repair закрытым до исправления F01–F03 и добавления safety-regression tests, проверяющих сохранение локальных правок/undo. Sync-автор может завершить свои текущие изменения независимо: аудитор не менял ни его код, ни контракты, ни package/server/src.


## Дополнение: проверка финальных bytes после сообщения координатора

Срез: **2026-10-15T13:33:56.272640+00:00**. Полная копия проверенных bytes и SHA-256: `reaudit-agent/final-bytes-recheck/manifest.json`. По сравнению с предыдущим срезом изменились: `src/lib/merge3.ts`, `src/store/persistence.ts`. `sync.ts`, `team.ts` и участки кода шести открытых findings не изменились.

Повторно выполнены все 8 собственных witness checks — **8/8 снова подтверждают те же defects** (`final-bytes-witness.tap`). Дополнительно выполнены актуальные `sync.test.ts`, `team.test.ts`, `teamMetadata.test.ts`, `merge3.test.ts` — **44/44 regression tests прошли** (`final-bytes-sync-regression.tap`). Код не менялся во время повторной проверки: `final-bytes-stability.json` содержит пустой `changedDuringRecheck`.

**Итог после проверки финальных bytes: F01–F06 остаются открыты; findings не сняты.** Это не production edit. Для немедленного исправления приоритет: F01 (`engine.ts:967`), затем F02 (`team.ts:658`) и F03 (`sync.ts:375–384`). Зелёные существующие 44 теста не покрывают эти undo/interleaving-сценарии.
