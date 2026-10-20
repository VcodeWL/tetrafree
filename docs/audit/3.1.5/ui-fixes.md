# UI / редакторы — исправления и scoped-перепроверка

Дата: 2026-10-13. Репозиторий `/data/tetrafree`. Изменены только выделенные UI-файлы и новые scoped helpers/tests. `AGENTS.md` прочитан целиком, исходный UI-аудит и D08 прочитаны. package.json/lock/types и чужие persistence/team/domain/engine/server/Rust файлы не менялись; push, общий check/build/formatter и браузер не запускались.

## Fixed IDs

- **UI-01**: `RightPane` задаёт ключ CodeSurface по `[pid,file]`, сбрасывает editing при смене pid; untouched flush не вызывает write. Save всегда привязан к исходному pid/path.
- **UI-02**: общий scoped saver (`editorSession.ts`, `useScopedFile.ts`) перед записью читает исходный проект/файл, а подписка на store помечает удалённое поколение навсегда. Delete→recreate с тем же содержимым не даёт старому редактору перезаписать новый файл. Rename/delete с pending текстом не воскрешают старый путь: набранное уходит в корзину **исходного** проекта с отдельным свободным recovery-именем; удалённая исходная копия не затирается. Есть toast и «Скачать правки». Recovery не применяет FILE_MAX и не выкидывает исходный удалённый текст. До записи pending-текст трёхсторонне сливается с внешними изменениями, даже если React ещё не отработал content effect; слишком большое/невозможное слияние сохраняет ours в recovery, не затирает theirs.
- **UI-03 + UI-04** (один root cause): `Studio` задаёт ключ Design CodeEditor по `[pid,page]`. Редактор получает явный pid и использует тот же scoped saver; старый onChange, захватывавший текущий проект, удалён из API. Отложенные flush/cleanup читают актуальные typed/base refs; timer снимается при flush; собственная уже сохранённая правка не пишется повторно. Внешние правки сливаются с pending вводом, а не просто выбрасывают его.
- **UI-05**: `checkPath` использует единую case-insensitive нормализацию exact/ancestor/descendant/self/subtree. Нельзя создавать путь под differently-cased файлом или занимать имя implicit folder; case-only rename файла/папки разрешён; перемещение внутрь себя блокируется независимо от регистра.
- **UI-06**: Esc вызывает flush и onFinish → `setEditing(false)` в RightPane, а не только blur.
- **UI-07**: Ctrl/Meta+S и Ctrl/Meta+/ проверяют `KeyboardEvent.code` (`KeyS`, `Slash`), не символ раскладки. Убрано безусловное «Сохранено», которое было бы ложным при recovery.
- **UI-08**: поиск, компиляция regexp, counting **и сама substitution** выполняются в новом module Worker на каждую операцию. `replaceJob` завершает и terminate-ит Worker по бюджету 1500 ms, смене запроса/проекта, закрытию модалки; нет синхронного fallback. Ошибки worker/запуска показаны по-русски. Stale results скрыты немедленно при изменении input identity. Apply проверяет исходные файлы после async работы до write.
- **D08**: TextBox инспектора не держит debounce вообще: setText/commitDoc выполняются синхронно при вводе, пока el относится к активному doc. Старый detached DOM не может быть изменён отложенным timeout после смены страницы. Version batching по-прежнему остаётся в actions.

## Tests / результаты

Новые test filenames перечислены в `/data/fix-tetrafree/ui-test-files.txt` (главному агенту добавить в package.test):

1. `src/lib/editorSession.test.ts` — исходные проекты/страницы, untouched cleanup, pending A/B, delete, delete→recreate, rename, pre-effect внешняя правка, конфликты и невозможное большое слияние.
2. `src/lib/editorLifecycle.ui.test.ts` — реальные тела Design CodeEditor, workspace CodeSurface, Inspector TextBox и useScopedFile, транспилированные в контролируемом hooks/callback fixture: cleanup до debounce, A→B без лишнего callback, latest typed refs, русский KeyS/Slash, Esc finish, synchronous Inspector, recovery оригинальной trash-копии + >FILE_MAX pending-текста. Проверены также parent pid/path keys. **Это не React DOM/браузерная lifecycle-проверка**; hooks, store и DOM dependencies контролируются фикстурой.
3. `src/lib/paths.ui.test.ts` — differently-cased ancestor/implicit folder + case-only rename.
4. `src/lib/replaceJob.test.ts` — реальные Node worker_threads исполняют тот же executeReplace handler: regex search/substitution, короткий pathological backtracking с heartbeat основного event loop, timeout, cancel, syntax error, blocked worker factory. Пути worker-тестов используют fileURLToPath; запуск на Windows не выполнялся.

Команда scoped regression:

```
node_modules/.bin/tsx --test src/lib/editorSession.test.ts src/lib/editorLifecycle.ui.test.ts src/lib/paths.ui.test.ts src/lib/paths.test.ts src/lib/replaceJob.test.ts src/lib/replace.test.ts
```

**38/38 PASS**, 0 skipped. Лог: `/data/fix-tetrafree/ui-tests.log`.

Scoped eslint по 16 собственным файлам: 0 ошибок/предупреждений (`ui-eslint.log`).
Scoped TypeScript compiler API по своим root-файлам, diagnostics отфильтрованы по собственным изменённым файлам: **0** (`ui-types.log`); это не общий project check.
Scoped prettier --check по тем же файлам: PASS (`ui-prettier.log`).

## Новые findings / дополнительные защиты

- **Подтверждено чтением кода:** исходная Replace undo безусловно писала snapshot и могла затереть более позднюю чужую правку либо воскресить удалённый файл. Теперь undo сверяет все replacement outputs с актуальным исходным проектом; при расхождении не пишет ничего и показывает предупреждение. Async apply также не заменяет stale/deleted вход. Это дополнительно к UI-08; отдельного браузерного reproduction не было.
- **Подтверждено scoped-тестом:** исходный editor external merge fallback `ours` мог затем сохранить его поверх `theirs`, когда merge3 вернул null из-за размера. Теперь обе версии сохраняются: theirs остаётся live, ours в recovery.

## Ограничения / остаточные риски / handoff

- **Не Windows-tested.** Не запускались Windows/WebView2, физическая русская раскладка, IME, screen reader, browser, общий check/build. Главному агенту повторить реальные UI01–08/D08 и module-worker bundling/CSP в своём browser audit; мои 38 тестов не заменяют это.
- 1500 ms — реальный execution budget, не гарантия, что любой большой корректный проект завершит поиск. Легитимный долгий поиск может честно завершиться тайм-аутом. Structured-clone большого files snapshot имеет main-thread overhead; опасный regex там не исполняется. `findHits`/`replaceIn` как pure library APIs остаются синхронными — UI их больше не вызывает напрямую.
- Recovery — обычная корзина проекта с её штатным сроком 30 дней, не бессрочный архив. Большой текст может упереться в уже существующие ограничения persistent storage; штатное предупреждение стора и download action остаются. Если удалён **весь исходный проект**, а не файл, корзины назначения нет: пользователь получает явный warning и download action с текстом; автоматического durable orphan-project архива здесь не добавлено.
- Synchronous Inspector serializes текущий DOM на каждый input. Это устраняет D08 надёжно, но на очень больших макетах возможна задержка ввода; будущая оптимизация обязана сохранять исходный pid/page/doc, а не вернуть detached-DOM debounce.
- В shared contracts увиден отдельный preview contract: заменить Studio.previewUrl на `getPreviewUrl(p,page)` и убрать app-origin external blob preview из RightPane. `/data/tetrafree/src/lib/preview.ts` на момент завершения отсутствует; эта отдельная просьба **не внесена**, чтобы не угадывать API и не блокировать UI01–08. Главный агент владеет helper; после его появления адаптировать эти два UI места. Попытка отправить сообщение в parent session вернула `The tool capability failed unexpectedly`.
