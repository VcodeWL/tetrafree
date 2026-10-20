# AUTOMATIONS — готовый scope

## База и границы

Прочитан AGENTS.md целиком. В package.json подтверждена 3.1.5; commit 74da4a9 задан координатором (в рабочей копии нет доступной git history для независимой проверки commit). Предыдущие agent audit fixes сохранены. Нет правок server/backend API, Rust/Cargo, types/store/schema/persistence/vault, App/TitleBar/Settings, package/lock/version в этом scope. Нет global check/build/format/browser/push.

## Реализовано

- `automationControl.ts`: единый зарегистрированный cancellation hub, epoch для отложенных действий, персистентная глобальная пауза и opt-in уведомлений. `stopEverything()` ставит расписания на паузу, прерывает движки/повтор команд, циклы, активный pipeline exec, debounce/open/trigger dispatch, снимает parked queue timers и очищает очередь. Ошибка одного cancellation listener не препятствует остальным.
- `AutomationControls.tsx`: реальный компонент для TitleBar/StatusBar/настроек: «Пауза автоматизаций» / «Возобновить автоматизации», «Остановить всё». Никакой scheduler компонент сам не запускает. Родитель владеет глобальным размещением.
- `automationJournal.ts`: собственный versioned localStorage key `tf-automation-journal-v1`, максимум 100 записей, отдельный текущий месячный ledger максимум 1000 opaque identities. Live run не выталкивается ради нового. Записи белого списка: случайный ID, SHA-256 project/automation identity и approval, время, исход/reason enum, семейство модели, оценка и резерв USD. Не пишутся запросы, содержимое/пути файлов, имена проекта/автоматизации, task context, URL провайдера, ключи или текст исключения.
- После перезапуска running → interrupted с понятной причиной; автоматического replay/retry нет. Резервы сохраняются независимо от усечения истории. Unknown/corrupt journal не перезаписывается, новые запуски fail-closed. Ошибка записи также блокирует новый dispatch.
- Agent-run history получает **фактический** исход из engine, а не успех после постановки: succeeded / failed / cancelled / blocked; незавершённый после restart — interrupted. Предложения правок отмечены отдельно: ответ завершён, решение ожидается в чате. Сразу снимается running и выставляется quiet interval для собственных файловых изменений (без ожидания 15-секундного housekeeping).
- UI автоматизаций: история текущего проекта, включая удалённые/переименованные конфигурации (обезличены при отсутствии текущего имени), семейство модели, оценка, консервативный резерв, почему не выполнено, ручной повтор с подтверждением. Нет восстановления старых промптов/файлов. Retry перечитывает текущую конфигурацию и approval, проверяет проект/epoch после async hash. Изменённый/удалённый auto не повторяется. Контекстные file/task события не воспроизводятся из журнала: старый контекст намеренно не сохранён. Сбой digest возвращает безопасный результат, не rejected UI callback.
- `costLimit` (на запуск, USD) и `monthlyLimit` (для автоматизации, USD) — положительные конечные числа в raw config, поэтому изменение требует нового approval. Поля доступны в UI. Нормализованным аргументом вызова нельзя ослабить одобренный raw limit.
- Перед **каждым** новым model request резервируется консервативная оценка: UTF-8 input bytes + allowance изображений + 16000 output tokens. Существующий месячный settings.budget тоже учитывается. Unknown/invalid tariff блокирует новый автоматический запрос, только если есть настроенный лимит; без лимита запуск разрешён и история честно показывает неизвестную стоимость. Локальная модель оценивается в 0. Parent добавил tokenLimit в llm body; engine передаёт maxTokens:16000.
- Все новые/отложенные automatic dispatch привязаны к выбранному проекту и epoch. При смене проекта активный auto/loop model и pipeline отменяются. A→B→A не воскрешает pending digest/open/pipeline-trigger/loop preparation. Pipeline scheduler больше не перебирает скрытые проекты для исполнения. Startup помечает старые running pipeline records прерванными, не продолжает их.
- `fireAuto` остаётся supervised: ошибка выполнения или reporting не создаёт unhandled rejection. Новое reporting защищено. У loop preparation отдельный session token: обновление loopNote внутри /match/autopilot не ломает корректный запуск, но stop/restart блокирует старый callback.

## Контракт parent / desktop

Импорт: `src/agent/AutomationControls.tsx` → `AutomationControls`.

Из `src/agent/automationControl.ts`: `useAutomationControl` (paused, notifications, storageError), `pauseAutomations`, `resumeAutomations`, `stopEverything`, `setAutomationNotifications`.

Opt-in по умолчанию выключен. После устойчивого завершения при opt-in отправляется window CustomEvent `tetrafree:automation-notification`, detail **только** `{ title, outcome }`. Возможные title: «Автоматизация завершена», «Автоматизация остановлена», «Автоматизация не выполнена». Ни имени, ни запроса, ни ошибок/путей. Parent App слушает событие и решает unfocused/native delivery через desktop helper. Прямого импорта desktop в control нет. Automation engine не вызывает старые osNotify с summary/ошибками, чтобы не обходить opt-in и не дублировать нативную доставку. Явно одобренное действие do.notify остаётся in-app toast согласно назначению самой автоматизации.

Пауза запрещает новые автоматические dispatch. «Остановить всё» дополнительно отменяет текущее и очищает очереди; расписания не снимают паузу сами. Обычный новый ручной чат и новый явный ручной pipeline не запрещены навсегда. Для /loop требуется явное возобновление автоматизаций.

## Проверки — выполнены

**134/134 PASS**, Node **22.23.3**, portable unit/component regression only:

```
/data/fix-tetrafree/node22/node-v22.23.3-linux-x64/bin/node --import tsx --test \
  src/agent/automations.test.ts src/agent/engine.lifecycle.test.ts \
  src/agent/automationJournal.test.ts src/agent/automationSchedulers.test.ts \
  src/agent/protocol.test.ts src/agent/danger.test.ts src/agent/queue.test.ts \
  src/agent/triggers.test.ts src/lib/backend.exec.test.ts
```

Источник результата: `automations-all-scoped.log`. Новые test suites: `automationJournal.test.ts`, `automationSchedulers.test.ts`; расширены `engine.lifecycle.test.ts`, `automations.test.ts`. Parent уведомлён о регистрации новых suites в npm test (package в этом scope не редактируется).

- Scoped TS diagnostics **0**: `/data/next-tetrafree/automations-typecheck.cjs`, noEmit/no incremental, diagnostics только назначенных source/tests/helper/UI.
- Scoped ESLint **0** по 15 изменённым TS/TSX файлам: `automations-eslint.log`.
- Test manifest: `/data/next-tetrafree/automations-test-files.txt`, копия `/data/next-tetrafree/testlist`.
- Unit: парсинг, whitelist, bounded history/live cap, restore interrupted, month totals, invalid/unknown tariff, reservations, persistent pause, listener/quota failures, opt-in generic event.
- Component: реальный engine/Turn/autorun/loop/CI/control/journal, mock store/provider/tools/sync/exec. Проверены abort signal, late callbacks, stale project lifecycle, queued timer clearing, safe manual retry, актуальные исходы, output cap argument, повторный резерв до tool continuation. CI команды — benign fixtures, реальный shell не запускается.

## Честные ограничения / не проверено

- **Не actual Windows pass:** не запускались Windows WebView2/Tauri/sidecar/process tree, реальные провайдеры и billing, нативные уведомления или browser UI. Окончательная App/TitleBar/native wiring принадлежит parent/desktop owner.
- Расходы — оценка, не provider billing и не гарантия строгого банковского ceiling. Тариф справочный/custom, токены приблизительные, изображение и provider reasoning/proxy могут тарифицироваться иначе; провайдер может игнорировать output cap. Unknown tariff прямо показан как неизвестная стоимость.
- Резервы намеренно **не возвращаются** после завершения/отмены: это консервативный месячный admission ledger. Глобальная проверка использует existing estimated month spend **плюс** automation reservations (пессимистично, возможно повторное учётное покрытие автоматизаций). Из-за этого новый запуск может блокироваться раньше фактического лимита. Это не точный счёт и не лимит со стороны провайдера; межпроцессного атомарного billing-lock у localStorage нет.
- Ошибка localStorage блокирует новые автоматизации в текущем процессе и видна UI. Если среда вообще не позволяет записать pause/history, нельзя гарантировать сохранение нового состояния на диск; старые записи не стираются. Неизвестная версия журнала сохраняется как есть и блокирует его запись.
- История ограничена 100 запусками глобально (UI показывает последние 30 выбранного проекта). Старые detached event contexts не сохраняются и не replay-ятся. Переименование/смена approval требует нового ручного решения.
- Фоновое исполнение только пока приложение живо и выбран соответствующий проект; нет фонового сервиса и stealth cross-project execution.
- `danger.ts` не менялся; это эвристика, не sandbox.
