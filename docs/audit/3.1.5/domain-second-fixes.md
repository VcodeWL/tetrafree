# Domain second pass — R03–R06

Дата: 2026-10-15. Проект `/data/tetrafree`. Прочитаны полностью `/data/fix-tetrafree/reaudit-storage.md`, точные fixtures `reaudit-storage/regressions.mts` (R03–R06), их `regressions.log`, действующий `contracts.md`. Предыдущий domain-fixes.md — исторический снимок первого прохода; этот отчёт дополняет его.

## Scope / ownership

Исправлены **R03, R04, R05, R06**. R01/R02/R07/R08 — у persistence-автора, Design/files — у UI-автора, NewProject — у parent; эти файлы/задачи не менялись.

Изменения второго прохода:
- `src/workspace/DocView.tsx`
- `src/lib/backup.ts` (scope расширен parent)
- `src/lib/projectIO.ts`
- `src/store/slices/memory.ts`
- `src/store/slices/docs.ts`
- `src/modals/Activity.tsx` (реальный callback R05 из fixtures)
- `src/workspace/Sidebar.tsx`
- `src/store/slices/domain.test.ts` (12 новых проверок второго прохода; существующие тесты сохранены).

Optional pid для deleteDoc/restoreMemory/editMemory добавил parent в common types; здесь реализованы только slices/UI. Common types, package/version/lock, чужие production-файлы не менялись. Не выполнялись global check/build/format, browser, push/commit.

## R03 — CAS replacement target до/после ожиданий

`addImages` больше не заменяет текущий replaceId только потому, что id ещё существует. На старте фиксируется expected snapshot, после shrinkImage current target сравнивается структурно. Заменяется лишь совпадающий пустой текстовый placeholder; если пользователь напечатал текст/изменил тип/флаги блока, он сохраняется, а image вставляется рядом.

Paste передаёт snapshot своего блока. File chooser захватывает snapshot очищенного от slash-префикса placeholder ещё до выбора файла и передаёт его после выбора. Это закрывает как ожидание compression, так и промежуток до начала compression. Неизменившийся пустой placeholder по-прежнему заменяется без лишнего пустого блока. После первого результата replaceId сбрасывается, поэтому несколько выбранных картинок не заменяют друг друга.

Existing D06 invariants сохранены: fresh blocks адресуются исходными pid/doc.id; concurrent независимые blocks остаются; удалённый source не приводит к fallback в текущий проект.

## R04 — backup import использует тот же detach

`importBackup` вызывает общий `detachProject`, а не собственную неполную spread-нормализацию. Сбрасываются cloud/path/mirror/lanes, deploy.auto и chat.running. Каждый добавляемый проект получает **новый** local id даже если старый id сейчас свободен: импорт не наследует approvals/локальные sync namespaces ранее удалённого проекта. Коллизии с текущими/другими импортируемыми id предотвращены.

`unpackVersions` сохранён; тест проверяет настоящий packed delta → полные два snapshot после импорта. Содержимое файлов, текст чатов и история сохраняются.

Общий detach также нормализует stale runtime: agent.streaming=false/stopped=true, thinking снимается; file part в writing и cmd part в running переходят в error; тексты сообщения, file parts и cmd output сохраняются. Runtime subagent lists очищаются. Данные предложенных/прошлых ходов не удаляются и никакие commands/pipelines тестом или импортом не запускаются. Автозапуск можно явно разрешить снова.

## R05 — memory undo и delayed edit/blur по исходному pid

`restoreMemory(m,pid?)` ищет только указанный проект. Восстановление снимает tombstone именно там; новый at строго больше прежнего stamp и deletion stamp. Уже живую запись не перезаписывает, поэтому повторный undo не откатывает новое редактирование.

Activity удерживает исходный проект модалки. Toast undo захватывает pid в момент удаления и передаёт его в action; при удалённом origin показывает отказ без переноса заметки в текущий проект. Undo не меняет активный center. `editMemory(id,patch,pid?)` и delayed saveEdit/blur также используют origin, включая совпадающие ids после duplicate. Если origin/record удалён, edit draft остаётся в модалке с предупреждением. Переключение kind и remember тоже scoped. Переход к чату из модалки не меняет чужой center; stale delete требует открыть исходный проект.

## R06 — document captured rename/delete по исходному pid

Оба doc-dialog callback в Sidebar фиксируют pid до открытия диалога. Rename передаёт его в updateDoc, delete — в новый optional-pid deleteDoc. Actions не перенаправляют explicit missing pid на current. Source document удаляется/переименовывается даже если активирована копия с тем же doc.id; копия остаётся неизменной.

`deleteDoc` меняет center только если source project активен, tombstone пишет исходному проекту. Удалённый origin приводит к понятному отказу; отсутствующая исходная doc не ищется в копии. Общие entity IDs при duplicate остаются допустимыми и не подменяются глобальной регенерацией.

## Scoped verification

Manifest: `/data/fix-tetrafree/domain-second-test-files.txt` и alias `/data/fix-tetrafree/domain-second-testlist.txt`:

```text
src/store/slices/domain.test.ts
```

Новые проверки добавлены в уже существующий файл, новые package entries не нужны сверх включения этого файла parent-ом. Общие manifests первого прохода не перезаписывались.

Команда:

```sh
./node_modules/.bin/tsx --test src/store/slices/domain.test.ts src/lib/{mdimport,docmd,taskrel,taskviews,chatExport,settingsIO}.test.ts src/store/snapshots.test.ts
```

**60/60 PASS:** 30 domain (18 существовавших на старте второго прохода + 12 новых), 26 смежных, 4 snapshots. Лог `/data/fix-tetrafree/domain-second-tests.log`.

12 новых тестов проверяют:
1. Изменение текста именно replace-target при pending compression — текст не теряется.
2. Неизменившийся empty placeholder всё ещё заменяется.
3. Изменённый тип/checked empty-block не стирается.
4. Настоящий backup import: не наследуются execution/mirror/running/streaming, id новый при свободном исходном id; delta snapshots, тексты и outputs сохранены.
5. Настоящий Activity undo после A→B без совпадения ids восстанавливает A/tombstone/stamp.
6. Undo не меняет duplicate-id B и не перезаписывает уже восстановленную live-note A.
7. Удалённый origin — warning, никакого memory fallback.
8. Настоящие Sidebar rename/delete callbacks после actual duplicateProject адресуют A; B/center не меняются, tombstone A выставлен.
9. Удалённый doc origin — оба captured callbacks не меняют B.
10. Chooser-CAS сохраняет изменение target, случившееся до начала compression.
11. Настоящий Activity edit/blur после switch редактирует только A; удалённый origin не получает fallback, draft сохраняется.
12. Explicit missing pid в editMemory/restoreMemory/deleteDoc не меняет совпадающие ids current copy.

TSX выполняется через in-memory transpile/capture production callbacks с контролируемыми React hooks/JSX, file/bitmap IO; slices — реальные с Immer. Это не browser E2E и не проверка полного React lifecycle. Backup callback настоящий, store adapter теста детерминированный и не пишет пользовательские storage.

Scoped TypeScript по 13 собственным файлам с ambient `vite-env.d.ts`: **0 diagnostics**, лог `domain-second-types.log` (скрипт `domain-typecheck.cjs`; не общий tsc/build). Scoped ESLint по 8 файлам второго прохода: **PASS**, лог `domain-second-lint.log`. Prettier --write/--check только этих файлов: **PASS**, `domain-second-format.log`.

Исходный независимый regressions.mts намеренно проверяет наличие старых дефектов и извлекает точные старые callback strings; после исправлений он не является green acceptance suite. Его и чужие R01/R02/R07/R08 assertions не менял; безопасное поведение проверяется новыми negative tests production callbacks.

## Ограничения и handoff

- Не выполнялись Windows/WebView2/browser/IndexedDB/network/scheduler integration; никаких реальных pipeline/commands/аккаунтов не использовалось.
- Физические Windows aliases/junctions, полная schema validation backup, binary ZIP fidelity, distributed cloud CAS и ранее сохранённые опасные bindings не заявляются исправленными этим проходом.
- Подтверждение/cancellation существующих runtime операций в оригинале не затрагивается: detach меняет только копию. Stale runtime отображается завершённым/ошибочным в импортированной истории, partial output не удаляется.
- Значение auto=false — снятие у новой копии унаследованного разрешения, не удаление механизма автоматизаций.
- Замечание первого domain-fixes.md о raw/catch NewProject уже устранено parent в текущем дереве, что подтверждает полный reaudit-storage.md. Новую правку NewProject здесь не выполнял.
