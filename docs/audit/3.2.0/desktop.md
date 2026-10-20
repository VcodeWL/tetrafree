# Desktop lifecycle — финальный handoff

**STOP: scope завершён.** Фактический UI файл: `src/components/DesktopSystem.tsx`, named export **DesktopSystemRows**, props не требуются. Точный integration contract: `/data/next-tetrafree/desktop-contract.md`. App/Settings/TitleBar/osnotify/версии/package/tauri config/capabilities не редактировались этим агентом.

## Реализовано

### Native checkpoint gate

- `checkpoint.rs`: std-only state machine, одно pending сохранение, READY, свежий random256-bit/64hex token (getrandom в bridge), matching single ACK, timeout8s, wrong/late/replayed ACK rejection. Разовый native exit permit истекает через2s, не даёт бессрочно обходить последующие проверки.
- `desktop_checkpoint.rs` + lib.rs: intercept **главного native CloseRequested и ExitRequested**, tray explicit Quit, desktop_quit IPC. Сначала prevent, shared lifecycle lease, запрос frontend durable checkpoint. По fail/timeout/not-ready/busy окно остаётся/становится видимым, backend не останавливается, генерируется generic warning и настоящий native warning dialog (один outstanding, включая случай неработающего JS).
- Tray close: checkpoint -> hide, backend/агенты продолжают работать; explicit Quit: checkpoint -> native exit -> существующий graceful backend/Job lifecycle. Перед hide повторно проверяется tray preference, чтобы отключение трея во время flush не спрятало приложение без значка.
- updater: checkpoint теперь **после download и перед backend stop/install**, а не только ранний JS-flush. Ошибка сохранения не запускает installer/не останавливает backend. Существующий install-error backend recovery сохранён. Windows updater plugin может завершить процесс сам: checkpoint/backend stop выполняются ДО install.
- Native state регистрируется до tray callbacks, чтобы ранний tray/close не обращался к отсутствующему ServerChild.

### Frontend bridge

- `startDesktopLifecycle()` из `src/lib/desktopLifecycle.ts`: sync cleanup-return для `useEffect(() => startDesktopLifecycle(), [])`, browser no-op. Сначала устанавливает listeners, затем ready=true. При cleanup снимает listeners/readiness. Родитель сообщил, что App уже подключён; файлы App не трогал.
- Flush ожидает реальный registered `flushPersistence()`. `flushStableCheckpoint` также проверяет runtime revision до/после I/O: concurrent store mutation не превращается в успешный ACK. Bounded flush/ACK, false на error/timeout/rejected native ACK, duplicate-token handling и capped seen64.
- `winClose` делегирует native close (Alt+F4/tray/OS не зависят от единственной JS titlebar кнопки). updInstall делегирует native final gate. Добавлены desktopQuit, desktopFeatures, sysSetNotifications, notifyDesktop.

### Opt-in system integration

- Existing tray/autostart preference сохранены. Tray icon действительно создаётся только при включённой preference; отключение показывает main window. --minimized без трея не прячет окно. Autostart не включается на обычном старте.
- Rust-only **tauri-plugin-notification** (optional extras). Native notification preference по умолчанию OFF, main-window-only IPC, background/unfocused gate, allowlisted event kinds, label <=64 chars без controls, generic titles/body, не более1/5s. Нет remote icon/action URL или arbitrary body. true означает plugin submission, НЕ подтверждение OS delivery. Desktop plugin permission=Granted не доказывает видимость: Windows/DoNotDisturb могут подавить toast.
- DesktopSystemRows notifications switch: сначала await sysSetNotifications(on), затем existing useStore.setSetting('osNotify',on); on-state = native flag AND global setting. Новых Settings properties/migrations нет. SysInfo расширен notifications/notificationSupported.
- Parent сообщил, что osnotify desktop branch, generic automation event routing, outcomes whitelist и независимый automation consent уже подключает сам. Эти чужие файлы агент не менял. Для automation alerts нужны согласия automation+native/global; никаких duplicate browser alerts в desktop branch по согласованному parent wiring.
- Добавлен **tauri-plugin-dialog** (all feature combinations) для настоящего warning при broken/unready frontend. JS plugin dependencies и широкие ACL permissions НЕ добавлены: custom native команды проверяют main WebviewWindow, существующие capabilities не расширялись.

### Windows acceptance

- `scripts/acceptance-desktop.ps1`: trusted expected SHA256 проверяется ДО optional launch; -Launch требует -DisposableVm. Отдельный opt-in RequireAuthenticode. Никаких автоматических installs/settings changes. Pending/skip/fail -> exit2. Все manual PASS отмечаются **OPERATOR_REPORTED_PASS**, не automated native certification. Скрипт НЕ запускался здесь: PowerShell/Windows нет.
- `docs/DESKTOP_ACCEPTANCE.md`: свежая Win10/11 VM без Node, native/titlebar/Alt+F4/tray close, storage failure/timeout/retry, opt-ins/autostart, foreground/background/duplicate notification checks, process trees, signed staging updater N->N+1 и signature-negative case. Подписи/SmartScreen/installer/installed bundle здесь не проверены.

## Фактически выполненные scoped проверки

- `node node_modules/tsx/dist/cli.mjs --test src/lib/desktopLifecycle.test.ts src/lib/desktopLifecycle.native.test.ts` -> **13/13 PASS**. 8 portable handler tests +5 explicitly SOURCE-only invariants. Лог: `desktop/ts-tests.log`. Это НЕ native event/GUI tests и НЕ React DOM/axe/browser run.
- Actual std-only `checkpoint.rs` через rustc --test -> **7 PASS**; notification_policy.rs -> **1 PASS**; existing lifecycle.rs -> **2 PASS**. Итого **10 Rust unit tests PASS**. Логи `desktop/rust-{checkpoint,notification,lifecycle}-tests.log`.
- Scoped TypeScript diagnostics по owned desktop files -> **0**, ESLint owned5files -> PASS. Логи `desktop/typecheck.log`, `desktop/eslint.log`. Глобальный typecheck/check/build не запускался.
- Owned Rust rustfmt выполнен. TS/TSX formatting оставлен parent consolidation (не global formatter).
- Cargo.lock **действительно regenerated** для getrandom0.3, dialog2, optional notification2; `cargo fetch --locked` и `cargo metadata --locked --features extras,updater` успешны. Metadata536 packages including root; нет declared rust_version>1.90 в этом графе. Это не compile/MSRV runtime proof. Сохранены Cargo.toml package version3.1.5/rust-version1.77; package/lock JS не менялись.
- Metadata/locked resolution не является полной Tauri compilation. Новые native modules не сертифицированы компилятором/Windows run: MSVC lib.exe/SDK и Windows runtime здесь отсутствуют; прежний cross-check упирался в lib.exe. Никаких заявлений native pass.

## Риски и ограничения (честные)

1. Native delivery/close/exit/notification/dialog/update semantics требуют настоящей Windows приёмки и cargo check/test в CI. Source-invariant tests не заменяют её.
2. Checkpoint — durable snapshot в момент matching ACK. Это НЕ бесконечная блокировка всех будущих writers. Runtime mutation ВО ВРЕМЯ flush отклоняет ACK; изменение ПОСЛЕ ACK/forced termination не получает автоматической гарантии durability. При непрерывном агентном потоке может потребоваться дождаться окончания и повторить close.
3. Force kill/краш/OS shutdown/power-off могут обойти veto; никаких fake OS-exit guarantees. Background mode работает только пока процесс жив.
4. Existing external-editor process ownership и per-operation descendant proof limitations из предыдущего аудита не решались этим scope. Global app Job — остаточный boundary, не OS sandbox.
5. Cargo generate-lockfile обновляет resolution графа, не только новые пакеты. Parent должен review regenerated lock, собрать с pinned toolchain/--locked и при будущем version bump обновить root entry в Cargo.lock.
6. В копии отсутствует .git: baseline commit74da4a9 независимо не проверен; push/commit не выполнялись.

## Handoff / файлы

- Parent: заменить старую local SystemRows в Settings на `<DesktopSystemRows />`, убрать неиспользуемые старые imports. App lifecycle hook parent уже подключил. Протестировать UI integration после собственной сборки.
- Parent npm test additions: `/data/next-tetrafree/desktop-test-files.txt` (оба новых TS suite). Rust modules включены в cargo test --lib автоматически (notification_policy только extras).
- Owned edits/new: src-tauri/src/{lib,extras,updates}.rs; new {checkpoint,desktop_checkpoint,notification_policy}.rs; Cargo.toml dependency/features only, Cargo.lock; src/lib/desktop.ts, desktopLifecycle.ts +2test files; src/components/DesktopSystem.tsx; scripts/acceptance-desktop.ps1, docs/DESKTOP_ACCEPTANCE.md. Existing lifecycle.rs семантически не менялся, только повторно проверен.
- Нет global check/build/browser/push/package/version/config/capability edits. Больше работающих задач или изменений от этого агента нет.

## Legacy suite compatibility addendum — STOP

По отдельному разрешению parent изменён ТОЛЬКО production-adjacent test `src/lib/desktop.checkpoint.test.ts`: прежние4 assertions требовали JS-only flush внутри winClose/updInstall и больше не соответствовали native gate.

Не удалены и не заменены пустыми: все4 сценария теперь исполняют actual desktop.ts frontend delegates (transpile+controlled imports), **actual createCheckpointHandler**, контролируемую native-emulation boundary. Эта boundary явно помечена как MOCK, не Windows proof. Проверяются:

- native close request delivery != termination: окно не закрывается до awaited durable flush + matching true ACK;
- flush reject -> false ACK, frontend/native warning requests, окно остаётся открытым;
- updater download завершается ДО final checkpoint; изменение во время download попадает в flush; server stop/installer dispatch идут только ПОСЛЕ true ACK;
- flush failure rejects updater без server stop/installer dispatch.

Изначальные13 новых regression tests не изменялись. Scoped запуск трёх suites -> **17/17 PASS** (`desktop/legacy-compatible-tests.log`), scoped ESLint -> PASS, TypeScript diagnostics ТОЛЬКО изменённого legacy suite ->0 (`legacy-compatible-{eslint,types}.log`). Production code, App/Settings/TitleBar и чужие файлы не менялись; global check/build/browser/push не запускались. Test list дополнен legacy path (в основном npm test он уже был). Нативные ограничения предыдущего отчёта остаются. **STOP**, больше правок нет.
