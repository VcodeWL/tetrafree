# 3.3.0 — Каждому проекту своё

Новый аудит после 3.2.0 и следующий пакет улучшений. Исторические результаты 3.2.0 не засчитываются как текущий release gate.

## Что изменено

- Локальная диагностика с allowlist: предпросмотр, явный copy/download без upload. Нет имён, путей, ID проектов, ключей, provider URL, содержимого, UA и raw errors. Неизмеренные или неподтверждённые поля остаются неизвестными.
- Runtime-изоляция чатов/очередей/повторов/остановки/live-буфера и согласий на правки. Дубликаты проектов сохраняют исторические ID, но текущие действия несут pid.
- Namespaced drafts, сохранённый legacy и явное копирование неоднозначного старого черновика. Устаревшие поиск и действия сообщений не адресуют другой проект.
- Project/context-scoped наблюдения: память, checkpoint приложения, доступность сервера и сверка eligible текстовых файлов — разные состояния. Безопасный повтор не удаляет recovery/journal/baseline.
- Token revision и post-await guards против ABA, конкурирующих проверок входа и публикации ответов старого контекста.
- HTTP byte-budget/deadline/abort cleanup, response backpressure и повторная авторизация перед exec/preview. Небольшие policy/HTTP-модули вместо большого переписывания.

## Отчёты

- [Agent lifecycle и runtime isolation](agent-audit-refactor.md)
- [Черновики и действия сообщений](draft-isolation.md)
- [Сессии и vault](vault-audit.md)
- [Статусы и backend](sync-status.md)
- [Серверные HTTP boundaries](server-audit-refactor.md)
- [Диагностика](diagnostics.md)
- [Независимая интеграционная приёмка](integration-audit.md)
- [Независимая runtime-приёмка](runtime-acceptance.md)
- [Независимая HTTP-приёмка](server-acceptance.md)

## Финальный gate на Node 22.23.3

- `npm run check`: **911/911 PASS** — 184 server/scripts + 727 client; 0 fail/cancel/skip. Типы, ESLint и Prettier прошли в этой же цепочке.
- `npm run build`: PASS. `npm audit`, включая dev: 0 известных уязвимостей. Cargo metadata `--locked`: PASS, не native build.
- Browser: **18/18** — 8 новых, 8 прежних и 2 cold-lazy сценария; error arrays пусты. Проверены отдельные drafts/queue при одинаковых chat ID, явное legacy recovery, actual checkpoint/reload, privacy preview/copy/download и отсутствие зависшего Boot.
- Найденный браузером React duplicate sibling-key warning исправлен role-prefix ключами Thread/Composer; итоговый повтор чистый. До исправления функциональные 8/8 с warnings не засчитывались как чистая приёмка.
- Monkey seed33020: 60 с, 92 действия, 0 уникальных ошибок после штатного фильтра сетевых/resource ошибок этого harness. Не доказательство отсутствия всех ошибок.
- Независимые ограниченные проверки: runtime **24/24**, HTTP **58/58**, parent integration **17/17**. Это отдельные scopes с возможным пересечением с global tests, не дополнительные уникальные тесты к 911.
- Source/config SHA до и после финального gate совпали. Подробные машинные итоги — [final-gates.json](final-gates.json).

Author scoped PASS не равен приёмке всего приложения; Windows и внешние сервисы по-прежнему отдельный gate.

## Границы

Нативная Windows-приёмка установленной сборки, sidecar/ConPTY/Job, WebView2, tray/close/updater/notifications, реальные OAuth/SMTP/MCP/модели и подписанные артефакты остаются отдельными. Portable mocks и Linux browser не доказывают native Windows pass.

Checkpoint подтверждает захваченный снимок, не будущие изменения, forced kill или отключение питания. Сверка диска не охватывает ignored/binary файлы и не является OS-atomic CAS относительно внешних процессов. Оценочные бюджеты — не банковский billing ceiling. Очереди runtime хранятся в памяти; loops консервативно ограничены выбранным проектом. Диагностика — технический снимок, а не автоматический сертификат исправности.
