# Финальная bounded integration review

**Подтверждённых новых findings по data-loss / bypass / false-success в проверенных стыках не найдено.** Это узкая read-only приёмка интеграции, не повторный аудит vault/native/automation. Production и repo tests не менялись.

## Проверено

- **Boot order** — `src/main.tsx:99–123`: await hydration → await detectBackend → await prepareVaultRecovery, затем sync/docsync/account/cloud/scheduler/backup/vault и mount App. Внешний actual-source fixture с тремя deferred promises подтверждает отсутствие этих стартов до всех трёх разрешений. Отдельные отказы hydration/detect/prepare оставляют Recovery и не запускают эти writers/App; 10s timeout тоже не открывает пустой writable App.
- **Recovery вход** — `src/main.tsx:73–88,103–108`: при провале vault preflight recoveryMode включается до показа recovery-экрана; кнопка открывает только Auth под существующим Recovery, не App. После входа требуется reload. `src/lib/account.ts:142–155`: applySession подтверждает identity, но в recoveryMode не вызывает resyncNow. Последнее дополнительно подтверждено существующим actual-source accountIdentity regression.
- **App wiring** — `src/App.tsx:67–85,386–411`: snapshot/subscription vault state подключены; Auth остаётся доступен при blocked, Launcher/Workspace заменяются recovery route. Внешний fixture проверяет все пять комбинаций маршрута. Desktop mount effect возвращает cleanup lifecycle helper; notification effect принимает только пять известных outcomes, игнорирует unknown и передаёт в osNotify фиксированные общие строки, а не supplied title/prompt. Отдельные fixtures проверяют вызов/cleanup и benign private-text omission.
- **LLM preflight** — `src/agent/llm.ts:43–46,177–179`: blocked check предшествует построению запроса и backendFetch в streamChat/listModels. Существующий scoped safety test подтверждает reject обоих API и ноль fetch calls; positive-control запрос работает.
- **Provider preimage / throw-catch** — `src/modals/Forms.tsx:38–44,71–92`, `src/lib/providerDraft.ts:3–6`: initial clone хранится в ref, сравнение идёт с текущим provider перед save. Внешний fixture изменяет ключ после первого render, повторяет render и подтверждает отказ без save/успешного toast/navigation. Отдельный fixture с бросающим saveProvider подтверждает сообщение об ошибке и отсутствие false-success; неизменённый provider сохраняется в positive control. `src/store/slices/settings.ts:8–23,46–52` проверен по коду: key-intent failure перебрасывается до provider mutation. Существующий helper test также покрывает deletion/replacement/ID collision.

## Результаты

- Внешние desired actual-source fixtures: **10/10 PASS**.
- Scoped существующие suites `accountIdentity.test.ts`, `llm.safety.test.ts`, `providerDraft.test.ts`: **9/9 PASS**.
- Итого этой приёмки: **19/19 PASS**. Заявленные parent 764 global tests / browser 8+8 здесь не перезапускались и не выдаются за собственный результат.
- Артефакты: `/data/next-tetrafree/integration-review/review.test.cjs`, `fixtures.log`, `scoped-existing.log`, `tested-sources.sha256`, `reviewed-sources.sha256`.

## Границы вывода

Compiler/hook/event fixtures используют текущие production bodies, контролируемые dependencies и benign значения; это не browser E2E и не native Windows acceptance. Boot fixture проверяет порядок явных startup calls, а не все транзитивные import side effects; реализации vault outbox/desktop checkpoint/automation заново не аудитились. App gate проверен как **primary route gate**, не как глобальная остановка уже работающего фона/всех overlays при последующей смене identity; начальный запуск writers защищён main preflight. LLM guard — до начала запроса, не отзыв уже отправленного запроса. Provider success fixture не доказывает физическую durability диска, а проверяет catch/error вместо успеха при синхронном отказе saveProvider.

Browser/server/listeners/global check/build не запускались. Изменения этой приёмки — только внешние fixtures, logs и этот отчёт. Финальный общий gate остаётся за parent.
