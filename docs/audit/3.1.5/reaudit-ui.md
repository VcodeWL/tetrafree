# Независимый второй защитный аудит UI / preview / async — TetraFree

Дата: 2026-10-15. Проверка `/data/tetrafree`, финальная сверка исходников около **13:28 UTC**.

## Результат

**5 активных findings: 2 High, 3 Medium. Critical не подтверждён.** Указанные ниже сценарии — ошибки целостности данных и жизненного цикла, не эксплуатационные цепочки. Старые UI-01–08/D08 не переобъявлены новыми findings.

- `AGENTS.md` прочитан целиком.
- Проект — READ ONLY. Новые тесты, manifest и логи находятся только в `/data/fix-tetrafree/reaudit-ui/`; этот отчёт — в отдельно запрошенном пути.
- Не запускались browser, dev/server/listeners, общий check/build/prettier, установка зависимостей, commit/push. Сетевые операции в новых тестах заменены benign deferred fixtures.
- Родитель менял preview/NewProject/match во время аудита. Findings относятся к прочитанному и протестированному коду; хэши реально исполнявшихся модулей записаны в `reaudit-ui/tested-sources.sha256` и прошли финальное сравнение.

### Сила доказательств

**CODE** — вывод из конкретных достижимых ветвей исходника. **CONTROLLED EXECUTION** — исполнение настоящих TS-модулей/обработчиков через TypeScript transpile с контролируемыми store/hooks/DOM/network; не переписанная модель бизнес-логики. Это **не browser/React DOM E2E**. Где используются синтетические зависимости, они названы отдельно. Реальная Windows, WebView2 и визуальное поведение остаются за родителем.

## High

### F01 — File dialogs проверяют устаревший проект и могут без подтверждения затереть появившийся файл

**Места:**

- `src/workspace/RightPane.tsx:404–439`: `newAt`, особенно `411–412`, `429`.
- `src/workspace/RightPane.tsx:443–454`: `renameAt`, особенно `451–453`.
- `src/modals/Forms.tsx:462–469`: `RenameModal` вызывает переданный `check`, затем `run`; свежий store в самих файловых callback не перечитывается.
- `src/store/slices/files.ts:47–58,127–138`: `writeFile`/`renamePath` меняют текущие файлы без collision/preimage guard; содержимое прежнего destination при перезаписи не кладётся в корзину.

**Причина:** `check: (v) => checkPath(p, ...)` захватывает `p` на момент открытия modal. Zustand/immer при внешней правке создаёт новый project/files, но сохранённая modal-функция продолжает проверять старый `p`. Исправленная case-insensitive `checkPath` корректна на свежих данных; проблема в её вызывающем коде.

**Воспроизведение:**

1. Проект A содержит `a.txt = source`, `b.txt` отсутствует. Открыть переименование `a.txt`.
2. Пока диалог открыт, агент/коллега создаёт `b.txt = newer colleague content`.
3. Ввести `b.txt`, подтвердить. Captured `check` возвращает `null`, хотя тот же `checkPath` на актуальном A возвращает «Такое имя уже занято».
4. Реальный `renamePath` оставляет `b.txt = source`, удаляет `a.txt`; newer destination не сохранён в trash этим действием.

То же для «Новый файл»: путь появился после открытия диалога → `writeFile(v, '')` обнуляет его.

**Подтверждение:** CODE + CONTROLLED EXECUTION, тесты `F01: rename dialog…`, `F01: new-file dialog…`. Из исходника извлекаются и исполняются настоящие `renameAt`/`newAt`; используются реальные `checkPath` и `filesActions`. UI hooks/меню/тосты и вспомогательный store контролируемые, внешняя правка заменяет project/files immutable-образом. Браузерного воспроизведения нет.

**Влияние:** новый пользовательский текст может быть перезаписан без recovery данной операцией. Нельзя утверждать, что его нет в иных версиях/бэкапах; их наличие этим путём не гарантируется.

**Минимальное исправление:** в `run` повторно получить исходный проект по captured `pid`, проверить свежий source/destination и его поколение; выполнять conditional mutation атомарно в store. Одной render-time проверки недостаточно. Не переключать действие на текущий чужой проект. Негативный тест — файл/implicit folder появился уже после открытия modal.

### F02 — Design Undo/Redo без проверки preimage перезаписывает более поздние внешние изменения

**Места:** `src/design/actions.ts:169–188` (`undo`/`redo`), `64–68` (любой новый commit очищает redo). Внешняя перезагрузка холста в `src/design/Studio.tsx:97–104` не сбрасывает/не ребазирует историю.

**Воспроизведение:**

1. Холст меняет страницу `base → ours`; undo содержит `base`.
2. Агент/коллега меняет тот же файл на `new external text`; даже если холст уже полностью перезагрузился, старый undo остаётся.
3. Нажать Design Undo: `writeFile(page, prev)` без сравнения пишет `base` поверх external.
4. External временно попадает в in-memory `redo`. Следующая правка холста вызывает `commitDoc` → `redo: []`; durable recovery external этой операцией не создаётся.

**Подтверждение:** CODE + CONTROLLED EXECUTION, `F02: Design undo…`. Исполняются реальные actions и `filesActions`; синтетический DOM-сериализатор возвращает заданную строку. Тест отдельно обновляет `d.doc` на external перед Undo, поэтому проблема не зависит от гонки загрузки iframe. Проверены промежуточная recoverability в redo и её исчезновение после следующей правки.

**Влияние:** затёртые более новые правки; возможная потеря, если они не успели попасть в независимую версию/backup. Не заявляется немедленная необратимость непосредственно после Undo: в этот момент текст ещё есть в volatile redo.

**Минимальное исправление:** история должна хранить pid/page/generation и ожидаемый output операции; при расхождении — отказ, rebase/merge или отдельное durable recovery. Применить симметрично к redo. Негативные тесты: external update/delete/recreate между commit и undo/redo.

## Medium

### F03 — Design version debounce фиксирует версию уже в другом активном проекте

**Места:** `src/design/actions.ts:19–28,32–43,71–73`; `src/design/Studio.tsx:79–95,105`.

**Причина:** глобальные `labels/vTimer` не содержат владельца. `flushVersion()` читает **текущий** `S().projectId` и `D().page` в момент flush. Studio вызывает flush в effect смены проекта либо unmount, когда store уже может указывать на B.

**Воспроизведение:** изменить холст A, до 6000 ms переключиться в B; вызвать штатный transition flush. Реальный commit создаёт в B запись «Дизайн: текст» со snapshot B и описанием страницы A. Версия правки A при этом не создаётся.

**Подтверждение:** CODE + CONTROLLED EXECUTION, `F03: Design delayed version…`; реальные actions и commit, контролируемая смена active pid в порядке, соответствующем Studio. Не React transition E2E.

**Влияние:** неверная история/атрибуция и пропущенный checkpoint A. Сам файл A остаётся изменённым — потеря текста этим finding не доказана.

**Исправление:** при первой правке зафиксировать владельца batch `(pid,page)`; commit выполнять по нему, а не по текущему active project. Разные документы — отдельные batches; очистить также ключи coalescing.

### F04 — NewProject игнорирует `null` от reconcile и сообщает об успешной дисковой операции

**Места:** `src/modals/NewProject.tsx:139–160`; аналогичный caller `575–587` (`ProjectFolderModal`). Контракт: `src/lib/sync.ts:90–96,412–414`; `src/store/slices/projects.ts:139–148` (createProject сразу переключает проект/закрывает modal).

**Причина:** `reconcile` при ошибке **не reject**, а возвращает `null` и выставляет backend `lastError`. Он также возвращает `null` при выключенной синхронизации/занятом проходе. Добавленные `try/catch` в UI этого не обнаруживают: NewProject выдаёт `tone: 'ok'`, а смена папки тоже показывает успех и закрывается.

**Воспроизведение:** успешная проверка пути → ошибка первой сверки либо `settings.backendSync === false` → `reconcile === null` → всё равно «Проект … создан»/«Открыто …». Для нового проекта с выключенной sync это не подтверждает создание настоящей папки/запись шаблона. Существующая папка может остаться неимпортированной, хотя локальная project-запись создана.

**Подтверждение:** CODE + CONTROLLED EXECUTION, `F04: NewProject emits…`: настоящий компонент, контролируемые hooks и Promise-returning reconcile, возвращающий **реальное контрактное значение `null`**. Реальный отказ диска/сетевой E2E не запускался. Аналогичная проблема ProjectFolder подтверждена только чтением кода.

**Влияние:** ложный success, неподтверждённые import/write и потеря понятного retry-контекста; локальная project-запись не равнозначна подтверждённому состоянию на диске. Потеря существующих файлов здесь не доказана. Частичные `failed` sync уже показывает отдельным warning; их не объявляем скрытой потерей.

**Исправление:** различать success/skipped/error в контракте reconcile; не показывать дисковый success при `null`. Для create/open предусмотреть явный retry/error state и не терять информацию об уже созданной локальной записи. Негативные тесты — disabled sync, transport/persistence failure, queued/busy pass.

### F05 — Крестик закрывает busy clone, но его поздний ответ всё равно создаёт/открывает проект

**Места:** `src/modals/NewProject.tsx:114–145,183–194`; `src/components/ui/Modal.tsx:26–35,41–42,70–75`; последствия `createProject` — `src/store/slices/projects.ts:139–148`.

**Причина:** `Modal busy` блокирует Esc/backdrop, но `MHead` рисует отдельный всегда активный close button и busy не знает. После `await bClone(...)` в `create()` нет mounted/generation/cancel guard.

**Воспроизведение:** начать clone, пока bClone pending нажать крестик заголовка; modal закрывается. После успешного позднего ответа код вызывает `createProject`, меняет active project/screen и сбрасывает modal. Если за это время открыт другой диалог, он тоже может быть закрыт этой store-операцией.

**Подтверждение:** CODE + CONTROLLED EXECUTION, `F05: header close during clone…`: реальные NewProject/MHead, deferred benign bClone, unmount перед resolve. Тест подтверждает late `createProject`; переключение экрана/сброс modal — из реального store-кода, не browser reproduction. Реальный git clone не запускался.

**Влияние:** действие после закрытия UI, неожиданная навигация/закрытие следующего диалога. Потеря файлов или выполнение произвольных команд этим finding не заявляются. Фоновое завершение уже начатого clone само по себе не объявляется уязвимостью; проблема — недействительный UI continuation.

**Исправление:** либо действительно блокировать все способы закрытия busy modal, включая MHead, либо явно поддержать background/cancel с generation guard после await. Защитить от late UI mutations; для побочных дисковых операций отдельно описать семантику отмены.

## Что перепроверено и не требует нового finding

- **Editors / UI-01–04,06–07:** pid/path keys в RightPane и Studio; scoped saver, untouched cleanup, delete→recreate generation, recovery pending input, merge перед сохранением, большие несливаемые изменения, Esc/физические KeyS/Slash. Существующие целевые тесты проходят; это контролируемый lifecycle, не физическая раскладка/IME/React DOM.
- **Paths / UI-05:** case-insensitive ancestor/implicit folder и case-only rename проходят. F01 не опровергает эту функцию — caller передаёт старые данные.
- **Inspector / D08:** TextBox больше не держит debounce; guard `doc === el.ownerDocument` и synchronous commit подтверждены существующим исполняемым тестом. Другие Inspector controls/blur/pointer lifecycle полноценным браузером не проверялись.
- **Replace / UI-08:** существующие Worker tests подтверждают termination/error/cancel на Node worker_threads. Дополнительно новые `R06–R08` исполняют настоящий ReplaceModal с controlled hooks/worker jobs: stale apply не пишет поверх external, undo отказывает после изменения/удаления output, unmount отменяет apply без записи/ложного warning. В fixture только `import.meta.url` подставлен константой для CommonJS-transpile; реальный браузерный Worker factory не запускается.
- **Preview integration:** Studio external action передаёт captured `(p,page)` в `openProjectPreview`; RightPane current external action использует этот же helper, historical external HTML обёрнут `snapshotPreviewDocument` с opaque sandbox. Новые `R03–R04` проверяют expected request `id/name/folder/path`, ожидание capability до open, expired/malformed/non-loopback ответ, offline/no request. Тесты исполняют настоящий helper, API/opener контролируемые.
- **Webtools / match async:** `shotTarget`, `takeShotTool`, `matchHooks` ожидают capability; `R02/R05` проверяют отказ issuer без bShot и понятный error/stop. `R01` проверяет полный below-threshold prompt и три изображения на controlled image dependencies. Engine после await вызывает `T.guard()` (`src/agent/engine.ts:707–719`), loop проверяет существование цикла после before (`src/agent/loop.ts:183–187`); общей доказанной ошибки late result application в этих путях не найдено. Transport cancellation сама по себе не проверена и не обещается.
- На первом чтении match обнаружена `t.title` вне try-scope. Родитель исправил строку 101 **во время аудита**. Актуальный код и R01 проходят; **это не активный finding** и в число пяти не входит.

## Выполненные тесты и артефакты

Новые tests — **14/14 PASS**, без skip:

```sh
node --test /data/fix-tetrafree/reaudit-ui/reaudit.test.cjs
```

`F01–F05` — characterization: зелёный тест означает **воспроизведение описанного дефекта**, а не его исправление. Остальные `R01–R08` проверяют repaired/negative paths.

Существующие scoped regression — **45/45 PASS**, без skip:

```sh
cd /data/tetrafree
TSX_DISABLE_CACHE=1 node_modules/.bin/tsx --test \
  src/lib/editorSession.test.ts src/lib/editorLifecycle.ui.test.ts \
  src/lib/paths.ui.test.ts src/lib/paths.test.ts \
  src/lib/replaceJob.test.ts src/lib/replace.test.ts src/agent/match.test.ts
```

Артефакты:

- `/data/fix-tetrafree/reaudit-ui/reaudit.test.cjs`
- `/data/fix-tetrafree/reaudit-ui/new-tests.log`
- `/data/fix-tetrafree/reaudit-ui/regression.log`
- `/data/fix-tetrafree/reaudit-ui/tested-sources.sha256` — хэши исходников, фактически использованных новыми тестами; не полный репозиторный manifest.

## Что ещё должен проверить родитель

1. Настоящий React DOM порядок focus/blur/unmount, навигацию с busy clone, диалоги файлов при живом обновлении store.
2. Design undo после реальной внешней правки и версионный batch A→B до 6 секунд.
3. Browser module-worker bundling/CSP; Node worker tests не доказывают browser integration.
4. Реальные authenticated `/api/preview` → отдельный origin → bShot и Windows external opener/WebView2; истечение/отзыв capability и relative assets. Здесь listener не поднимался.
5. Изоляцию iframe/навигации и поддерживаемые браузерные функции на настоящем UI. По string/code tests нельзя объявить полную security-изоляцию проверенной.

Общий typecheck/build/lint, серверный security regression и Windows runtime не выполнялись по условиям задания. Git status недоступен: в данной копии проекта нет `.git`; commit/push не предпринимались.

### Обновление от родителя после записи основного отчёта

Родитель сообщил: актуальные preview/NewProject интеграции готовы; browser **8/8 PASS**, включая Design cleanup и opaque preview/assets; найденный им crash `projectPathKey(undefined)` исправлен null/undefined-safe реализацией и тестом. Это **сообщённый родителем результат**, не мой самостоятельный browser run. Этот уже исправленный crash в активные findings не включён. Мои NewProject fixtures контролируют `projectPathKey`, поэтому сами по себе не проверяют эту реальную dependency-интеграцию. Перечисленные F01–F05 относятся к другим ветвям кода.
