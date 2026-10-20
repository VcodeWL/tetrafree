# UI second fixes — F01, F02, F03

Дата: 2026-10-15. Весь `/data/fix-tetrafree/reaudit-ui.md` и `reaudit-ui/reaudit.test.cjs` прочитаны. Исправлены F01–F03; F04/F05, NewProject, Forms/MHead и preview не менялись. Никаких package/lock/types/target/lib изменений, общего check/build/formatter, browser, push или Windows-runtime запуска.

## F01 — свежие файловые диалоги + атомарные store collision/CAS guards

- Новый `src/lib/filePreimage.ts`: одно volatile наблюдение на store, ревизии файлов/папок без изменения persisted schema. Отличает external update, ABA и delete→recreate при наблюдаемых store transitions. Capture включает source subtree, exact contents, dirs и ревизии. `matchesFileTree` повторно проверяет фактический transaction draft, а не старый React project.
- В `src/store/slices/files.ts` экспортирован `mutateFileTree(set,pid,op)` без добавления Actions/types: atomic create/mkdir/rename/delete/replace/restore с captured source preimage и явным исходным pid. Destination проверяется внутри одной immer transaction через case-insensitive `checkPath`, включая implicit folders и file ancestors. Restore проверяет все назначения до первого изменения. Rename сначала staging-ит перемещения, не перетирает destinations обходом исходного map.
- Обычные store `renamePath/renameFile` также получили collision validation. Создание нового пути через обычный writeFile и addDir защищено от file/dir/регистровых коллизий. **Явный exact-file overwrite через writeFile сохранён**: это существующий API редакторов/агента, его нельзя механически превратить в create-only. Existing-file paths, которые длиннее UI new-name limit, по-прежнему редактируются; addDir остаётся idempotent ensure API для exact existing/implicit directories.
- RightPane new/rename dialogs читают свежий исходный проект в `check`; `run` не доверяет check и использует atomic mutation. Source generation фиксируется при открытии rename/delete. После смены active project операция не переезжает в B и не открывает там чужой файл.
- File operation undo/redo тоже условные, с обновлением ожидаемой ревизии после успешного собственного inverse. Drag-move и delete confirmation приведены к тем же guards. Ошибка даёт warning без success/history/retab, исходный и чужой destination остаются нетронутыми.
- Guarded delete сохраняет **полный** удаляемый текст в project.trash, с уникальным именем при наличии старой trash-копии; не применяет FILE_MAX и не вытесняет исходную recovery-копию этой операцией. При stale source — ничего не удаляет. Undo restores atomically; redo откажет после внешней правки.

## F02 — Design undo/redo: pid/page, output preimage, revision, lineage

- `design/store.ts` хранит typed entries `{pid,page,before,after,expected,lineage}` вместо bare string snapshots; введён текущий `pid`, Studio задаёт его при reset контекста. Остальные UI callers продолжают использовать длину массивов и штатные undo/redo buttons.
- Undo и Redo симметрично проверяют владельца, страницу, ожидаемый output и поколение внутри atomic store CAS. External update/ABA/delete/recreate дают warning и **не пишут вообще** — external text остаётся live, не прячется лишь в volatile redo.
- Нормальные multiple undo→undo→redo→redo сохранены: после собственного inverse ребазируется только соседний шаг известной local lineage. Внешнее поколение начинает новую lineage; одинаковый текст после ABA не разрешает coalescing или оживление старого undo через последующий локальный inverse.
- Coalesced typing сохраняет исходный before и последний after, обновляя output preimage; coalescing не пересекает pid/page, flush или внешнюю ревизию.
- Дополнительная защита commitDoc: документ связывается с исходными pid/page/preimage при подключении Canvas через подписку Design store. Element-bound commits передают ownerDocument. Stale DOM не затирает external: полный локальный HTML сохраняется **в persisted project.trash** плюс warning/download action. In-memory history затем можно очистить — recovery остаётся в project data. Detached old-document commit не записывает B и не добавляет историю в текущий другой документ.

## F03 — version debounce владеет документом

- Вместо глобальных labels/vTimer, читающих текущий projectId на flush, batches keyed `[pid,page]` хранят captured owner и собственные labels/timer.
- Timer и transition/unmount flush вызывают `commit(..., capturedPid)` и описывают captured page. Несколько документов получают отдельные batches. Удалённый owner не fallback-ит на активный B.
- Flush чистит coalescing boundary; явный flush + последующий timer не создают дубль.

## Тесты / результаты

Новые repo tests зарегистрированы в `/data/fix-tetrafree/ui-second-test-files.txt`; их имена также добавлены в прежний `/data/fix-tetrafree/ui-test-files.txt`:

- `src/lib/filesCas.ui.test.ts` — реальные извлечённые newAt/renameAt/removeAt callbacks плюс реальные filesActions/mutateFileTree/checkPath на observable Zustand + Immer fixtures: late destination, post-check race, implicit folder, source change/ABA/delete-recreate, исходный pid, case-only rename, normal undo/redo, direct-store collision, raw CAS, full-size trash recovery, atomic restore, сохранение explicit overwrite/idempotent ensure-dir functionality.
- `src/design/historyIntegrity.test.ts` — настоящий actions.ts, настоящий filesActions/mutateFileTree и observable Design fixture с синтетическим DOM serializer: normal multi-step undo/redo, typing coalescing, external preimage/ABA/delete-recreate с обеих сторон, fully reloaded external canvas, cross-pid/page, detached original-doc save, persisted-state recovery >FILE_MAX, отдельные owner batches, no duplicate flush, coalescing reset, ABA lineage.
- `src/lib/uiSecondTestHelpers.ts` — scoped test fixture helper, не production workflow/dependency. Fake DOM/network не выдаются за browser verification.

Final targeted command:

```
TSX_DISABLE_CACHE=1 node_modules/.bin/tsx --test src/lib/filesCas.ui.test.ts src/design/historyIntegrity.test.ts src/lib/editorSession.test.ts src/lib/editorLifecycle.ui.test.ts src/lib/paths.ui.test.ts src/lib/paths.test.ts src/lib/replaceJob.test.ts src/lib/replace.test.ts
```

**Финал: 60/60 PASS, 0 skipped (22 новых + 38 прежних UI tests). Scoped TypeScript: 0 diagnostics; scoped eslint: 0 errors/warnings. Все 9 собственных файлов отформатированы точечно.**

Итоговые результаты/логи: `/data/fix-tetrafree/ui-second-tests.log`, `ui-second-types.log`, `ui-second-eslint.log`. Прежние 38 UI tests входят в этот прогон. TypeScript проверялся только по diagnostics собственных 9 файлов compiler API, не общий project check. Array.at в новых тестах удалён, target/lib не поднимались. Исходные external characterization tests F01–F03 ожидают старый дефект и не переписывались под fake-green: новые repo tests утверждают repaired outcomes и используют обновлённый API.

## Границы и остаточные риски

- Не Windows-tested, не browser/React DOM tested; real focus/blur/iframe reload ordering, native filesystem generations, persistence crash/restart и browser preview/worker должен проверить parent. Volatile revision tracker различает наблюдаемые immutable store transitions, а не inode events на диске без изменения state.
- Recovery лежит в штатном persisted project.trash, значит имеет обычную retention/квоту хранилища; это не бессрочный отдельный архив. Runtime persistence IO/restart не проверялся этими controlled tests. Если удалён весь original project, выводится явный download warning (как в первом UI handoff); orphan-project archive не добавлялся.
- On stale history UI отказывает с предупреждением, а не пытается автоматически merge undo поверх внешних данных. Штатный свежий undo/redo и coalescing проверены и работают.
- UI RenameModal сам закрывается до run; post-check CAS race теперь не теряет данные и сообщает warning, но диалог для retry надо открыть заново (Forms не в этой ownership).
- NewProject F04/F05 и preview оставлены родителю без изменений.
