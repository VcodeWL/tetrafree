# Second agent repair — F01 / F04 / F06

## Scope и исходная сверка

До начала production edits SHA-256 `engine.ts`, `turn.ts`, `autorun.ts`, `protocol.ts`, `fileguard.ts` **полностью совпали** с post-first-fix snapshot независимого аудита `reaudit-agent/final-bytes-recheck/manifest.json`. Результат: `agent-second-before.json` — все пять `matchesAuditedPostFirstFix: true`. Таким образом исправлялись именно повторно проверенные bytes, а не устаревший pre-first-fix код.

Прочитаны повторный аудит целиком, benign witnesses в `reaudit-agent/agent.test.ts` и актуальный `contracts.md`. Bad-behavior assertions не копировались в виде «зелёного исправления».

Изменены только:
- `src/agent/engine.ts`, `turn.ts`, `protocol.ts`, `autorun.ts`;
- negative desired-safety tests в `src/agent/engine.lifecycle.test.ts`, `protocol.test.ts`.

Backend API/backend.ts, server, Rust, domain/store/types, sync/team, package/lock и чужие файлы не редактировались. F02/F03/F05 оставлены их автору.

## F01: computation source и CAS теперь связаны

`syncSegs(edit)` больше не читает stale `T.after` как источник применяемой правки. `Turn.beginEdit(id,path)` один раз фиксирует источник вычисления и его before-image:

1. Если предыдущая операция уже применена, источник — **текущий живой файл**, включая промежуточные ручные изменения. При отсутствии файла edit завершается error, не воссоздавая его.
2. Повторные streaming pumps одного operation ID используют один и тот же захваченный input. Изменение или удаление после этого снимка приводит к proposal, а не к смене вычислительного источника под прежней CAS-проверкой.
3. Цепочка ещё не принятых предложений может использовать виртуальный after предыдущего proposal, но наследует его исходный before-image и обязательность подтверждения. Такая цепочка не превращается в auto-commit даже при последующей менее строгой политике.

Desired tests проверяют ручной текст между двумя applied edits, ручное удаление до следующего edit, правку/удаление между streaming pumps, цепочку unaccepted proposals и proposal создания отсутствующего файла. Они запрещают silent overwrite/recreation, а не требуют плохого наблюдаемого результата.

## F04: Markdown container fences — literal диапазоны

Fence scanning распознаёт opening prefixes blockquote/list/indentation, включая вложенные и смешанные контейнеры. Closing fence проверяется с учётом quote depth и continuation indentation; лишняя вложенная quote-fence не завершает внешнюю раньше времени. Незакрытый диапазон остаётся literal до EOF, в том числе при streaming.

Префиксы анализируются только для определения диапазона. **Исходный текст не обрезается и не нормализуется**: container examples и тела write сохраняют свои bytes. Явный file-header fallback разрешён только в top-level fence, не в container example. После закрытого container fence последующий явный top-level read остаётся доступен.

Все новые F04 fixtures — **parse-only безопасные `<read path="guide.txt" />` примеры**, без shell payloads, write dispatch или внешних targets. Покрыты blockquote, nested quote, unordered/ordered list, 4-space/tab indent, mixed container, closed/unclosed fences, file-like header в контейнере и byte-preserving write body.

Это консервативный protocol lexer для документирующих fences, не полный Markdown renderer и не sandbox.

## F06: supervised fireAuto boundary

Единый `catch` внутри `fireAuto` обрабатывает digest/исполнитель runtime failures, возвращает `{ok:false,note}`, пишет failed status без увеличения successful recent-runs и не раскрывает исходное infrastructure exception text. `firing.delete` остаётся в finally, поэтому повтор после сбоя не заблокирован.

Отдельный guarded reporting block не превращает ошибку store/listener в повторный rejected background promise. Если до сбоя агент уже реально запущен, running определяется по фактическому chat lifecycle, а не безусловно сбрасывается.

Desired tests: rejected digest -> resolved/logged failure + retry; runtime exception saveTask -> failure без false-success; secondary reporting/listener exception -> resolved failure и возможность последующего запуска. Global unhandled rejection listeners и реальные внешние эффекты не создавались.

## Проверки

1. Сначала новые desired assertions запущены против совпадавшего исходного среза: **54 tests, 39 pass, 15 fail**. Лог `agent-second-red.log`. Эти ожидаемые red failures подтвердили, что тесты действительно ловят F01/F04/F06.
2. После исправления тот же набор: **54/54 pass**, `agent-second-green.log`.
3. Добавлены дополнительные boundary regressions; финальный объединённый scoped набор: **78 tests, 78 pass, 0 fail**, `agent-second-tests.log`.

```
node_modules/.bin/tsx --test src/agent/danger.test.ts src/agent/queue.test.ts src/agent/protocol.test.ts src/agent/engine.lifecycle.test.ts src/lib/backend.exec.test.ts
```

Список изменённых тестовых файлов: `/data/fix-tetrafree/agent-second-test-files.txt` (оба уже входят в initial agent-test-files.txt). Никаких изменений package.test этим агентом не делалось.

Scoped TypeScript diagnostics: **0** (API noEmit, diagnostic filter для назначенных файлов; не общий build/typecheck). Scoped ESLint шести изменённых production/test файлов: **0 ошибок**, `agent-second-eslint.log`. Финальные SHA — `agent-second-after.json`.

Это unit/component checks: реальные engine/Turn/autorun/parser с mocked store/provider/tool transports. Backend tests используют только fake fetch/ReadableStream. **Actual Windows/Tauri/provider/MCP/process/disk/cloud E2E не выполнялись.** Не запускались global check/build/format/prettier/browser, push и witness shell-команды. F02/F03/F05 этой работой не закрываются.
