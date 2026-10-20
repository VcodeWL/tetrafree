# Recovery / lazy first-open — независимый read-only review

Снимок: 2026-10-20, около **17:59 UTC**, `/data/tetrafree`. Заявленный baseline 3.1.5 / 74da4a9; commit независимо не проверялся (`.git` отсутствует). AGENTS.md прочитан целиком. Review ограничен recoveryCenter/helper/modal и связанными lazy-first-open flows; Windows/vault/automation implementations не аудировались.

## Итог

**Два ограниченных lazy-flow findings: 1 Medium, 1 Low.** В проверенных recovery-copy сценариях потери/overwrite live-файла, stale-pid записи в чужой проект, path traversal или выполнения JSON **не обнаружено**. Это ограниченный результат, не общая security-гарантия.

### R01 — Medium: холодный lazy consumer может потерять initial compose/goto intent

**Пути:**

- `src/screens/Workspace.tsx:6,9,33–35,91,95` — ChatView/RightPane теперь lazy.
- `src/workspace/RightPane.tsx:1377–1388` — askAgent выбирает/создаёт чат, переключает center, но передаёт текст только `tf:compose` через 30 ms.
- `src/workspace/Composer.tsx:140–153` — текст попадает в draft только из listener после mount.
- Аналогичный контракт перехода к строке: `src/lib/search.ts:46–48` (openFile + событие через 60 ms), `src/workspace/CodeEditor.tsx:129–145` (listener появляется после mount).

**Witness — TESTED с controlled async lifecycle, не browser:** настоящий извлечённый `askAgent` вызывается из пустого center; chat создан и center переключён. Его timer срабатывает, пока ChatView/Composer ещё не mounted (chunk resolving >30 ms). Consumer подключается позже: событие уже ушло, draft пуст. В fixture проверены вызов реального handler, единственная отправка события и отсутствие полученного текста. Воспроизведение не требует внешней сети: достаточно задержанного разрешения lazy import.

**Влияние:** теряется первоначальный текст «Попросить агента»/prefill; сообщение не отправляется автоматически этим путём. Для search→goto аналогичная потеря номера/подсветки подтверждена **CODE ONLY**, не отдельным browser witness. Live-файлы не повреждаются; потеря уже сохранённого draft этим finding не заявляется. Timer/event подход существовал раньше, lazy-loading добавляет нормальный cold-load случай, где фиксированные 30/60 ms особенно ненадёжны.

**Направление:** сначала сохранить pid/chatId-bound draft или queued navigation intent в store; consumer должен забирать pending intent при mount. Не заменять 30 ms большим magic timeout. Для goto учитывать pid/file/line и актуальность проекта при consumption. Добавить desired negative test: import resolves после timer → intent всё равно доставляется ровно один раз.

### R02 — Low: inner null Suspense скрывает loading/cancel для холодной RecoveryModal

**Пути:** `src/modals/ModalRoot.tsx:8,21–23,82–83`; outer fallback — `src/App.tsx:30,342–344`.

App предоставляет DialogLoading с кнопкой «Отмена», пока загружается **сам ModalRoot**. После его загрузки cold `RecoveryModal` suspend перехватывается более близким `<Suspense fallback={null}>` внутри ModalRoot, поэтому outer DialogLoading уже не показывается. В промежутке нет видимого окна, progress или предусмотренной cancel-кнопки; интерфейс под ним снова доступен.

**Подтверждение:** CODE + исполнение настоящего ModalRoot в controlled component-output fixture: recovery route обёрнут inner Suspense с `fallback === null`. Реальный browser suspend/render не запускался. Стандартная nearest-boundary семантика React даёт описанное поведение.

**Влияние:** first-open UX/доступность; это не доказательство потери данных или обхода busy recovery-транзакции. При быстром warm import эффект может быть незаметен.

**Направление:** единый modal loading fallback на внутреннем уровне либо убрать дублирующий inner Suspense, чтобы работал outer loading/cancel. Проверить отдельно slow ModalRoot import и slow RecoveryModal import.

## Что проверено положительно

Новые внешние fixtures исполняют настоящий helper/modal, контролируя store/hooks/persistence; основная state-модель — Zustand + Immer:

- Restore создаёт отдельный case/collision-checked путь, сохраняет live, исходную trash/recovery и существующий `recovered/...`.
- Подмена variant/изменение или удаление source после render блокирует запись. Captured restore A при active A→B остаётся в A; B не меняется.
- При checkpoint reject копия остаётся в памяти, source сохранён; modal показывает «сохранение не подтверждено», не false success.
- Unknown data-only JSON shapes, metadata и null deletions не становятся replay operations; опасные пути отфильтрованы существующим validator. Service config копируется в `recovered/...`, не в активный `.tetra/...`. В parser нет eval/command replay; UI использует React text/pre, не HTML insertion.
- Первый `openPalette('/')` до mount consumer сохраняет prefix в bridge. Legacy event bridge сохраняет запрос и корректно снимает listener. Общей потери первого **palette** request не подтверждено; R01 относится к downstream compose/goto.
- Настоящий `ErrorBoundary.restart()` ждёт checkpoint; reject не вызывает reload. В fixture отключён только DEV logging (`import.meta.env.DEV`), persistence и reload контролируемые.
- `taskConstants.ts` содержит только значения/type import, не импортирует тяжёлый task board.

## Тесты / артефакты

```sh
cd /data/tetrafree
node --test /data/next-tetrafree/recovery-review/review.test.cjs
TSX_DISABLE_CACHE=1 node_modules/.bin/tsx --test src/lib/recoveryCenter.test.ts src/lib/palette.test.ts
```

- Новые внешние проверки: **9/9 PASS**. R01/R02 — characterization witnesses текущих ограничений, их зелёный статус **не означает исправление**. Остальные — safety/negative assertions.
- Существующие parent suites независимо перезапущены: **12/12 PASS** (9 recovery + 3 palette), без skip.
- `/data/next-tetrafree/recovery-review/review-tests.log`
- `/data/next-tetrafree/recovery-review/existing-tests.log`
- `/data/next-tetrafree/recovery-review/review-tested-sources.sha256` — все фактически исполнявшиеся production sources после прогона повторно сверены: OK.

## Ограничения

Ни production, ни package, ни чужие ownership-файлы не изменялись. Все новые fixtures/логи — вне проекта. Не запускались servers/listeners/browser, global check/build/lint/formatter или commit/push. App desktop integration ещё меняется родителем; результат относится к текущему lazy/recovery снимку, не будущему desktop integration.

Нет browser/Windows/React DOM приёмки, настоящего disk/checkpoint failure, quota/restart durability или полного producer-version integration всех внешних journal форматов. Main-thread performance на больших реальных проектах не измерялся; лимиты parser/list/preview прочитаны, но не выдаются за benchmark. Подтверждение CAS касается recovery publication в store, не native filesystem CAS.
