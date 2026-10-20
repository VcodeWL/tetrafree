# Final scoped UI acceptance — F01–F05

Дата: 2026-10-15, финальный снимок проверен **13:44 UTC**. Приёмка начата после появления `/data/fix-tetrafree/ui-second-fixes.md`. Это отдельная независимая проверка исправленного кода; historical audit не переписывается.

## Итог

**В заявленном controlled/scoped scope F01–F05 приняты.** Независимый внешний desired acceptance — **6/6 PASS**. Финальная scoped repo regression — **77/77 PASS**, включая **10/10** `newProject.lifecycle.test.ts`. Нет skipped/failed tests. Это не утверждение об общей browser/Windows/security-сертификации.

| Finding | Desired witness / результат |
| --- | --- |
| F01 | Captured New/Rename dialogs видят поздний destination. Прямой вызов stale `run`, в обход render-time check, не меняет ни source, ни новый чужой destination; выдаёт warning. Fresh операции работают и после active A→B остаются в исходном A. |
| F02 | После внешнего текста и перезагрузки controlled canvas stale Undo отказывает без записи и не теряет историю. Последующая fresh local edit сохраняет external в `before`, а не теряет его при очистке redo. Отдельно проверены stale Redo и delete→recreate generation. |
| F03 | Тот же исходный порядок witness: правка A → active project B → transition flush. Версия создаётся в A со snapshot A; B не получает версию. Дополнительно настоящие timer callbacks и отдельные page batches сохраняют captured owners. |
| F04 | В repo tests режимы new/open/clone и ProjectFolder при `reconcile === null` дают warning без false `ok`, сохраняют retry с исходным pid. |
| F05 | В repo tests resolved success/failure и **rejected late clone** после unmount не создают проект, не запускают reconcile, не выдают toast и не закрывают следующий UI. Busy Modal передаёт context, MHead disabled. Positive controls для mounted clone и idle/standalone MHead проходят. |

## Независимый acceptance-файл

Создан новый внешний `/data/fix-tetrafree/reaudit-ui/acceptance.test.cjs`:

```sh
cd /data/tetrafree
node --test /data/fix-tetrafree/reaudit-ui/acceptance.test.cjs
```

**6/6 PASS:** три исходных witness-группы F01/F02/F03 теперь с **desired assertions**, плюс независимые positive/negative controls. Дефектное поведение здесь не ожидается.

Тесты не импортируют author test helpers или author regression tests. Самостоятельный harness выполняет настоящие:

- извлечённые callback bodies `newAt`/`renameAt` из RightPane;
- `checkPath`, `filePreimage`, `mutateFileTree`, `filesActions`, trash helpers;
- Design actions с реальной подпиской на observable store.

State transitions — настоящие Zustand + Immer, с immutable snapshots и subscribe notifications; generation guards не заменены моками. UI navigation/menus/toasts и DOM serialization контролируемые. Это не полное исполнение React CodePane/Canvas и не браузерное событие.

Пути внешнего теста вычисляются относительно файла; можно указать `TETRAFREE_ROOT`. Тест не пишет проект и не запускает listeners. Manifest принятого production-кода: `reaudit-ui/acceptance-tested-sources.sha256`. После завершения все его записи повторно проверены: **OK**.

## Десятый portable repo test

В существующий разрешённый `src/modals/newProject.lifecycle.test.ts` добавлен только один тест:

`F05: rejected clone after unmount stays silent and cannot create project or start reconcile`

Он запускает настоящую pending clone-ветвь, проверяет busy, вызывает controlled unmount, затем reject deferred Promise. Assertions: **0 creations, 0 sync calls, 0 notices, 0 modal closes**. Транспорт/реальный git не запускаются.

Файл по-прежнему зарегистрирован в `/data/fix-tetrafree/parent-test-files.txt`. Package scripts не менялись мной. Scoped eslint этого testfile — **0**, scoped TypeScript compiler API с единственным test root/настройками tsconfig/noEmit — **0 diagnostics**. Prettier применён только к разрешённому testfile.

## Финальный scoped repo прогон

```sh
cd /data/tetrafree
TSX_DISABLE_CACHE=1 node_modules/.bin/tsx --test \
  src/modals/newProject.lifecycle.test.ts \
  src/lib/filesCas.ui.test.ts src/design/historyIntegrity.test.ts \
  src/lib/editorSession.test.ts src/lib/editorLifecycle.ui.test.ts \
  src/lib/paths.ui.test.ts src/lib/paths.test.ts \
  src/lib/replaceJob.test.ts src/lib/replace.test.ts src/agent/match.test.ts
```

**77/77 PASS.** Сюда входят 10 NewProject tests, новые repo-тесты автора F01–F03 и прежняя UI/editor/path/Replace/match regression. Это scoped список, не общий test/check/build.

Логи в `/data/fix-tetrafree/reaudit-ui/`:

- `acceptance-tests.log` — независимые desired witnesses, 6/6;
- `acceptance-scoped-regression.log` — финальный repo-прогон, 77/77;
- `acceptance-newProject-tests.log` — отдельный NewProject-прогон, 10/10;
- `acceptance-newProject-eslint.log`, `acceptance-newProject-types.log`;
- `acceptance-newProject-format.log`;
- `acceptance-tested-sources.sha256`.

## Границы и historical status

- Original `/data/fix-tetrafree/reaudit-ui/reaudit.test.cjs` **не изменён**. Его characterization expectations старых ошибок не превращались в fake-green и не перезапускались как acceptance.
- Original `/data/fix-tetrafree/reaudit-ui.md` **не изменён**; hash проверен. Ранний `ui-parent-verification.md` фиксирует предыдущий 9-test снимок; настоящий документ дополняет его десятым rejected-clone test, не переписывая историю.
- В production в этой задаче изменений мной нет. Единственная repo-правка — добавленный десятый тест в ранее разрешённом файле. Остальные новые артефакты — вне проекта.
- Global check/build/lint/formatter, browser и listeners не запускались. Нет commit/push. Существующие проверки author/parent не выдаются за мой browser run.
- Реальный React focus/blur/iframe scheduler, Windows/WebView2, filesystem inode events, транспортная отмена, persistence crash/restart и quota behavior этим acceptance не сертифицируются. Volatile generation tracking проверен на observable store transitions. Browser acceptance остаётся у родителя.

## Контрольные SHA-256

```text
92abd48e6297f35d105a017368f5a931653d733b3bce47cd218696c11c79074b  historical reaudit-ui.md
c0ef952bd3b753e8ab8e1e3a78bc73d7b4f09b07ad0cb5a12926a7dbddefcd5b  historical reaudit-ui/reaudit.test.cjs
a3ab0853e73843d89fb5bbb0038297716f9e18b68056f0da3729a46a3076bf3c  src/modals/NewProject.tsx
ee0fe6ca35017a807de364cc3adeb391b763cbd697f9b399149054c1fdfe8bf0  src/components/ui/Modal.tsx
8543b8c86d46e322b04058582dae78b33fdb2b01a73f4709f0648609dcaa5f95  src/modals/newProject.lifecycle.test.ts
```
