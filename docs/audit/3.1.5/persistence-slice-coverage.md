# A04 final all-slice coverage — restored handoff

Восстановлено после rollback по собственным точным patches. Source/test SHA заново вычислены и **точно совпали** с прежними финальными bytes. Документ реконструирован по истории, не выдаётся за byte-identical исчезнувший отчёт.

## Исторический пропуск и fix

Reviewer обнаружил chatsActions(set) при остальных publish-bindings. Generic setModel/.up/public tests не покрывали чат: createChat/pushMsg/renameChat не увеличивали runtime counter, whole-scope redo мог стереть новый чат. Это был настоящий пропуск owner coverage.

Fix: `chatsActions(publish)` в src/store/index.ts. Все factories:
uiActions(publish,get), projectsActions(publish), filesActions(publish), chatsActions(publish), docsActions(publish), tasksActions(publish,get), settingsActions(publish), memoryActions(publish). Public api.setState тоже publish; hydration core set намеренно не runtime mutation.

## Настоящие negative/coverage tests

1. Fresh real hydrated store runtime0 → настоящий createChat → runtime>0 уже в subscriber; затем настоящие renameChat/pushMsg каждый увеличивают counter и реально меняют title/messages. Настоящий flush, без generic .up замены или noop checkpoint.
2. Все 8 factory paths: setRightWidth, up(desc), writeFile, createChat, createDoc, saveTask, setModel, remember. Каждая проверка начинает после настоящей hydration с runtime0, проверяет фактическое изменение state и runtime>0 в каждой notification, затем реальный flush.

В предыдущей сессии до fix chat-only safety test дал 0/1, после fix fresh process 1/1; owner suite80/80. Это **исторические** результаты из committed conversation history, исчезнувшие логи не фабрикуются заново.

Новые результаты после восстановления записываются отдельно в `persistence-restoration.md`, `persistence-restored-tests.log` и `persistence-restored-chat-fresh.log`. Source manifest: `persistence-restored.sha256` (также восстановлен persistence-slice-coverage.sha256). Independent acceptance25 и regressions172 до rollback не приравниваются к новому PASS: reviewer переснимает fresh unified snapshot.

## Scope / стабильность

Только persistence.ts/index.ts/persistence-durable.test.ts восстановлены. Продакшен-правки остановлены после совпадения SHA; далее tests/reports без source edits. Global check/build/browser/global formatter/push не выполнялись. Account/backend/sync/team/package/version/types/lock и чужие fixtures не редактировались.

Owner tests доказывают wrapper coverage/counter ordering/actual changes/checkpoint, но не заменяют independent acceptance с fresh processes, registered checkpoint, двумя retries, durable human/chat/recovery и 0 outgoing. Windows/power-loss/multiwindow не проверены. Vault durable delete-intent outbox pending.
