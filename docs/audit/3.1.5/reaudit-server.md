# Второй независимый defensive-only аудит TetraFree — server / Windows integration

Дата: 2026-10-15. Проверяемый проект: `/data/tetrafree`.
**Итог: аудит не даёт release/security acceptance. Остались 9 конкретных замечаний; десятый пункт (CI registration) закрыт авторами до завершения аудита. Два остаточных дефекта подтверждены независимыми benign mock/fixture-проверками. Windows real-run НЕ выполнялся и НЕ утверждается.**

## Режим и достоверность

- AGENTS.md прочитан целиком; других AGENTS.md вне node_modules/target не найдено. Прочитаны `contracts.md`, `server-integration.md`, `windows-contract.md`. Отчёт автора `server-fixes.md` прочитан после независимого просмотра основных модулей; его результаты не засчитаны как собственные тесты.
- Репозиторий READ ONLY. Все созданные файлы находятся в `/data/fix-tetrafree/reaudit-server/` и этот отчёт — в согласованном соседнем пути. Нет исправлений кода проекта, установки пакетов, cargo install, общего check/build/prettier, запуска приложения/браузера/реального SMTP/MCP/SSRF.
- Не выполнялись эксплуатация, exploit chains или чтение чужих файлов. Файловые fixtures — только собственные синтетические файлы; ссылка на соседний fixture проверялась на отказ до открытия target. Нет настоящих listen/network; preview использует подставной объект listener, SMTP — EventEmitter-транспорты, killTree — fake launcher без процессов. Импорт `tetra-server.mjs` с его startup probes намеренно не выполнялся.
- Исходники менялись авторами patches во время аудита. Ранний снимок: `reaudit-server/snapshot/`; заключительный evidence: `reaudit-server/final-source/`, время — `final-source-time.txt`, SHA-256 — `final-source-sha256.txt`. Это копии прочитанных файлов, не Git commit. В `/data/tetrafree` нет `.git`, поэтому `git status`/diff неприменимы; это не основание утверждать чистоту Git-дерева.
- Собственные runtime fixtures: **13 всего, 11 PASS, 2 FAIL, 0 SKIP**, `reaudit-server/results.tap`. FAIL — намеренные contract assertions, которые текущий код не выполняет, а не поломка harness. Проверенные пять модулей совпали с текущими на момент повторного запуска (`tested-modules-unchanged.json`).
- **CODE** ниже означает вывод из конкретного control/data flow без runtime reproduction. **MOCK/FIXTURE** означает только указанную локальную проверку, не Windows, браузерный или production pass. **STATIC CONFIG** — проверка конфигурации, не успешный CI run.

## Приоритеты

| ID | Приоритет | Остаток | Evidence |
|---|---|---|---|
| R01 | P1 | MCP approval не связан с показанным пользователю hash/version | CODE |
| R02 | P1 | Cancel exec может сообщить завершение и забыть живой процесс; taskkill nonzero игнорируется | CODE + MOCK |
| R03 | P1, при заявлении containment для Git | Native Git продолжает интерпретировать текстовые внешние metadata/config pointers | CODE; без запуска Git/payload |
| R04 | P1 | Нет security generation для in-flight password auth и pre-session tickets | CODE |
| R05 | P2 | OAuth-only аккаунт может выключать MFA без fresh proof | CODE |
| R06 | P2 | Default `site/index.html` ломает даже относительные assets | FIXTURE + CODE |
| R07 | P2 | MCP stdio: нет обработчика stdin error и bounds/backpressure записи | CODE |
| R08 | P2 | Graceful cleanup и bounds не охватывают Git/browser subprocesses | CODE |
| R09 | CLOSED во время аудита | Три security suites первоначально отсутствовали; итоговая проверка gate включает все | STATIC CONFIG |
| R10 | P2 | Raw internal/transport errors всё ещё уходят в API | CODE |

P1 — закрыть до принятия соответствующей гарантии/релиза; это **не** заявление об установленной внешней эксплуатируемости. P2 — конкретный дефект/неполная защита с обозначенными предпосылками.

## R01 — MCP approve подтверждает текущий диск, не показанную версию

**Evidence:** `server/mcp.mjs:497–534` читает конфиг заново в каждом запросе; `/status` вычисляет hash, но не возвращает его клиенту (`509–519`); `/approve` добавляет hash вновь прочитанного конфига (`531–534`). `src/lib/mcp.ts:7–14,48–49` не имеет поля expected hash. `src/modals/Extensions.tsx:139–150` показывает `s.desc`, но подтверждает только имя.

**Дефект:** изменение файла между показом карточки и подтверждением связывает согласие с другой конфигурацией. Проверка hash при последующем запуске правильная, но сама approval boundary уже не доказывает, что разрешён именно показанный конфиг. Отзыв/stop по текущему hash также не адресует старую уже запущенную версию, если конфиг сменился.

**Что исправлять:** вернуть opaque config hash/version из status, отправлять expectedHash в approve/revoke/stop, отклонять устаревшее подтверждение; отдельно хранить owner slot `(canonical root, server name)` для адресации старых поколений. Показывать существенные env/header overrides, не только command/url, с redaction секретов.

**Не проверялось:** никаких запусков изменяемого конфига или approval race runtime. Это CODE finding. Исправленная single-flight initialization гонка — другая проблема; её собственные mocks проходят.

## R02 — bounded cancellation не является подтверждённой остановкой

**Evidence:** финальный `server/tetra-server.mjs:819–824` вызывает killTree, затем через 3 секунды уничтожает stdout/stderr и вызывает `finish(130)` независимо от факта `close`. `854–868` ставит finished и удаляет child из `execChildren`/running. `server/process-safety.mjs:9–17` на POSIX посылает только выбранный сигнал; escalation к SIGKILL отсутствует. На Windows taskkill слушается только на `error`, но не на ненулевой `exit`/`close` и не имеет собственного deadline.

**Дефект:** при неуспешной остановке приложение может показать terminal result, убрать handle из последующих cleanup и больше не пытаться остановить ещё живой процесс. На POSIX обычная программа может задерживать/игнорировать сигнал. На Windows `taskkill.exe` может успешно стартовать, но закончиться с ошибкой — это не событие spawn error.

**MOCK:** `benign.test.mjs`, тест `CONTRACT Windows cancellation…`: подставной taskkill испускает только exit=1; fallback `child.kill()` не вызывается (0 вместо 1). Настоящий taskkill и процессы не запускались. Этот mock доказывает отсутствие обработки failure, но **не** выживание дерева на Windows.

**Что исправлять:** единый awaitable tree-stop с проверкой результата, deadline/escalation; не освобождать ownership до подтверждения reap либо сохранять separate orphan cleanup registry. Для Windows предпочтителен per-operation Job; глобальный Rust Job страхует только закрытие приложения, не успешность обычного cancel. UX должен различать «отмена запрошена» и «процесс завершён».

**Не повторяется как старый баг:** новый session-scoped runId, duplicate=409, pending cancellation bit и tombstones просмотрены в финальном коде `302–314,770–817,882–895`. Первоначальное наблюдение глобальной map без этих исправлений снято.

## R03 — Git metadata containment неполон для native interpretation

**Evidence:** `server/tetra-server.mjs:174–177,219–233` обходит реальные записи `.git`, запрещает symlink и top-level commondir, но не интерпретирует содержимое обычных metadata/config-файлов. Перед native Git задаются только `core.worktree`/`core.bare`, окружение очищается, но конфигурация Git не изолируется полностью.

**Дефект/граница:** обычные Git config includes, object alternates и пути к внешним Git helpers/hooks — это текстовые ссылки, не filesystem symlink. Они проходят такой обход как обычные файлы; native Git затем интерпретирует их по собственным правилам. Поэтому вывод «проверили все .git entries, следовательно Git не выходит за project root» неверен. Overrides worktree и запрет commondir закрывают лишь часть механизмов.

**Что исправлять:** явно определить допустимую модель доверия для Git. Для containment — ограничить native config/metadata indirection и внешние helpers на каждом используемом code path, либо вынести Git в настоящую OS boundary; одной recursive realpath проверки недостаточно. Не называть эти Git операции sandboxed.

**Evidence distinction:** только CODE + правила интерпретации native Git. Не создавались специальные Git конфиги, не вызывались hooks/helpers, не открывались внешние объекты/файлы, не строилась цепочка. Факт утечки/выполнения на целевой системе не заявляется.

## R04 — credential changes/revocation не отменяют in-flight authentication

**Evidence:** `server/auth.mjs:597–619` читает user, ожидает async verifyPw и после await выдаёт postAuthentication без повторной сверки credential version/hash. Reset (`651–668`) и password change (`795–805`) меняют hash и удаляют готовые sessions, но не меняют security generation. MFA tickets (`252–256`) содержат uid/TTL/tries/remember; login continuation (`622–639`) не сверяет generation. OAuth exchange ticket (`723–736`) тоже только uid/TTL.

**Дефект:** завершившаяся после смены credentials первичная проверка может создать новую сессию/новый challenge на основании ранее прочитанного hash. Уже выданные pre-session tickets не инвалидируются сменой пароля/общей ревокацией и остаются ограничены только TTL и действующим MFA proof. Это не отменяет MFA, но нарушает сильную семантику «старые credentials/login continuations отозваны».

**Что исправлять:** persisted auth/security epoch на пользователя, захват до async проверки, повторная сверка непосредственно перед созданием ticket/session; bind tickets/codes к epoch; увеличение на password reset/change и соответствующей revocation. Определить отдельно, какие OAuth continuations должны переживать смену пароля.

**CODE only.** Не выполнялись вход по старому паролю, обход MFA, восстановление отозванной сессии или подобные runtime сценарии.

## R05 — выключение MFA у OAuth-only пользователя без fresh proof

**Evidence:** `server/auth.mjs:843–852` проверяет пароль только если `passHash` существует, затем удаляет totp; TOTP/recovery/recent-auth/provider reauth не требуется. OAuth-only пользователь штатно не имеет passHash.

**Дефект:** любая действующая bearer-сессия такого пользователя получает право снять MFA без повторного доказательства. Для password account fresh password хотя бы проверяется; для OAuth-only эквивалентной проверки нет. Это hardening gap security-sensitive action, не доказательство получения чужой bearer-сессии.

Дополнительная ошибка lifecycle: ранее выданный MFA ticket после отключения/замены totp не закрывается; numeric continuation идёт в `totpOk`, где `u.totp.secret` читается без guard (`353–359,629–632`), что при удалённом totp даёт internal error вместо понятного challenge-invalid ответа.

**Что исправлять:** uniform step-up policy для смены MFA, инвалидирование MFA tickets при смене секрета/отключении, проверка enabled+epoch перед totpOk. **CODE only**, отключение MFA на аккаунтах не запускалось.

## R06 — default preview URL теряет directory base `site/`

**Evidence:** `server/preview.mjs:28` по пустому относительному пути отдаёт `site/index.html`, но `issue:57` возвращает `/p/<cap>/`. Следующий относительный URL браузера вычисляется от `/p/<cap>/`, а serve:29 разрешает его от root проекта, не от site.

**FIXTURE:** собственные `site/index.html` и `site/style.css`, только HEAD через fake server. Default document=200; `new URL('style.css', returnedUrl)`=404 вместо 200. Это один из двух FAIL в results.tap. При явном path=`site/index.html` нормальный запрос проходит.

Это **не** известное ограничение root-absolute `/assets/...`: ломается обычный относительный asset у штатного default site entrypoint, без какого-либо опасного содержимого. В server-fixes handoff «Relative assets work» для этого default пути не подтверждается.

**Что исправлять:** возвращать/redirect на канонический capability URL фактического entrypoint (`site/index.html`) либо сохранять корректный base в схеме роутинга. Сохранить текущие sandbox/origin ограничения; не исправлять возвратом в app origin.

## R07 — MCP stdio stdin error и исходящая очередь не управляются

**Evidence:** `server/mcp.mjs:209–255` ставит обработчики child error/exit/stdout/stderr, но не `child.stdin.on('error')`. `291–294` вызывает stdin.write без проверки writableLength, возврата false, drain и callback ошибки. `304–324` допускает независимые concurrent waits без лимита.

**Дефект:** закрытие stdin помощником во время обычной записи может дать необработанный stream error, а медленно читающий helper — накопление записей/ожидающих requests. В standalone main uncaughtException handler только логирует (`tetra-server.mjs`, конец файла), что не является корректным завершением соответствующих requests; в другом import/dev host такого handler может не быть. Inbound 2 MiB limit не ограничивает outgoing queue.

**Что исправлять:** stream error -> единый fail+close, bounds на outstanding requests и queued bytes, drain-aware write, cleanup записи при synchronous write failure. **CODE only**; EPIPE/flood реальному процессу не генерировались.

## R08 — Git/browser не включены в graceful subprocess ownership; Git output unbounded

**Evidence:** `server/tetra-server.mjs:318–331` shutdown ждёт только PTY и execChildren, плюс вызывает mcpPool.closeAll. `git:179–216` не добавляет child в registry, не связывает с abort/disconnect, копит out/so/se без bounds и при timeout вызывает только root `p.kill()`. Большинство Git вызовов используют timeout=0. Поздний clip не ограничивает сбор stdout в памяти.

`server/web.mjs:386–452` screenshot child не зарегистрирован в shutdown; finally вызывает только root kill, не await tree reap, затем отложенное удаление профиля. Disconnect HTTP не передаёт cancellation в takeShot. У MCP stdio child exit также сразу ставит closed (`mcp.mjs:247–254`), после чего close:415–416 возвращается без tree cleanup — root exit и descendant exit не эквивалентны.

**Дефект:** graceful протокол не охватывает все server-created subprocesses; detached descendants/remote helper hang и лишняя работа после disconnect не контролируются этим lifecycle. В Windows desktop общий Rust Job ограничивает последствия **при завершении app**, но не делает эти отдельные операции cancellable/reaped. На standalone Node такого Job нет.

**Что исправлять:** общий child ownership registry с type-specific cleanup, bounded Git capture/timeout, сигнал HTTP cancellation, гарантированное tree stop/reap на каждом root exit. **CODE only**, Chromium/Git/MCP-процессы не запускались в аудите.

## R09 — CLOSED: security suites включены в gate до завершения аудита

**Первое STATIC CONFIG наблюдение (13:27:51Z):** в effective gate `ci.yml` (`npm test` плюс дополнительные прямые node --test) отсутствовали `server/mail-security.test.mjs`, `server/server-routes-security.test.mjs`, `server/server-security.test.mjs`. `pty-windows.test.mjs` уже вызывался отдельным шагом, поэтому не считался пропуском effective gate.

**Заключительная проверка (13:31:18Z):** parent изменил package.json; `static-gates.json` теперь возвращает `serverTestsNotGated: []`. R09 снят как текущий остаточный баг. Ранний package сохранён в `snapshot/package.json`, финальный — в `final-source/package.json`. Это подтверждение регистрации, **не** успешного выполнения suites/CI.

Положительно проверено статически: ресурсы всех текущих runtime server modules перечислены, Cargo.lock существует; CI/release cargo args имеют --locked, Node22.16.0/Rust1.90.0 фиксированы, action pins — полные 40-hex, release зависит от verify и создаёт draft. Проверка формы SHA **не** доказывает provenance action commit; remote actions не запрашивались. Версии package.json/package-lock/root lock совпадают (3.1.4 на момент проверки). Зеленый workflow/run или реально подписанный artifact не наблюдались.

## R10 — внутренние сообщения ошибок продолжают выходить наружу

**Evidence:** `server/tetra-server.mjs:695,709,719` возвращает String(e.message) для batch; `server/auth.mjs:1162–1164` возвращает e.message даже для непредвиденного 500; `server/mail.mjs:181–185` включает SMTP diagnostic в публичный 502; `server/mcp.mjs:244–253,311–315,573–574` передаёт remote stderr/internal diagnostic через error.message в HTTP; `server/web.mjs:468–469` делает то же.

**Дефект:** локальные пути, OS/transport детали и arbitrary helper/server diagnostics могут попадать в UI/API. Это прямо расходится с AGENTS.md (не отдавать текст внутренних исключений; публичные русские ошибки). Наличие утечки конкретного реального пароля/ключа **не заявляется** — это не проверялось.

**Что исправлять:** bounded/redacted server-side diagnostic + generic Russian public message + correlation ID; отдельно оставить явно разрешённые validation/conflict сообщения. Не заменять «плохие» детали одним только усечением строки. **CODE only**.

## Проверенное положительно и не повторяемое как остаточный баг

| Область | Что подтверждено | Граница evidence |
|---|---|---|
| Filesystem | Shared inside/realInside; повторная проверка final directory index; dotfiles/node_modules не отдаются в preview; own CAS/hash/null и project-lock release работают | Независимые fixtures, только Linux/свои файлы; не NTFS/ADS/junction real-run |
| Isolated preview | Dedicated loopback listener design, random project+session capability, TTL, no API dispatch; CSP sandbox без allow-same-origin; session revocation возвращает 401 | HEAD/headers на fake server; не browser/WebView2 acceptance |
| Auth/MFA | verify/login/reset/OAuth exchange идут через postAuthentication; enabled MFA не выдаёт сразу session в этой функции; pending registration сохраняет existing credentials и rechecks после scrypt | CODE inspection; авторские auth-тесты не пересчитывались как независимые |
| SMTP | Нет AUTH/mail без STARTTLS; unauthorized TLS отклонён; authorized mock transport проходит | 3 собственных mock PASS; реальный SMTP и цепочки сертификатов не проверены |
| MCP | single-flight ready shared; stop pending init rejects waiter; strict typed response ID/result schema; closed client rejects request | Независимые controlled-promise/pure fixtures; stdio/npx/real HTTP не запускались |
| Exec/env | Known SMTP/OAuth/backend/Git env denylist; bounded response helper; новый scoped cancellation registry просмотрен | Env/queue helper mock PASS; фактические shell/cmd/PTY команды не запускались |
| PTY | Dimension integer bounds, bounded ring/subscribers/output backlog, input length/backlog guard, generic diagnostics; shutdownPty deadline есть | CODE, не runtime proof; resize path имеет отдельную непроверенную очередь |
| Rust lifecycle | Node stdin piped; suspended spawn -> assign Job -> resume; Job KILL_ON_JOB_CLOSE без breakaway; bounded graceful poll и terminate+wait; lifecycle lease сериализует restart/install | Только CODE. Нативные Job/ConPTY, установка/обновление, stop/restart не запускались |
| Updater | download до stop backend; lease; recovery spawn при install error; app restart после успеха | CODE. Ни download/signature accept/reject, ни installed-artifact run не проверены |
| Release/lock | Same-SHA local reusable CI dependency, draft, fixed tools, --locked, resources присутствуют | STATIC CONFIG; R09 registration закрыт, execution не проверен |

## Остальные границы, которые нельзя выдавать за гарантии

- realpath containment не race-free sandbox: нет handle-based openat/no-follow модели; hardlink/OS races и Windows path semantics здесь не доказаны. Это прямо признано кодом/контрактом, не новый «успешный обход».
- Project lock оборачивает batch, не все worktree writers. Git routes/discard/checkout и пользовательский shell могут менять файлы параллельно. CAS не является native atomic compare-write; для Git-вызовов самого сервера можно расширить общий project lock. Соглашение о partial-success HTTP200+failed[].code=CONFLICT принято, не сообщается как неверный 409.
- Preview capability сохраняет возможность самому project script читать/передавать разрешённое содержимое своего проекта; это не OS isolation и не защита доверенного файла от кода в том же проекте. CSP намеренно допускает внешние HTTPS assets. Основная проверенная граница — отделение от app/API origin.
- `src/agent/webtools.ts:63–69` для project path использует isolated preview helper; explicit dev URL остаётся отдельным режимом. `server/web.mjs:374–375` ограничивает начальный URL screenshot loopback, но не является полноценной сетью-песочницей браузера/subresources/redirects. Не проверялось никакими реальными запросами; blanket SSRF-safe claim не даётся.
- `/api/proxy` поддерживает пользовательские LLM endpoint URLs; доступ к локальным провайдерам может быть намеренным. Не объявляю саму эту возможность новым SSRF-багом без согласованной политики.
- Env sanitizer — denylist известных server-private vars, не обнаружение любых секретов. Явные project/MCP env overrides разрешены по дизайну.
- Windows Job закрывает также внешние редакторы/терминалы, созданные backend. Это известная граница windows-contract, нужна пользовательская acceptance; silent breakaway не предлагался.
- Rust stop имеет пятисекундный graceful poll, затем native termination/wait. Из этого кода нельзя честно вывести абсолютную верхнюю границу wall-clock завершения native wait при любой ошибке ОС.

## Артефакты и воспроизведение только безопасных проверок

Папка: `/data/fix-tetrafree/reaudit-server/`.

- `benign.test.mjs`, `smtp-benign.test.mjs` — собственные тесты, только fixtures/mocks.
- `results.tap` — совместный повторный запуск: 13 / 11 PASS / 2 FAIL.
- `benign.tap`, `smtp-benign.tap` — первые отдельные запуски; не суммировать их с повторным как независимые cases.
- `static-gates.mjs`, `static-gates.json` — проверка конфигурации gate, без workflow execution.
- `snapshot/`, `snapshot-sha256.txt`, `final-source/`, `final-source-sha256.txt` — source evidence; `start-sha256.txt` — начальная карта до поздних patches.
- `tested-modules-unchanged.json` — проверка совпадения пяти тестируемых runtime модулей с актуальными на момент повторного запуска.

Безопасная команда (не пишет проект, не запускает приложение):

```sh
node --test /data/fix-tetrafree/reaudit-server/benign.test.mjs /data/fix-tetrafree/reaudit-server/smtp-benign.test.mjs
```

На зафиксированном коде ожидается exit=1 именно из-за R02/R06. Для приёмки нужны исправление девяти открытых пунктов, зелёное выполнение уже включённых regression suites в CI и отдельный честный Windows/installed artifact/updater acceptance. **Этот отчёт не заменяет ни один из этих real-run gates.**
