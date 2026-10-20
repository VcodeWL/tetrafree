# Recovery/lazy review — scoped author fix

Исходный независимый аудит `/data/next-tetrafree/recovery-review.md` и его внешние characterization fixtures сохранены без правок. Этот документ — отчёт **автора исправлений**, не независимая повторная приёмка. Scope: R01 compose/goto delivery, R02 inner Suspense. Production edits вне перечисленных ниже файлов не делались.

## R01 / Medium — исправлено в production; desired portable regressions PASS

### Compose

- Новый `src/store/navigation.ts:68–78`: `composeToChat(pid, chatId, text)` проверяет текущий workspace, pid и принадлежность чата проекту; пишет текст сразу в существующий store draft, **не требует смонтированного Composer**. Непустой пользовательский черновик сохраняется целиком, включая конечные переводы строк; prefill добавляется после двух переводов строки. Никакой автоматической отправки сообщения.
- `src/workspace/RightPane.tsx:1392–1405`: `askAgent` проверяет проект, выбирает только принадлежащий ему чат или создаёт новый; больше нет delivery timeout 30 ms.
- `src/modals/Palette.tsx:689–701`: упоминания существующего/нового чата используют тот же helper; stale captured project отсекается перед созданием чата.
- `src/workspace/Composer.tsx:100, 141–181`: фокус — лишь необязательное событие `tf:compose-focus`; перед фокусом/legacy compose проверяются captured pid, активный чат и принадлежность чата. Cold mount читает draft через существующую store-подписку. Новый focus handler не переписывает draft, старые слушатели снимаются.
- Store update здесь не является подтверждением дискового checkpoint: используется обычный существующий persistence pipeline. Новый код не обещает durability при аварийном завершении процесса.

### Goto

- `src/store/navigation.ts:5–66`: **один** pending intent, latest-wins. Он содержит pid, file, line, исходный текст файла и срок пригодности 60 секунд. Нет таймера ожидания готовности UI и нет периодического retry.
- `gotoFile` проверяет pid/workspace, существование собственного file key, положительный целочисленный line; синхронно открывает файл, регистрирует intent и пытается доставить. `consumeGoto` регистрирует готовый компонент и немедленно проверяет pending.
- Только consumer с совпадающими pid/file получает запрос. ACK снимает pending и store subscription **до** callback; StrictMode/remount/reentrant updates не повторяют запрос. Unmount снимает consumer.
- До доставки проверяются текущий pid, screen, activeFile, rightTab, rightOpen и исходный текст. Навигация прочь, удаление/замена содержимого или закрытие панели отменяют запрос; возвращение к старому target не воскрешает его. Истечение 60 секунд проверяется при store update/consumption: это bounded validity, не фоновый таймер очистки. В простаивающем приложении остаётся максимум один слот и одна подписка до следующего update/mount/request.
- `src/workspace/CodeEditor.tsx:130–164`: реальный effect CodeSurface потребляет pending после mount; existing flash-clear timer 2200 ms остаётся только анимацией, не доставкой. Legacy DOM goto остаётся best-effort для совместимости и имеет pid/file/line guards.
- `src/lib/search.ts:47–49`: code search result захватывает pid и вызывает helper, timeout 60 ms удалён.
- `src/modals/Palette.tsx:124,163,188–192`: line navigation / TODO code action используют helper. Cross-project search открывает проект синхронно и выполняет результат только при совпадающем pid/workspace, вместо 350 ms ожидания UI. Холодный редактор подтверждает goto при mount.
- Legacy произвольные внешние `tf:compose` / `tf:goto` события не превращены в общую надёжную очередь; исправлены внутренние перечисленные producers. Типы событий/общий store schema не менялись.

## R02 / Low — исправлено в production; desired SSR/output regressions PASS

`src/modals/ModalRoot.tsx:22–38`: inner Suspense теперь показывает `ModalLoading`, а не null. Это существующий Modal shell с именованным dialog, MHead, status и кнопкой «Отмена». Busy не выставлен; existing shell предоставляет focus handling, Escape, backdrop и header close. Cancel вызывает только closeModal. App, Forms, RecoveryModal и recovery helper не изменялись.

Реальный React Suspense + реальный Modal shell в server render подтверждают видимый nested cold-Recovery fallback. Отдельный output test проверяет кнопку отмены и вызов closeModal. SSR не проверяет реальную клавиатуру, layout, динамическую загрузку браузера или hydration.

## Проверки

Команда (только scoped):

```
TSX_DISABLE_CACHE=1 node_modules/.bin/tsx --test src/store/navigation.test.ts src/modals/ModalRoot.lazy.test.ts src/lib/palette.test.ts src/lib/recoveryCenter.test.ts
```

**26/26 PASS** = 12 новых navigation desired tests + 2 новых ModalRoot desired tests + 3 существующих palette + 9 существующих recovery.

Новые тесты исполняют текущий production helper и извлечённые реальные askAgent/search/CodeSurface effect/Composer effect; fixtures контролируют store, clock, DOM listeners и ref endpoints. Это compiler/component harness, не Browser E2E. Cold-consumer/ACK/expiry/target cancellation и draft preservation — desired assertions, не characterization плохого результата. Palette call sites просмотрены по коду; полного интерактивного Palette E2E нет.

Scoped ESLint: 0 diagnostics. Scoped compiler API diagnostics для 9 изменённых файлов: 0. Prettier применён только к этим файлам. Логи и manifest: `/data/next-tetrafree/navigation-fix/` (`tests.log`, `eslint.log`, `typecheck.log`, `tested-sources.sha256`).

## Handoff / файлы

Production:

- `src/store/navigation.ts` (новый)
- `src/lib/search.ts`
- `src/modals/Palette.tsx`
- `src/modals/ModalRoot.tsx`
- `src/workspace/RightPane.tsx`
- `src/workspace/Composer.tsx`
- `src/workspace/CodeEditor.tsx`

Новые portable tests:

- `src/store/navigation.test.ts`
- `src/modals/ModalRoot.lazy.test.ts`

**Parent: добавить оба теста в явный npm test list.** Список: `/data/next-tetrafree/navigation-test-files.txt`. package не изменён по ограничению ownership; до регистрации тесты запускаются указанной scoped командой, а не автоматически общим npm test.

Не запускались global checks/build, browser, server/listeners, native Windows runtime. Не менялись App/Forms/RecoveryModal/helper/types/package, другие author-owned подсистемы. Commit/push отсутствуют. Заявленный результат — scoped production fix + portable desired tests, не полная браузерная/Windows приёмка.

## Stable handoff: legacy UI06 harness integration

Дополнительная правка только `src/lib/editorLifecycle.ui.test.ts`: compiler fixture теперь загружает **реальный** `src/store/navigation.ts` с существующим fixture store и передаёт exports в CodeSurface. Это не no-op `consumeGoto`: production registration и cleanup исполняются. В keyboard fixture pending goto отсутствует; доставка отдельно покрыта desired navigation suite. Существующие assertions UI06/07 (save, comment, Escape/finish/blur/preventDefault) и остальные проверки файла не менялись. Production, Forms/taskConstants fixtures, team/account fixtures не затронуты этой правкой.

Повторный scoped прогон `editorLifecycle.ui.test.ts` + прежние четыре suite: **33/33 PASS**, включая UI06/07. Scoped ESLint для исправленного harness и scoped TypeScript diagnostics для прежних файлов + этого harness: 0. Логи: `navigation-fix/legacy-handoff-tests.log`, `legacy-harness-eslint.log`, `legacy-handoff-typecheck.log`; hash: `legacy-harness.sha256`. Общие проверки/браузер/сервер не запускались. Navigation scope завершён; дальнейших правок сейчас не производится.
