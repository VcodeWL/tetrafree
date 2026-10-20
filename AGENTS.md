# TetraFree — инструкция для ИИ-агентов и разработчиков

> Этот файл читают Claude Code (через `CLAUDE.md`), OpenCode, Cursor, Codex и другие. Прочитай его целиком, прежде чем менять код. Если факт здесь расходится с кодом — прав код: поправь этот файл в том же коммите.

## Что это

Десктопное **Windows-приложение** «совместная разработка с ИИ-агентами»: чаты с агентами, правки файлов карточками, версии, git, терминал, пайплайны, команды с общим облаком проекта. Только Windows 10/11, только русский язык. Командный продукт, не демо.

**Жёсткие принципы**

1. Никаких заглушек, мок-данных, «симуляций», `TODO` вместо реализации. Чего нельзя сделать по-настоящему — нет в интерфейсе.
2. Честность: что не удалось проверить (нет Windows/Rust/ключа) — пиши прямо в описании и в changelog.
3. Данные пользователя нельзя терять: миграции, защита от перезаписи, подтверждения опасного.
4. Интерфейс на русском, доступность (axe) без нарушений, `prefers-reduced-motion` и `html.reduced` уважаются.

## Карта репозитория

| Путь                                                              | Что там                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`                                                            | React 18 + TypeScript strict + Vite 7. Точка входа `main.tsx`, `App.tsx`                                                                                                                                                                                                                                                      |
| `src/store/`                                                      | zustand + immer + persist. `types.ts` (Persisted/UI/Actions), `slices/*` (действия по доменам), `persistence.ts` (**IndexedDB + revisioned fallback, `PERSIST_VERSION`, `migrate`**), `snapshots.ts` (версии хранятся разницей)                                                                                               |
| `src/agent/`                                                      | движок агента: `engine.ts` (ход, применение/откат), `turn.ts`, `prompt.ts` (что видит модель), `protocol.ts` (теги `<write>/<edit>/<run>…`), `llm.ts` (провайдеры), `ci.ts` + `triggers.ts` (пайплайны и расписание), `danger.ts` (опасные команды для уровня «Спросить»)                                                     |
| `src/lib/`                                                        | чистая логика и клиенты без React/стора. Новый алгоритм = новый `*.test.ts`                                                                                                                                                                                                                                                   |
| `src/screens/`, `workspace/`, `modals/`, `components/`, `design/` | UI. Режим «Дизайн» — `design/`                                                                                                                                                                                                                                                                                                |
| `server/`                                                         | локальный Node-сервер, **без внешних зависимостей**: `tetra-server.mjs` (файлы, git, shell, прокси, бэкапы), `auth.mjs` (аккаунты, сессии, команды, SSE), `pty.mjs` + `conpty-win.mjs` (терминал), `secrets.mjs` (ключи, DPAPI), `mail.mjs`, `editors.mjs` (внешние редакторы), `gitparse.mjs`, `gitremote.mjs`, `ignore.mjs` |
| `src-tauri/`                                                      | оболочка Tauri 2 (Rust): sidecar `node`, трей/автозапуск/хоткей (фича `extras`), автообновление (фича `updater`). Rust в песочнице не компилируется — первая реальная сборка на CI                                                                                                                                            |
| `.github/workflows/`                                              | `ci.yml` (проверки), `release.yml` (подписанный установщик, `latest.json`, заметки из `CHANGELOG.md`)                                                                                                                                                                                                                         |
| `scripts/`                                                        | `fake-llm.mjs` — поддельная модель для проверки агента без ключа; `restore-binaries.mjs`                                                                                                                                                                                                                                      |
| `docs/TEST_PROMPT.md`                                             | промпт ИИ-тестировщика на Windows                                                                                                                                                                                                                                                                                             |

Слои: `UI → agent → store → lib → types/data`. Зависимости идут только вниз. Подробнее — `ARCHITECTURE.md`.

## Команды

```
npm ci                 # зависимости (+ картинки из binary-assets/)
npm run dev            # http://127.0.0.1:3000, сервер встроен в vite
npm run check          # tsc + eslint + prettier --check + ВСЕ тесты. Зелёным перед коммитом
npm run build
```

Перед `check`: `npx prettier --write src server scripts`.

## Как устроены данные

- Основной снимок — IndexedDB (`store/idb.ts`), ключ `tetrafree`; запасной localStorage ограничен квотой браузера и защищён revision/authority journal. Hydration завершается до UI и фоновых писателей. `flushPersistence()` сохраняет текущий снимок и rejects при неподтверждённом checkpoint. Версии проекта пишутся **разницей** с предыдущей (`store/snapshots.ts`), в памяти — полные снимки.
- Меняешь формат сохранённого — подними `PERSIST_VERSION`, добавь ветку в `migrate()` и тест в `persistence.test.ts`. Неизвестная/неподдерживаемая версия **не сбрасывается**: чтение блокирует запись, исходный снимок доступен recovery-экспорту.
- Ключи API не пишутся в localStorage/логи/бэкапы (`src/lib/vault.ts`, `server/secrets.mjs`). Исключение: сервер недоступен — ключ временно в localStorage.
- Облако команды (`auth.mjs`, `/api/team/*`): файлы + метаданные, до 25 МБ, снимки версий остаются у автора. Конфликты — по ревизии (`baseRev`), SSE для мгновенных правок.
- Бэкап (`lib/backup.ts`) — JSON со всеми проектами, версии разницей; старый формат читается.

## Протокол агента

Модель отвечает текстом с тегами: `<write path>`, `<edit path><find/><replace/></edit>`, `<delete path/>`, `<rename from to/>`, `<read path/>`, `<run>cmd</run>`. Парсер — `protocol.ts`, применение — `engine.ts::syncSegs` → `Turn`. Уровни автономности: «Уведомить» (применяет сразу), «Спросить» (удаление/переименование карточками + опасные команды не запускаются, `danger.ts`), «Эскалация» (всё карточками, команды запрещены). Применение устаревшей правки спрашивает подтверждение (`applyProposed`). Агент видит `.tetra/rules.md`, а также `AGENTS.md` / `CLAUDE.md` проекта пользователя.

### Слэш-команды, навыки, /loop

Подробно для пользователей — `docs/SLASH.md`. Код: `agent/slash.ts` (чистый разбор: шапка файлов, навыки `.tetra|.claude|.agents/skills/*/SKILL.md`, команды `.tetra|.claude/commands`, `$ARGUMENTS`, `/loop`-аргументы, подсказки), `agent/commands.ts` (`resolveSlash`/`submit` — вызывается из `Composer.send`; встроенные команды исполняются в приложении, остальное разворачивается в `extra` к сообщению), `agent/loop.ts` (состояние цикла в памяти, `decide`, таймер; движок сообщает `loopPassEnded` из `runTurn`). `/match` (`agent/match.ts`: `parseMatch`, `matchHooks` — снимок через `bShot`, `lib/imgdiff.ts` считает долю совпавших пикселей и карту различий) и `/autopilot` (`agent/autopilot.ts`: `FOCUS`, `autoHooks`, журнал `.tetra/autopilot.md`) — это тот же цикл `loop.ts` с `Hooks.before` (готовит запрос и картинки перед каждым проходом). Интернет и глаза агента: теги `<fetch>`, `<search>`, `<shot>` (`protocol.ts` → `engine.ts` → `webtools.ts` → `server/web.mjs`, защита от SSRF в `isPrivateIp`/`safeLookup`; скриншот — headless Edge/Chrome по `--remote-debugging-pipe`). Картинки в `ChatMsg.images` уходят провайдеру (`wireMsg` в `llm.ts`). Новая встроенная команда = запись в `BUILTINS` (+ `case` в `commands.ts`, если не просто шаблон `prompt`). Имена встроенных нельзя переопределить файлами. `/clear` — это sys-сообщение с `reset: true`, `history()` режет по нему.

### MCP

`server/mcp.mjs`: parseConfig, раскрытие `${VAR}` при запуске, хэш-одобрение (`mcp-approved.json` рядом с данными, 403 без него), McpClient (stdio JSON-RPC; Streamable HTTP JSON/SSE), пул (idle 5 мин, максимум 8), маршруты `/api/mcp/*`. Клиент: `lib/mcp.ts`, `lib/mcpconfig.ts`, `agent/mcptool.ts` (тег `<mcp server tool>{json}</mcp>`, политика по уровням), `modals/Extensions.tsx`. Не проверено: реальный npx через cmd.exe на Windows, HTTP против настоящих удалённых серверов.

### Каталог расширений

`data/market.ts` — встроенные элементы (файлы навыков/команд, конфиги MCP, наборы), `lib/market.ts` — чистая логика (planInstall/planRemove, учёт в `.tetra/market.json`, `safePath` только под `.tetra/skills|commands`, registryPack, rankSkillDirs, pickSkillFiles) и сеть через `backendFetch` (реестр MCP, skills.sh, GitHub tree + raw). UI — `modals/Catalog.tsx` (вкладка в «Расширениях»), `/market` открывает его через `wanted`. Не проверено: установка из GitHub при лимите API без токена (есть запасной путь по угадыванию папок), запуск установленных из реестра серверов на Windows.

### Библиотека компонентов (Design)

`lib/uireg.ts` — реестры формата shadcn: parseIndex, resolveBundle (цепочка registryDependencies + догрузка необъявленных импортов), materialize (раскладка по проекту, импорты → относительные, `cn`, npm-зависимости, CSS), addDeps/mergeCss. `lib/uirun.ts` — `RUNTIME_JS` (строка, а не функция: сборщик не должен ничего в ней подменять — уже наступали на `__name`), previewDoc/embedBlock. UI — `modals/UiLib.tsx` (кнопка в левой панели Studio, модалка `uilib`). Пользовательские описания — `docs/COMPONENTS.md`. Не проверено: Windows WebView2 (esm.sh/Tailwind CDN), реестры, которых мы не видели.

## Релиз (точный порядок)

Версии: `x.y.Z` исправления, `x.Y.0` новые функции, `X.0.0` крупная переработка. Виды записи в changelog **только** `new | imp | fix`; вид релиза `major | logic | visual | patch` (новые функции = `logic`).

1. Версия в четырёх местах: `package.json`, `package-lock.json` (первое `"version"`), `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`.
2. Запись **сверху** в `RELEASES` (`src/data/changelog.ts`) в стиле Steam: что изменилось для игрока, без внутренней кухни.
3. Раздел `## X.Y.Z «название» — дата` в `CHANGELOG.md` над предыдущим (обычные пункты без `new/fix`) — из него `release.yml` берёт заметки.
4. Строка «Выпущено» в `ROADMAP.md`: допиши `· X.Y название`.
5. `npm run check` и `npm run build` зелёные. Тег `vX.Y.Z` ставит человек; CI падает, если тег ≠ версиям в трёх файлах.
   Команда `/release` (см. `.claude/commands/`) делает это по шагам.

## Ловушки (уже наступали)

- Новый CSS — в **конец** `src/styles/app.css` (`html .селектор`, для светлой темы `html.light …`). `components.css` грузится позже и перекрывает.
- Новый тестовый файл не запустится, пока его нет в скрипте `test` в `package.json` (серверные `*.test.mjs` — в `node --test …`, клиентские `*.test.ts` — в `tsx --test …`).
- Новый модуль в `server/`, импортируемый другим, — добавь в `bundle.resources` (`src-tauri/tauri.conf.json`); `server/bundle.test.mjs` это проверяет.
- В JS-регулярках `\b` и кириллица не работают вместе — используй явные границы.
- Пути проекта проверяй `realInside` (сервер) и `agentPathError` (клиент): запись вне папки проекта недопустима.
- Данные в `fetch`/SSE-ответах сервера не должны содержать текст внутренних исключений для пользователя; ошибки — `err(status, 'по-русски')`.
- Картинки хранятся как base64 в `binary-assets/`; после замены — `node scripts/restore-binaries.mjs --pack`.
- Свежий коммит не должен ломать установку: `release.yml` собирает с `--features extras,updater`.

## Безопасность (инварианты)

- Пароли — scrypt; токены сессий в базе только как sha256; коды одноразовые с TTL и лимитом попыток; OAuth с неподтверждённой почтой сбрасывает пароль/сессии такого аккаунта.
- Сервер слушает только loopback; `isLocal` — и по `Host`, и по адресу сокета. Dev-ящик почты — только локально без SMTP.
- Команды агента: уровень «Спросить» блокирует опасные (`danger.ts` — эвристика, не песочница).
- Всё, что скачивается/выполняется, — только по явному действию пользователя.

## Что не проверено (держи актуальным)

Не проверено на реальной Windows: ConPTY-помощник на C#, DPAPI через PowerShell, запуск sidecar Node, трей/автозапуск/хоткей, автообновление, пути внешних редакторов, `cmd /c start powershell`. Rust не компилировался до CI. Реальные OAuth/SMTP и провайдеры моделей — только на имитациях. Установщик не подписан сертификатом (SmartScreen). CSP Tauri выключен (мешает превью «Дизайна»).

## Как проверять изменения

- Логика: юнит-тесты (`tsx --test`, `node --test`).
- Интерфейс: Playwright + Chromium против `npm run dev`, состояние доступно как `window.__tf` (zustand-стор) в dev. Для проверки агента без ключа — `scripts/fake-llm.mjs`.
- Сервер: подними dev, возьми токен тестового аккаунта и бей по `/api/*` мусорными телами — сервер не должен падать, ответы не 500.

## Автоматизации

`agent/automations.ts` — чистое ядро (parse, dueNow, matchFiles, expand, autoHash, лимит) и стор разрешений; `agent/autorun.ts` — `startAutomations()` (тик 15 с, наблюдатель файлов с debounce 8 с, смена статуса задач, открытие проекта) и `fireAuto`; UI — `modals/Automations.tsx` (раздел настроек, `/auto`). Агентный запуск идёт только при совпавшем хэше разрешения. Описание — `docs/AUTOMATIONS.md`.

## Защитный ремонт 3.1.5

- Изолированное превью: POST `/api/preview` → capability URL на отдельном loopback origin; не строить старые session-token URL и не открывать raw HTML в app-origin blob. HTML остаётся в opaque sandbox; localStorage/SW там намеренно недоступны.
- Согласие на конфигурацию/команду связано с показанной версией. `danger.ts` — эвристика, не OS sandbox. Примеры протокола внутри Markdown fences — данные.
- Async UI callback хранит pid и ожидаемое исходное значение; перед изменением перечитывает исходный проект. Файл/карточка с тем же ID в копии — не исходный объект.
- `bBatch(..., expectedHashes)` возвращает частичный `failed[]` с `CONFLICT`; это не native atomic CAS относительно внешних процессов. После внешнего ACK отдельно учитывать dirty local, включая undo к старому ancestor.
- Все новые portable regression suites должны входить в `npm test`, а не только в ручной отчёт. Проверки characterization, воспроизводящие плохой результат, не доказывают fix.
- Windows native runtime, установленный sidecar/updater/signatures и реальные OAuth/SMTP/MCP требуют отдельной приёмки. Не выдавать Linux mocks или cross-target typecheck за Windows pass. Release остаётся draft до неё.

## Восстановление и управляемый фон (3.2)

- Recovery restore всегда создаёт отдельный `recovered/...`, не проигрывает JSON/удаления и не сбрасывает sync recoveryBlocked автоматически.
- `confirmedAccountId()` — доказательство для exact backend/token/epoch, не просто `useAccount.user`. Vault delete outbox metadata-only; не очищать tombstones для обхода startup gate.
- До `prepareVaultRecovery()` после hydration не запускать writable UI/фон. В recovery sign-in `setAccountRecoveryMode(true)` запрещает account-triggered disk resync.
- Не заменять mount-safe navigation intent фиксированным setTimeout. Lazy consumers должны получить pid/target-bound initial intent.
- `stopEverything()` оставляет автоматизации paused. History whitelist/стоимость — без prompt/file/key/URL. Ledger оценочный, не billing guarantee.
- Native close/quit/update final checkpoint — до остановки backend/install. Forced kill/power-loss/native acceptance нельзя объявлять проверенными portable fixtures.
