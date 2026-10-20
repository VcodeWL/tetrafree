# Server acceptance — текущая post-rollback сверка R01–R10

**Заменяет позднюю acceptance, известную из transcript.** Среда, по сообщению parent, восстановлена к Oct15 13:56; поздние A04 root-owner изменения/логи могли исчезнуть. Текущий файл не переносит прежний global GREEN на восстановленный checkout.

## Актуальное evidence

- **Собственный CURRENT RUN:** `node --test /data/tetrafree/server/reaudit-contracts.test.mjs` → **2 PASS / 0 FAIL / 0 SKIP, exit0**, Node **24.14.1**. Лог: `/data/fix-tetrafree/reaudit-server/post-rollback-contracts.tap`.
- Тест перечитан перед запуском: fake taskkill/child/listener и собственные temp fixtures. Никаких реальных listeners/network/browser/process launches; production/test/package не менялись, форматирование этим worker не выполнялось.
- Текущие static anchors перепроверены: MCP expectedHash/stdio error+limits, auth securityEpoch/stepUp, canonical preview, общий process registry/terminal treeStopped и shared publicFailure. Это **CODE**, не runtime-проверка всех этих путей.
- **CURRENT STATIC CONFIG:** девять relevant suites зарегистрированы в npm test; отсутствующих runtime server bundle resources нет. Снимок: `reaudit-server/post-rollback-static.json`.
- Источники авторского evidence: сохранившиеся `server-second-fixes.md`, `process-second-fixes.md`, `windows-second-fixes.md`, `process-second-contract.md`. Их scoped PASS — **AUTHOR-REPORTED HISTORICAL**, не новые запуски после rollback.
- **Прежние Node22.23.3 global check654/654 и web build PASS известны только из transcript; НЕ CURRENT RUN.** Новый global check/build/CI/release этим worker не запускался. Исправление parent whitespace regex в process-second static assertion принято к сведению, но соответствующая suite здесь не запускалась.
- Технический timestamp sandbox текущего статического снимка: `2026-10-20T17:32:22.454Z`; он не используется как доказательство версии checkout/порядка восстановленных patches. Проверяемые bytes зафиксированы в `reaudit-server/post-rollback-source-sha256.txt`.

## Короткая матрица

| ID | Статус на доступном уровне evidence | Что НЕ утверждается |
|---|---|---|
| **R01** MCP approve/version | **CODE + report:** expectedHash обязателен, stale config отклоняется; owner slot/runningHash адресуют старое поколение | Независимого post-rollback MCP runtime pass нет; hash не фиксирует executable bytes/expanded env |
| **R02** exec cancellation | **CURRENT TESTED:** nonzero fake taskkill exit вызывает fallback ровно один раз при exit+close. **CODE/report:** awaitable stop, honest false/treeStopped, fabricated finish timer снят | Это не native taskkill/tree-reap/Windows pass. Fallback не доказывает остановку descendants |
| **R03** Git pointers | **Report + прежняя code-сверка:** conservative fail-closed config/metadata profile, изоляция native config, ограниченный Git workflow | Git suite после rollback не запускалась; OS containment, отсутствие TOCTOU, реальные SSH/HTTPS integrations не доказаны |
| **R04** auth continuations | **CURRENT CODE + report:** persisted securityEpoch, requireEpoch после async auth, invalidation tickets/codes | Auth race/epoch suites после rollback не запускались; реальные OAuth providers не проверены |
| **R05** MFA step-up | **CURRENT CODE + report:** uniform stepUp, OAuth-only email path без MFA, TOTP/recovery при enabled factor, guards/epoch | Реальная email delivery и browser/WebView2 UX не проверены |
| **R06** preview relative base | **CURRENT TESTED:** default HTML200, relative CSS200/type CSS, missing asset404, opaque sandbox сохранён | Только fake HEAD listener, не browser pass. Root-absolute assets остаются ограничением |
| **R07** MCP stdin/bounds | **CURRENT CODE + report:** stdin error handler, pending32/outbound256KiB, queued callback+drain handling | EPIPE/slow-drain/count suites после rollback не запускались; real stdio/npx/Windows quoting не проверены |
| **R08** process ownership | **CURRENT CODE + report:** shared registry, awaited stop/cleanup, root-close не объявлен tree success; Git/browser/MCP/PTY адаптеры описаны авторами | Current process/PTY suites здесь не запускались. Bounded ledger не доказывает descendant reap и не является OS quota |
| **R09** gates | **CURRENT STATIC CONFIG:** relevant suites и runtime resources зарегистрированы | Прежний654 не current GREEN; новый global/CI gate должен подтвердить parent после восстановления всех owners |
| **R10** errors | **CURRENT CODE + report:** shared publicFailure, generic public error/correlationId, categorical diagnostics | Sentinel-redaction suites после rollback не запускались; обычные tool/Git results — DATA, не универсальная secret filter |

## Непереносимые гарантии / ограничения

- Windows/native taskkill/ConPTY/Job/installer/updater/signature acceptance отсутствует. Partial FFI cross-check не равен full native build.
- Live failed-stop entries остаются owned; observed-root-close+false переходит в bounded residual counters/ring без повторного kill старого PID. Это **не** подтверждённая очистка descendants. Enclosing Rust Job — desktop app-close boundary; standalone Node эквивалентной гарантии не имеет. Пустой active registry не означает treeStopped=true.
- External editor ownership и durable frontend checkpoint/desktop-close gate остаются отдельными pending boundaries из Windows report; A04/root-owner recovery не входит в эту server-сверку.
- Git profile не OS sandbox; намеренно ограничивает includes/helpers/submodules/worktrees. Realpath и CAS не устраняют внешние filesystem races. Preview не возвращён в app origin; root-absolute URLs — отдельное ограничение.
- В process author report признан промежуточный случайный legacy web run с localhost/browser. Он не включён в наш safe evidence и не называется mocks-only. Текущий собственный запуск — только два прочитанных benign contracts.

**Итог для parent:** после rollback независимо подтверждены только два конкретных fixes R02/R06 и текущая регистрация relevant gates/resources. Для остальных — code/report-level acceptance с указанными ограничениями. **Общий push/release GREEN заново не выдан:** дождаться восстановления root owners и нового current global gate parent. Новых production edits в server scope этот worker не делал.
