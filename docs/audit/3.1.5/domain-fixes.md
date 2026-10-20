# Domain fixes — D01–D06, storage S10/S11 (ST10/ST11)

Дата: 2026-10-13. Репозиторий: `/data/tetrafree`. Прочитаны весь AGENTS.md, docs/audit/3.1.4/domain.md, storage S10/S11 и `/data/fix-tetrafree/contracts.md`.

## Изменённые файлы (ownership)

- `src/store/slices/projects.ts`
- `src/store/slices/chats.ts`
- `src/store/slices/docs.ts`
- `src/store/slices/tasks.ts`
- `src/store/slices/memory.ts`
- `src/lib/projectIO.ts`
- `src/lib/mdfiles.ts`
- `src/workspace/Sidebar.tsx`
- `src/workspace/DocView.tsx`
- `src/modals/Forms.tsx`
- Новый тест: `src/store/slices/domain.test.ts`.

`types`, package/version/lock, чужие ownership-файлы не изменялись. Push/коммит не выполнялся. Общий check/build/prettier и браузер не запускались.

## Fixed IDs

### D01 / S10 (ST10): detach duplicate / ZIP / direct import

Общая `detachProject` в projectIO делает глубокую копию, удаляет cloud и mirror, сбрасывает path и lanes, снимает running у чатов. Новые локальные id назначаются в projects slice. Экспорт ZIP также не переносит рабочую привязку path/cloud; импорт старых архивов всё равно принудительно её сбрасывает. Прямой `importProject` применяет тот же detach, а не доверяет входному объекту.

`deploy.auto` у копии/импорта выключается: разрешение автоматического исполнения исходного проекта не наследуется. Файлы пайплайнов, история запусков, документы/чаты/задачи и их содержимое сохраняются; автозапуск можно явно включить снова. Approvals автоматизаций не переносятся: существующий autoHash содержит локальный pid, а копия/импорт получают новый pid. Облачное подключение выполняется только явно.

### D02: папка оригинала и ZIP paths

Копия/импорт остаются без папки: пользователь явно выбирает новую. Нельзя автоматически угадать свободную физическую папку по имени копии.

`projectPathKey` нормализует Windows-регистр, разделители, повторные разделители, `.` и `..` (с сохранением UNC/корня). `createProject`, `up` и `restoreProject` атомарно отклоняют уже занятую другим проектом нормализованную папку. При ошибке Immer-транзакция не применяется.

ZIP-пути проверяются через agentPathError; отклоняются выход за пределы проекта, абсолютные/недопустимые Windows-пути, коллизии регистра и file-as-parent. Проверка parent не квадратична: используется Set нормализованных имён. Контент корректных архивов сохраняется.

**Важная интеграционная граница:** см. new findings ниже — UI чужого NewProject должен обработать новый Error guard.

### D03: исходный pid для undo чата

Sidebar захватывает pid перед подтверждением и передаёт его в restoreChat. Восстановление меняет только исходный проект/его tombstone и не переключает center в чужом проекте. При удалении исходного проекта callback сообщает об отказе. Подтверждения удаления/переименования, открытые до смены проекта, не применяются в другом проекте.

### D04: Markdown import

Исходный pid захватывается при запуске выбора, до onchange/await File.text(). addDocs получает этот pid; смена активного проекта не перенаправляет импорт и не меняет чужой center. Удалённый исходный проект — отмена с уведомлением. Ошибка чтения отменяет весь импорт до записи. Успешное уведомление называет проект назначения.

### D05: TaskModal dirty fields / CAS

У формы стабильный исходный pid и baseline открытия. Перед сохранением читается свежая задача по исходным pid/id. Сохраняются только отличающиеся от baseline редактируемые поля; нетронутые внешние изменения не откатываются. Save без dirty fields — no-op.

Для dirty field, который одновременно изменился снаружи, показываются поля конфликта; черновик и форма остаются открыты. Кнопка «Сохранить мои изменения» является явным разрешением замены, привязанным к показанным значениям: если любое записываемое поле после этого изменилось, CAS снова останавливает сохранение и требует нового решения. Enter тоже не закрывает форму при конфликте.

Удалённую задачу форма не воскрешает. saveTask с отсутствующим существующим id возвращает пустой id и не создаёт новую задачу. Комментарий дописывается к свежему списку комментариев по исходному pid. Делегирование и его 60ms callback проверяют исходный проект; после переключения фоновая отправка отменяется с сообщением, а сохранённые задача/чат остаются. Новая форма чата тоже удерживает исходный pid и не переключает чужой center.

### D06: image insert

DocView удерживает pid в замыкании; после shrinkImage перечитывает свежие блоки именно исходных pid/doc.id и обновляет документ с явным pid. Существующие concurrent blocks не заменяются старым render snapshot. При удалении исходного проекта/документа сообщает об ошибке, не ищет одноимённый id в другом проекте. Callback открытия file chooser тоже сохраняется в ref, так что смена render до выбора файла не переназначает вставку.

### S11 (ST11): stamps без изменения схемы

- renameChat обновляет `lastAt = max(Date.now(), lastAt + 1)` только при фактическом изменении title.
- editMemory обновляет `at = max(Date.now(), at + 1)` только при фактическом изменении text/kind.
- lastAt чата теперь означает последнюю активность, включая rename/restore, а не строго время последнего сообщения. pushMsg не уменьшает этот stamp.
- at памяти теперь время последнего изменения заметки, а не неизменяемая дата создания.

Это осознанная совместимость с существующими stamps sync без новых типов/миграции. Three-way merge и сохранение конфликтов — scope sync-агента (D07), не заявляется исправленным только stamps.

## Optional pid actions

Реализованы уже объявленные главным action signatures:
`createChat(o,pid?)`, `createDoc(pid?)`, `addDocs(docs,pid?)`, `updateDoc(id,patch,pid?)`, `saveTask(t,pid?)`, `restoreChat(chat,index,pid?)`.

Явный отсутствующий pid не падает обратно на текущий проект. createChat/createDoc/addDocs/restoreChat меняют center только если адресованный проект сейчас активен. Повторная задача из saveTask сохраняется в тот же pid.

## Tests / verification

Новый файл внесён в `/data/fix-tetrafree/domain-test-files.txt` и `/data/fix-tetrafree/test-files.txt`. package.test должен подключить главный агент; package.json не изменялся.

Команда:

```sh
./node_modules/.bin/tsx --test src/store/slices/domain.test.ts src/lib/{mdimport,docmd,taskrel,taskviews,chatExport,settingsIO}.test.ts
```

Результат: **43/43 PASS = 17 новых + 26 существующих**. Лог: `/data/fix-tetrafree/domain-tests.log`.

Проверены detach и независимость копии, настоящий ZIP roundtrip/старый ZIP, unsafe/colliding paths, atomic create/up/restore folder guard, undo к исходному проекту/tombstone, optional pid actions и center, deleted-origin no fallback, повтор задач, монотонные/no-op stamps, настоящий Markdown onchange с отложенным File.text, настоящий DocView addImages с отложенным shrinkImage и одинаковыми doc ids, stale/deleted TaskModal, dirty-field merge/CAS/Enter, новая форма чата после переключения проекта.

UI-тесты исполняют настоящий TS/TSX callback-код (transpileModule, точки capture добавлены только в памяти тестового loader). React hooks/JSX/DOM/bitmap API заменены управляемыми зависимостями. Slices исполняются с настоящим Immer и детерминированными set/get. Это **не браузерный E2E и не проверка React lifecycle/Windows disk/настоящего облака**.

Scoped TypeScript по 11 собственным файлам: **0 diagnostics**; скрипт `/data/fix-tetrafree/domain-typecheck.cjs`, лог `domain-types.log`. Он вызывает syntactic/semantic diagnostics только для этих файлов, не общий tsc/build.

Scoped ESLint для этих 11 файлов: **PASS**, лог `domain-lint.log`. Prettier запускался только --write собственных файлов; финальный own --check записан в `domain-format.log`.

## Limitations / new findings

1. **Требуется правка главным/UI агентом, вне ownership:** `src/modals/NewProject.tsx` сравнивает dup/taken сырыми строками (около 70/541), а createProject около 137 и ProjectFolderModal.go/up около 570 не обёрнуты catch/finally. Теперь нормализованный alias папки безопасно отвергается store Error, но UI может оставить busy=true/показать unhandled promise. Нужно использовать экспортированный `projectPathKey` в dup/taken и catch/toast/finally вокруг create/up. Этот чужой файл не менялся.
2. Lexical folder normalization не определяет junction/symlink/8.3 aliases: физическая canonical identity требует server/Windows проверки. На Windows не проверялось.
3. Не выполнена миграция ранее сохранённых уже связанных cloud/path-копий: новые duplicate/import безопасны; существующие опасные bindings требуют отдельного repair/UX решения. Нельзя молча отсоединять все общие записи без определения намерения пользователя.
4. CAS сравнивает структурные значения dirty fields, не CRDT. Изменения внутри одного массива subtasks/labels/dependencies консервативно требуют явного подтверждения; независимые поля сохраняются автоматически.
5. Черновик сохраняется в открытой форме при ошибке/конфликте, но не обещается durable draft после закрытия формы/перезапуска приложения.
6. ZIP binary/non-UTF8 fidelity и полноценная schema validation произвольного metadata — прежние отдельные ограничения; исправлялись identity и paths, не формат ZIP в целом.
7. D07/D08 и остальные storage IDs здесь не менялись: соответствующие файлы принадлежат другим агентам.
8. Главному отправлено итоговое сообщение через session tool, включая необходимость обработки guard Error в NewProject; предыдущие попытки во время прерванного continuation завершались capability failure.
