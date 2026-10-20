# 3.2.0 «Работать спокойно»: приёмка и границы

Новые функции: recovery-copy центр, долговечный журнал удаления ключей, управляемые автоматизации, lazy UI и native close/update checkpoint. Это реализация и ограниченная приёмка, не утверждение «в коде больше нет багов».

## Проверяемые контракты

- Удаление ключа: metadata-only намерение до mutation; fresh-process failed DELETE → reload; токен не durable identity. Подтверждённый аккаунт привязан к backend/token/epoch. При startup recovery writable UI и фон не стартуют до безопасного reconciliation; модельный шлюз повторно проверяет gate. Старый черновик провайдера не восстанавливает ключ. Отдельный RED→GREEN regression закрывает token-only rotation до account emit: модельный guard проверяет актуальный scope без мутации React snapshot.
- Recovery: источник и preimage перепроверяются в атомарной store mutation; запись только в новый `recovered/...`. Переключение активного проекта не меняет origin. Ошибка checkpoint не выдаётся за durable success. JSON/метаданные/удаления не выполняются.
- Автоматизации: стоп отменяет dispatch/engine/loops/pipelines/очередь и оставляет persistent pause; история whitelist bounded100, restart interrupted. Лимиты — консервативные оценочные резервы, не гарантия billing провайдера. Изменение конфигурации требует нового approval.
- Lazy navigation: первый palette request сохраняется; compose пишет pid/chat-bound draft; goto — bounded one-shot intent с mount ACK, не magic timeout. Холодный modal показывает загрузку и отмену.
- Desktop: frontend готовит durable checkpoint; native ждёт token/ACK перед close/quit/final updater install. Native bridge/notification policy проверены переносимыми fixtures, не реальным Windows runtime.

## Отчёты владельцев и отдельное review

- [Автоматизации](automations.md): scoped134/134, Node22.
- [Vault](vault.md): scoped61/61, включая новые fresh-process сценарии.
- [Desktop](desktop.md): scoped17 TS +10 portable Rust unit checks; native Windows не пройден.
- [Read-only recovery review](recovery-review.md): нашёл два lazy-flow дефекта, отдельно от fixes.
- [Независимая интеграционная приёмка](integration-review.md): 19/19 bounded fixtures; 10 actual-source проверок перенесены в `scripts/integration-ui.test.cjs` и включены в npm test.
- [Исправление navigation/loading](navigation-fixes.md): desired regressions и совместимость legacy UI harness.

Числа scoped suites пересекаются: их нельзя складывать в независимые уникальные тесты. Общие gate-команды: `npm run check`, `npm run build`, `npm audit`; результат финального прогона записан ниже после консолидации.

## Обязательная оставшаяся приёмка

[Windows VM checklist](../../DESKTOP_ACCEPTANCE.md): настоящий Tauri/WebView2, native close/Alt+F4/tray/quit, ошибка хранилища/timeout, обновление N→N+1 и плохая подпись, autostart и реальная доставка уведомлений, процессные деревья. Подписанные артефакты, native compile/runtime и реальные провайдеры/billing здесь не сертифицированы. Черновик релиза нельзя публиковать как Windows-tested только на основании portable тестов.

Checkpoint — снимок на момент ACK, не блокировка будущих writers. Force kill, power loss, ручная очистка профиля, cross-window atomicity и серверная tenancy — отдельные границы. Outbox/app checkpoint не одна транзакция; прерванная замена ключа может потребовать повторного ввода. Фон существует только пока жив процесс; системной службы нет. CRDT/роли команды не входят в 3.2.

## Финальный общий gate — 2026-10-20

После консолидации и последнего token-only guard fix, Node **22.23.3**:

| Проверка                      | Результат                                                                                               |
| ----------------------------- | ------------------------------------------------------------------------------------------------------- |
| `npm run check`               | **775/775 PASS**: 157 Node server/script +618 client; 0 fail/cancel/skip, типы/lint/format PASS         |
| `npm run build`               | **PASS**; UI выделен в lazy чанки, без неподтверждённых обещаний ускорения в разах                      |
| `npm audit`                   | **0** известных уязвимостей на момент проверки                                                          |
| Новые browser-сценарии        | **8/8 PASS**: recovery-copy, origin pinning, provider draft, pause/stop/reload, header1100              |
| Холодная загрузка UI          | **2/2 PASS**: управляемая задержка lazy import, видимая отмена/Escape, late chunk не переоткрывает окно |
| Сохранённые browser-регрессии | **8/8 PASS**: редакторы, Worker, preview isolation, IDB reload                                          |
| Стресс UI                     | seed32020, 90 секунд, **164 действия /0 зарегистрированных ошибок**                                     |
| Rust portable unit tests      | **10 PASS**: checkpoint7, notification1, lifecycle2; НЕ Windows runtime                                 |
| Cargo metadata `--locked`     | **PASS**, версия3.2.0, Rust1.90; НЕ полная native-сборка                                                |

380 source/config файлов не изменились за финальный check/build. Browser18 сценариев выполнены последовательно, отдельно от общего gate; UI/dev тесты не сертифицируют packaged WebView2. Тестовый cold-load сценарий использовал удерживаемый request/явный release, а не увеличение произвольного delivery timeout. Скрипт интеграционных controlled fixtures теперь включён в npm test, без абсолютных sandbox путей и записей в исходники.

CI настроен проверять native default/extras/updater/full feature combinations на Windows; этот новый CI прогон ещё должен завершиться на отправленном commit. Build имеет информационные предупреждения о dynamic+static import store/persistence: они остаются shared-кодом, не отдельным lazy чанком.
