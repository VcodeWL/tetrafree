# Agent repairs — 3.1.4

## Результат и scope

Прочитаны AGENTS.md целиком и docs/audit/3.1.4/agent.md. Внесены рабочие исправления в:

- src/agent/engine.ts, turn.ts, autorun.ts, protocol.ts, danger.ts, queue.ts;
- scoped helper src/agent/fileguard.ts;
- src/lib/backend.ts: только bExec и согласованный optional fifth arg bBatch(expectedHashes);
- scoped тесты и src/agent/test-helpers/harness.ts.

Не менялись мной domain/store/types, package/lock, server, Rust, preview. Shared backend не заменялся целиком; чужие preview-правки сохранены. Нет push/коммитов (в /data/tetrafree нет .git), общего check, build, formatter/prettier или browser.

## Исправления по аудиту

| ID | Реализация |
| --- | --- |
| A01 | Сохранён heuristic dangerOf; известные опасные формы блокируются, поверх этого только ограниченная грамматика простых проверок проходит без подтверждения. Обёртки, неизвестные executable, неразобранный shell синтаксис требуют ручного решения. npx больше не считается автоматически безопасным. Это не sandbox и не гарантия отсутствия эффектов: npm scripts и конфигурация проекта остаются исполняемым кодом. |
| A02 | Turn/controller identity. Старый finally не удаляет controller нового хода, не снимает его running и не чистит его live-буферы/очередь. Lane cleanup по уникальному laneId. |
| A03 | Turn.guard перед шагом, provider/tool dispatch, каждым action и после await; callback модели/вывода игнорирует поздние данные. Stop первого инструмента предотвращает последующие shell/MCP/web/read. Retry output и завершение тоже проверяют signal. Уже принятые удалённым инструментом действия нельзя отозвать клиентским guard; см. ограничения ниже. |
| A04 | bExec preabort до POST; listener+повторная проверка перед fetch; отдельный transport AbortController; kill на отмене/ошибке; reader cancel; timeout; освобождение listener/timer/reader. Полное устранение kill-before-spawn зависит от серверного tombstone/ack контракта — передано главному, см. agent-contract.md. |
| A05 | Явный opts.prompt отдельно от silent display label; current user wire message получает утверждённый prompt. Loop extra API сохранён. |
| A06 | Automation chat выбирается по automation ID -> chat ID, не title; одноимённый человеческий чат не переиспользуется. pid/Builder/tier/prompt явно передаются запуску; изменённый вручную tier чата не ослабляет утверждённую политику. |
| A07 | Спецификация копируется и сверяется с raw; после digest перепроверяются выбранный pid, поколение выбора проекта, существование/содержимое/включённость автоматизации и approval. createChat/saveTask получают явный pid. Concurrent fires сериализованы per automation. |
| A08 | Exact content CAS непосредственно перед live write. При изменении/удалении человеком файл остаётся нетронутым, полный agent result — proposed. Per-operation baseline не путает последовательные правки одного пути. |
| A09 | Exact before/after evidence (agentGuard) хранится с карточкой для edit/create/delete и обоих концов rename. Stale/legacy acceptance требует нового подтверждения; повторная правка во время confirm вызывает повторное подтверждение. Сначала recovery displaced state, затем commit. Confirm привязан к pid. Folder delete применяет только согласованный member set: новые члены папки не стираются и recovery не попадает под собственное удаление. |
| A10 | Revert сверяет полное ожидаемое after, включая delete/rename, восстанавливает точное before обоих концов. Конфликт -> новое подтверждение + recovery текущего состояния; повторная гонка -> повторное подтверждение. Старые карточки без evidence требуют подтверждения. Если у legacy edit утрачен original, файл не удаляется и пустая версия не создаётся. |
| A11 | syncSegs early guard и guard каждой операции, Turn file-effect guards. Поздний pump не меняет файлы. Политика Stop: уже полностью применённые правки сохраняются и записываются в историю; незавершённые/поздние операции не применяются. Version trigger/preview/toast от завершения отменённого Turn подавлены. |
| A12 | Убрана генерация shell-команд с .js/.py filename. autoVerify сохраняет только фиксированные npm run typecheck/lint/test --silent. Это сознательное сокращение функциональности до structured argv endpoint; standalone filename checks сейчас НЕ выполняются. |
| A13 | Queue item остаётся в store до фактического sendMessage acceptance; project/model checks не теряют текст. При закрытом проекте очередь сохраняется. |
| A14 | Queue timer принадлежит lifecycle; Stop очищает timer и очередь. Callback rechecks identity/project/controller и queue generation; clear+enqueue не переиспользует старый callback. Новый ход отменяет старый pending timer. |
| A15 | Lexer fenced markdown: обычные backtick/tilde fences и незакрытые fences являются literal, теги внутри не становятся actions. Длинные outer fences сохраняют вложенные короткие literal. Intentional triple-backtick file-path fallback сохранён, как и write-tag с fenced body. |
| A16 | Только валидный terminal t=x с integer code даёт process result. Output-only EOF, malformed/truncated/unknown/out-of-order frames не возвращают успех. Decoder flush и trailing non-newline terminal frame обработаны. |

bBatch backward-compatible: optional expectedHashes сериализуется в существующий POST body. Проверено mock-fetch unit; реальный серверный CONFLICT contract не проверялся этим агентом.

## Recovery и совместимость

- Полные before/after карты — additive optional agentGuard в карточке; domain type/schema не менялись. Existing spread/JSON persistence сохраняет поле. Old cards безопасно требуют подтверждения вместо угадывания baseline.
- Recovery JSON: `.tetra/recovery/<unique>.json`, содержит текущие файлы и null/missing сведения. Запись и exact readback происходят до destructive mutation. Ошибка создания recovery останавливает изменение. Это recovery в проекте, не отдельный disk backup и не новая гарантия durability. Общая persistence/sync ответственность у других агентов.
- Современные folder delete cards развёрнуты по исходным файлам; новые файлы в папке остаются. Legacy folder cards сверяют весь текущий состав перед подтверждением.
- Automation identity map живёт в памяти: после перезагрузки может создаться новый отдельный чат, но не наследуется опасный tier/title-чужого чата. Approval/task/prompt policy не зависит от названия чата.

## Проверено — unit/component, НЕ actual E2E

Финальный scoped запуск: **56 tests, 56 pass, 0 fail**.

```
node_modules/.bin/tsx --test src/agent/danger.test.ts src/agent/queue.test.ts src/agent/protocol.test.ts src/agent/engine.lifecycle.test.ts src/lib/backend.exec.test.ts
```

Лог: /data/fix-tetrafree/agent-tests.log. Список файлов для package.test: /data/fix-tetrafree/agent-test-files.txt.

- Pure parser/danger/queue tests; benign fixtures, никакие команды не исполняются.
- Component harness исполняет реальные engine/Turn/autorun/queue/backend с контролируемыми store/provider/tool mocks и mock fetch/ReadableStream. Покрыты конкурирующие ходы, Stop между эффектами, closed op на отменённом Turn, CAS и stale confirm/revert, recovery-failure, folder members, JSON evidence/large original, queue project/timer/model failures, approved prompt/tier/pid и concurrent fires.
- bExec напрямую исполняется с fake HTTP/streams: preabort, launch-time cancellation, pending-reader cancellation, missing exit, invalid frames, timeout (mock clock), trailing terminal и split UTF-8. Это не проверка запуска subprocess.
- Scoped TypeScript API noEmit diagnostics для назначенных production/test/helper файлов: **0**. Лог /data/fix-tetrafree/agent-typecheck.log. Это не project-wide typecheck/build.
- Scoped ESLint (только назначенные файлы и новые тесты): **0 ошибок**, /data/fix-tetrafree/agent-eslint.log. Formatter не запускался.

## Actual / внешние зависимости — не выдавать за закрытые проверки

**Windows 10/11, Rust/Tauri, cmd.exe, реальный провайдер/MCP, disk sync и реальные процессы здесь не запускались.** Продукт Windows-only; Linux shell-эффекты не переносились в выводы о Windows.

1. Kill-before-spawn: клиент передаёт transport signal и kill runId; для гарантированного отсутствия позднего spawn сервер должен хранить bounded cancelled-runId tombstones и проверять отмену перед spawn (или эквивалентный ack lifecycle). Это передано главному в сообщении и agent-contract.md. Один только клиент не является доказательством устранения этой server race.
2. MCP/web существующие API не поддерживают AbortSignal. Engine не запускает следующие действия после Stop и не применяет поздний результат, но не обещает отозвать уже отправленный HTTP/MCP эффект. Внутренние многошаговые tool-bootstrap операции тоже требуют общей transport поддержки для полной отмены.
3. CAS относится к synchronous project-store commit; external process/disk CAS — отдельная работа sync/server.
4. Queue на неоткрытом проекте сохраняется; автоматическое возобновление только от возврата в проект не добавлено. Следующий принятый ход может продолжить очередь.
5. Filename JS/Python autoVerify отсутствует до безопасного structured argv endpoint. Это нельзя описывать как полностью сохранённую функциональность.
6. Danger остаётся эвристикой и политикой подтверждения, а не regex sandbox / OS isolation.
