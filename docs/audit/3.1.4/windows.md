# TetraFree 3.1.4 — Windows / Tauri / sidecar audit

> Архивирование аудита: стенд был сброшен после паузы пользователя. Этот текст восстановлен из журнала сессии; ссылки на первоначальные локальные harness/log-файлы — описание методики, а не обещание их наличия в репозитории. Полный check/build и UI-репродукции повторены после восстановления. Windows, реальные OAuth/SMTP/model providers и browser-IDB failure integration не проверены.

Дата: 2026-10-13. Объект: `/data/tetrafree`. Проект не редактировался, сборка/установка не запускались, push не выполнялся. Отчет и репродукции — только в `/data/audit-tetrafree/`.

## Краткий вывод

**Основные риски:** принудительная остановка только Node, а не дерева его процессов; потеря бэкенда после ошибки установки обновления; smoke ConPTY может быть зеленым без исполнения команд и без работающего resize. Еще найдены подтвержденные дефекты обработки UTF-8, дробных размеров PTY, кеша sidecar, UNC-путей и усечения Windows exit code.

Ниже **3 P1, 10 P2, 3 P3**. Приоритет оценивает последствия, а не степень экспериментального подтверждения. P1 — исправить перед следующим стабильным релизом; P2 — ближайший цикл; P3 — диагностика/воспроизводимость/редкие случаи.

### Границы доказательств

- Среда: Linux x86_64, Node `v24.14.1`; в CI Windows используется Node 22. `rustc`, `cargo`, `wine`, `pwsh`, `powershell`, `dotnet`, `csc` в PATH отсутствуют.
- **L** — воспроизведено на Linux выполнением реального JS-кода/маршрута. Это не означает проверку Windows.
- **M** — реальный JS-код выполнен с подмененными внешними зависимостями либо точная модель маленького участка Rust/C#; границы подмен указаны.
- **C** — вывод непосредственно из кода; ОС-зависимое поведение не запускалось.
- **H** — Windows-гипотеза: требуется нативная проверка, не включена в число подтвержденных дефектов.
- Номера строк относятся к прочитанному снимку. `.git` в копии нет; commit SHA и чистоту git status установить нельзя. Хэши прочитанных scoped-файлов сохранены в `windows/scope-hashes.txt`.
- **STARTF_USESTDHANDLES уже есть** в `server/conpty-win.mjs:112–116`. Не заявляется как новый баг или отсутствующее исправление.
- Подлинная Windows сборка Rust, установщик, WebView2, DPAPI, ConPTY и end-to-end updater **не проверены**. Linux запуск `smoke-win.mjs` завершился с явным skip, это не Windows pass.

## Проверки и артефакты

```sh
cd /data/tetrafree
node --test server/conpty.test.mjs server/bundle.test.mjs server/release-notes.test.mjs server/editors.test.mjs
node scripts/smoke-win.mjs
node /data/audit-tetrafree/windows/probe.mjs
node /data/audit-tetrafree/windows/sidecar-probe.mjs
```

- 13 scoped unit tests: **13 pass / 0 fail**. Лог: `windows/unit-tests.log`.
- Smoke на Linux: **skipped**. Лог: `windows/smoke-linux.log`.
- `windows/probe.mjs`, результат `windows/probe-results.json`: реальный `onOut` портит разделенную UTF-8 строку (`Привет` → `��ривет`); реальный первый шаг smoke проходит на mock-helper, который только эхо-печатает ввод, игнорирует resize и завершает работу кодом 42; реальный Linux PTY принимает `cols=80.5`, отвечает 200 и сразу завершается кодом 1; модель Rust clean портит verbatim UNC; модель C# преобразует exit 256 в 0.
- `windows/sidecar-probe.mjs`, результат `windows/sidecar-results.json`: реальный скрипт с mocked fs пропускает копирование по одному размеру файла; при ARM64 Node и x64 rust host создает имя x64 sidecar. Нативные PE-файлы не создавались и не исполнялись.

## Реестр

| ID | Приоритет | Доказательство | Проблема |
|---|---|---|---|
| W01 | P1 | C | Rust убивает только Node, не дерево терминалов/команд/MCP |
| W02 | P1 | C | После ошибки install updater сервер уже остановлен и не возвращается |
| W03 | P1 | M | Основной ConPTY smoke проходит на эхо ввода, не проверяет resize/exit |
| W04 | P2 | C | Таймаут/отмена Windows exec убивает только cmd, оставляя потомков |
| W05 | P2 | L + C | Порча split UTF-8 и отсутствие стратегии OEM-кодировки Windows exec |
| W06 | P2 | L + C | Дробные размеры PTY приняты API, но роняют helper |
| W07 | P2 | C | Ограничение ring не ограничивает HTTP backpressure-память |
| W08 | P2 | C | Release workflow не зависит от результатов CI/Windows smoke |
| W09 | P2 | M | Sidecar cache считает одинаковый размер равенством бинарников |
| W10 | P2 | C | Windows %CD% в compound command раскрывается до изменения каталога |
| W11 | P2 | C | Exec наследует серверные секреты, в отличие от PTY |
| W12 | P2 | C | Диагностические smoke steps фактически обязательные и без общего timeout |
| W13 | P2 | C | Ошибки runtime helper полностью теряются, health сообщает только наличие exe |
| W14 | P3 | M | Rust clean некорректно удаляет префикс verbatim UNC |
| W15 | P3 | M | C# усекает Windows exit code до 8 бит |
| W16 | P3 | C | Нет Cargo.lock и фиксированных ревизий release actions |

## P1

### W01 — остановка/рестарт Tauri не освобождает дерево процессов

**Файлы:** `src-tauri/src/lib.rs:90–98`; `src-tauri/src/server.rs:126–132`; `src-tauri/src/updates.rs:41–44`; `server/pty.mjs:157–172`; `server/tetra-server.mjs:745–756`; `server/mcp.mjs:193–208,384–394`.

**Доказательство C:** при выходе приложения, ручном рестарте сервера и установке обновления вызывается `Child::kill()` для единственного прямого ребенка — Node. Нет Windows Job Object, tree-kill или graceful shutdown protocol. JS cleanup привязан к `process.on('exit')`; принудительное внешнее завершение процесса не исполняет этот callback. MCP `close()` к тому же использует отложенный kill — таймер не может выполниться из синхронного exit callback. PTY отдельно умеет `taskkill /T`, но до этого обработчика при внешнем kill Node управление не доходит.

**Windows воспроизведение (не выполнено):** открыть PTY и запустить `node -e "setInterval(()=>{},1000)"`; также запускать долгую команду через агент/exec и stdio MCP. Снять дерево PID через Process Explorer или `Get-CimInstance Win32_Process`. Закрыть Tauri через «Выход», затем отдельно повторить «Перезапустить сервер» и обновление. Проверить, исчезли ли helper/PowerShell/cmd/node MCP и их дочерние процессы. Учитывать возможное самостоятельное завершение helper на EOF: **не утверждаю, что каждый потомок всегда переживет exit**, проблема — отсутствие гарантии и управления всем деревом.

**Последствия:** фоновые процессы/порты и файловые блокировки переживают приложение; install может столкнуться с открытыми файлами, новые сервер/терминал — со старой задачей. Не обязательно сохраняется порт 3001: им владел убитый Node; порты потомков — другой риск.

**Исправление:** единый lifecycle: Windows Job Object с `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`, назначение Node и гарантированное включение потомков; graceful shutdown для завершения задач и сохранения данных, ограниченный timeout, затем уничтожение дерева и wait. Явно отделять намеренно открытые внешние редакторы/окна терминала, которые должны переживать приложение. Добавить тест дерева для exit/restart/update.

### W02 — updater оставляет приложение без сервера при ошибке install

**Файлы:** `src-tauri/src/updates.rs:31–47`; `src/modals/Settings.tsx:833–843`; `src/App.tsx:281`.

**Доказательство C:** загрузка сначала завершается успешно, затем `st.0.lock().unwrap().take()` удаляет `Child` из состояния и `kill()` останавливает Node. Далее `update.install(bytes)?` может вернуть ошибку. В этой ветке нет ни повторного `server::spawn`, ни восстановления состояния, ни ожидания завершения убитого процесса. В Settings ошибка показывается, а действие toast в App поглощает ее. Реальная возможность конкретной ошибки зависит от installer/plugin/Windows; отсутствие recovery в исходнике однозначно.

**Windows воспроизведение (не выполнено):** использовать тестовый подписанный update с заведомо неустанавливаемым artifact либо заблокировать запуск installer политикой/ACL в тестовой VM. После успешной download и ошибки install проверить `server_status`, `/api/health`, команды и файловую синхронизацию. Не экспериментировать с рабочим пользовательским профилем.

**Последствия:** текущее окно живо, но диск/shell/git недоступны до ручного рестарта; неясно, остановлены ли дочерние задачи. UI может не объяснить причину.

**Исправление:** общий shutdown с wait, а на возвращаемой ошибке install — восстановить сервер и состояние, сообщить обе ошибки при неудаче recovery. Сериализовать update_install/server_restart, исключить несколько параллельных installs. Согласовать с реальной семантикой Windows installer Tauri: успешный install может завершать процесс, поэтому тестировать recovery именно на ошибочной ветке.

### W03 — smoke ConPTY не доказывает исполнение команд, resize или корректный exit

**Файлы:** `scripts/smoke-win.mjs:33–70`, особенно `59–64,66–69`.

**Доказательство M:** выполнялся **реальный текст первого шага**, но import helper, fs и spawn подменены. Fake helper выдавал prompt, затем только возвращал введенные строки `echo hello-conpty` и `echo second-line`; команд не выполнял, resize игнорировал, на `exit` выдавал код 42. Шаг все равно прошел. Это доказательство слабого assertion, не доказательство поломки реального ConPTY.

**Воспроизведение:** `node /data/audit-tetrafree/windows/probe.mjs`; в JSON `smokePassed=true`, `executions=0`, `resizes=0`. В реальной Windows можно намеренно отключить доставку stdin в ConPTY в отдельной тестовой копии и проверить тест.

**Последствия:** release/CI могут считать исправление терминала рабочим, когда xterm показывает только эхо введенной команды; resize может не работать вообще. Timeout ветка делает `p.kill()` и resolve, не fail, нормальный exit code не проверяется.

**Исправление:** вывод должен отличаться от введенного текста (например, вычисляемое число/строка из двух частей), искать отдельный output record после удаления VT-последовательностей и command echo; проверить реальные dimensions через консольное приложение (`GetConsoleScreenBufferInfo`), которое запущено внутри PTY; явно требовать expected exit и fail на timeout. `try/finally` с tree-kill для каждого шага. Проверять **production PowerShell 5.1**, а не только cmd.

## P2

### W04 — отмена Windows exec не прекращает выполняемую задачу

**Файлы:** `server/tetra-server.mjs:789–805,819–825`.

**Доказательство C:** на Windows `child` — `cmd.exe /c ...`. Таймаут, disconnect и `/api/exec/kill` вызывают только `child.kill()`. В отличие от `pty.mjs:159–160`, здесь нет `/T` или Job Object. Убийство родителя само по себе не является контрактом убийства дерева Windows.

**Windows воспроизведение (не выполнено):** через API выполнить `node -e "require('fs').writeFileSync('audit-child.pid',String(process.pid));setInterval(()=>{},1000)"`, задав timeout 1–2 секунды; затем повторить ручную отмену. Проверить PID из файла, состояние HTTP stream, порты и открытые файлы. Проводить в временном проекте.

**Последствия:** «процесс остановлен» неверно для дочерней задачи; потомок с унаследованным stdout может задержать Node событие `close` и окончание HTTP stream. Повторный запуск дублирует работу.

**Исправление:** переиспользовать гарантированный job/tree lifecycle для exec; отдельно ограничить время ожидания закрытия streams, завершать NDJSON error/exit детерминированно. Проверять cancel для cmd → npm.cmd → node, а не только для пустого cmd.

### W05 — stdout/stderr повреждают UTF-8 на границе чанков; OEM Windows не обработана

**Файлы:** `server/tetra-server.mjs:761–787` (exec), `223–232` (git); `server/pty.mjs:10–12` (настройка относится только к PTY PowerShell).

**Доказательство L:** исполнен оригинальный `onOut`. Два Buffer с разделенным первым символом `Привет` дали `��ривет`. Каждый `data` независимо декодируется `.toString('utf8')`; остаток многобайтного символа не сохраняется. На stderr тот же дефект; `out += d` в git также не потоковый декодер.

**Windows часть C:** non-PTY exec запускает cmd без `chcp`/encoding policy, но трактует bytes как UTF-8. PTY startup encoding не меняет этот путь. Реальный вывод зависит от OEM codepage и конкретной программы, поэтому **не утверждаю, что вся Windows кириллица всегда испорчена**.

**Воспроизведение L:** `windows/probe.mjs`. Windows acceptance: русская Windows с CP866, `echo Привет`, сообщение `dir` о кириллическом имени, внешняя Node UTF-8 программа, stderr, разбиение UTF-8 символа между writes. Сравнить bytes и текст.

**Последствия:** поврежденные сообщения, пути/cwd и диагностика агента; исправление только «кодировки по умолчанию» не лечит chunk boundary.

**Исправление:** `setEncoding('utf8')`/`StringDecoder` отдельно на stdout/stderr с финальным flush; затем единая и задокументированная политика codepage для cmd и внешних программ. `chcp 65001` — не универсальный декодер для любой сторонней программы; тестировать смешанные случаи. Не переводить Base64/raw bytes PTY в chunk `.toString` до потокового terminal decoder.

### W06 — API разрешает дробные dimensions, helper требует integer

**Файлы:** `server/pty.mjs:190–191,238–240`; `server/conpty-win.mjs:88–89,188–189`; Python helper `server/pty.mjs:44`.

**Доказательство L:** `/api/pty/open` с `cols=80.5` возвращает 200/sid; Linux Python `int('80.5')` завершает helper, stream получает `{"x":1}`. Нативный C# `int.Parse('80.5')` тоже не соответствует принятому API значению; C# не запускался. При resize `TryParse` просто отвергает строку, silently игнорируя запрос.

**Воспроизведение:** `windows/probe.mjs`; Windows — authenticated POST open с `cols:80.5`, потом stream. Проверить также rows fraction, NaN-подобные строки, Infinity (через строку), null, very large values.

**Последствия:** пользователь получает «открыт» для немедленно умершего терминала; ошибку helper API скрывает, процесс занимают записи sessions на 60 секунд. Обычный xterm передает integers — основной источник плохого значения API/custom clients.

**Исправление:** строгие finite integers с 400 либо нормализация `Math.floor` перед clamp и единая проверка open/resize. Валидировать native аргументы и возвращать понятную диагностическую ошибку вместо необработанного `FormatException`.

### W07 — PTY ring 256 KB не ограничивает очередь медленного HTTP клиента

**Файлы:** `server/pty.mjs:123–128,200–220`; `server/tetra-server.mjs:733–735` — похожая проблема exec.

**Доказательство C:** `res.write()` вызывается для каждого stdout chunk, return value игнорируется; `child.stdout` не pause/resume на drain. Ring ограничен, но per-response Node stream queue — отдельная память. Число `s.subs` тоже не ограничено. Это не абсолютная оценка потребления RAM; нагрузочный тест не запускался на общем компьютере.

**Воспроизведение:** в изолированном authenticated профиле подключить `/api/pty/stream`, прекратить чтение тела и запустить большое/непрерывное печатание в PTY. Следить за RSS, `writableLength`, количеством подписчиков. Установить жесткий лимит процесса и завершать тест при пороге; не запускать бесконечный flooding на общем сервере.

**Последствия:** исчерпание RAM сервера/приложения из-за зависшей вкладки/stream. `RING` и лимит 12 sessions этого не предотвращают.

**Исправление:** лимит writable backlog и subscribers, отсоединение медленного потребителя с явным сообщением; bounded queue. Нельзя бездумно pause stdout при одном медленном subscriber, блокируя всех: определить политику drop/disconnect/reconnect с ring.

### W08 — релизный тег обходит quality gates

**Файлы:** `.github/workflows/release.yml:7–9,22–27,42–52`; `.github/workflows/ci.yml:2–5,29–36`.

**Доказательство C:** release job делает install dependencies и сразу build/publish. В нем нет scoped/full тестов, Windows smoke и `needs` проверочного job. CI triggered main/PR, а не v-tag, и независимый workflow не гарантирует, что релизный SHA успешно проверен. Отсутствие smoke особенно существенно с W03.

**Воспроизведение:** логический сценарий — поставить v-tag на SHA, который не прошел main/PR CI (branch/новый коммит), либо на SHA с падающим test, но успешной Tauri build. Workflow все равно доходит до publish, если сама сборка успешна. **Тег не создавался и workflow не запускался**.

**Последствия:** signed updater artifacts для непроверенного кода; цифровая подпись гарантирует происхождение, не корректность.

**Исправление:** reusable verification workflow или проверочные jobs release с `needs`; tests + исправленный production Windows smoke на том же SHA, затем bundle smoke установленного приложения и publish. Сначала draft release, публикация после проверки артефактов. Не полагаться на совпадение по имени ветки.

### W09 — sidecar «свежесть» определяется только размером

**Файлы:** `scripts/prepare-sidecar.mjs:30–34`.

**Доказательство M:** реальный скрипт с fs mocks сообщает «уже на месте» и не копирует, если размеры совпали; bytes/version/hash не сравниваются. Equal-size binaries могут отличаться; наличие такого совпадения в реальных Node versions здесь не проверено.

**Воспроизведение:** `windows/sidecar-probe.mjs`; нативный вариант в отдельной копии — существующий sidecar заменить другим same-size файлом, запустить prepare-sidecar, сравнить SHA256.

**Последствия:** developer build содержит stale/corrupt Node, отличающийся от проверенного runtime; при corruption backend не стартует. На чистом CI checkout риск меньше, поэтому не считать это доказанным багом каждого release.

**Исправление:** всегда копировать текущий Node либо сравнивать криптографический digest; atomic temp+rename и проверка destination `--version`/PE architecture. Не исполнять неизвестный поврежденный бинарник в проверке — сначала источник/хэш.

### W10 — non-PTY Windows exec возвращает прежний cwd

**Файлы:** `server/tetra-server.mjs:740–751,771–774`.

**Доказательство C:** script — `${cmd} & echo __TF_CWD__%CD%`. `%CD%` обычного cmd compound command раскрывается на стадии parsing, до исполнения предшествующего `cd`. Windows не запускалась; это кодовый вывод на основе семантики cmd, не нативный результат.

**Windows воспроизведение:** в временном проекте создать `sub`, выполнить через `/api/exec` `cd sub`; сравнить NDJSON exit.cwd с последующим `echo %CD%`, который запускается новым запросом. Повторить `cd /d` и пути с пробелами/кириллицей/`!`. Ожидаемый returned cwd — `sub`.

**Последствия:** построчный fallback terminal и команды, использующие returned cwd, запускают следующую команду не там, где пользователь только что сделал cd.

**Исправление:** отдельные строки в temporary batch/script с сохранением exit status и выдачей cwd после выполнения, либо shell wrapper с поздним expansion. Не включать delayed expansion глобально без обработки `!` в командах и путях. См. H01: корректность errorlevel тоже необходимо проверять, а не предполагать.

### W11 — exec передает серверные секреты выполняемым программам

**Файлы:** `server/tetra-server.mjs:754`; сравнение `server/pty.mjs:92–95`.

**Доказательство C:** exec использует `{...process.env,...}` целиком, PTY удаляет `SMTP_URL`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_SECRET`. Один и тот же build/install/package command через exec получает больше секретов, чем через терминал. Реальные значения не читались/не выводились.

**Воспроизведение:** в отдельном сервере задать фиктивные `SMTP_URL=sentinel`, `GITHUB_CLIENT_SECRET=sentinel`; выполнить через exec команду, проверяющую наличие имен переменных без печати значения. Сравнить PTY. Не использовать настоящие credentials.

**Последствия:** npm lifecycle script/команда проекта может отправить интеграционные секреты в сеть или лог. Это **не обход авторизации**: доступ к exec уже должен быть разрешен, но окружение backend не должно автоматически становиться окружением проектного кода.

**Исправление:** единая функция sanitized child env для PTY, exec, git, MCP и browser helper; allowlist/explicit project env и denylist известных server-only secrets. Не удалять пользовательские project env без прозрачной настройки.

### W12 — «только отчет» smoke steps могут сломать/подвесить Windows CI

**Файлы:** `scripts/smoke-win.mjs:17–26,72–75,124–136,214–216`; `.github/workflows/ci.yml:30`.

**Доказательство C:** все шаги, включая помеченные «только отчет», попадают в общий results; любые исключения делают exit 1. Контроль устанавливает **нефиксированный** `@lydell/node-pty` через npm; нет timeout, `error` listener для spawned npm и гарантированного finally для helper/terminal/temp dirs. В основном ConPTY шаге fail `waitFor` до `exit` тоже оставляет процессы. Ошибка spawn может стать необработанным событием, а сеть/установка — длительным зависанием.

**Воспроизведение:** Windows VM без доступа к npm registry; повторить с недоступным npm либо искусственно задержанной установкой. Для cleanup — заставить `waitFor` упасть после создания helper и проверить оставшиеся PID. В этой Linux сессии сетевой install не запускался.

**Последствия:** падение/длительное зависание обязательной CI проверки по нерелевантной диагностике; nondeterminism; утечки процессов на self-hosted runner.

**Исправление:** обязательные и информационные шаги разделить; informational failures не учитывать в fatal `bad`. Контрольный node-pty — фиксированная version/lock + bounded time, либо отдельный job. `error`, close/exit, timeouts и `finally` cleanup во всех spawn ветках. Job-level timeout как последняя страховка.

### W13 — helper stderr теряется, health не проверяет работоспособность PTY

**Файлы:** `server/pty.mjs:20–26,40,129,135–148`; `server/conpty-win.mjs:97–100,121–124`; `scripts/smoke-win.mjs:203–208`; `server/tetra-server.mjs:326–340`.

**Доказательство C:** WIN_EXE устанавливается при наличии/сборке exe; `hasPty` только проверяет его. При CreatePseudoConsole/CreateProcess failure helper печатает код в stderr, но PTY подписчик stderr пустой. `child.on('error')` также не сохраняет текст. Health `pty=true` и smoke server проверяют лишь эту availability flag, не `/api/pty/open` + реальную команду.

**Windows воспроизведение:** `TETRA_WIN_SHELL` установить в имя несуществующего executable в изолированном сервере. Ожидаемый helper exit 6 с CreateProcessW error в stderr; API покажет только завершение, health может остаться `pty=true`. Helper напрямую даст больше диагностики, чем приложение.

**Последствия:** пользователю остается «код 6/127», server.log не объясняет причину, UI выбирает PTY вместо fallback. Заранее собранный exe не доказывает пригодность API, Windows policy или shell.

**Исправление:** bounded stderr capture с санитаризацией/логированием, structured spawn error/last failure, health отдельно `helperAvailable` и readiness/runtime status; smoke через authenticated HTTP PTY API и production shell. Не передавать секреты или полный бесконечный stderr клиенту.

## P3

### W14 — verbatim UNC превращается в относительный путь

**Файлы:** `src-tauri/src/server.rs:20–24,45–50`.

**Доказательство M:** точная строковая операция Rust `strip_prefix("\\\\?\\")` моделировалась на `\\?\UNC\nas\share\...`; результат `UNC\nas\share\...` не абсолютен (`path.win32.isAbsolute=false`). Rust не запускался. Обычный local `\\?\C:\...` после срезания остается правильным; дефект относится к UNC, а не ко всем Windows путям.

**Воспроизведение:** `windows/probe.mjs`; Windows — запуск portable/dev размещения с UNC resource_dir, если поддерживается выбранным способом доставки. Возможность NSIS установки на такой путь здесь не утверждается.

**Последствия:** script.exists false, fallback зависит от cwd, backend не найден/запущен из неправильной папки.

**Исправление:** сначала `\\?\UNC\` → `\\`, затем обычный `\\?\` local prefix; тест drive/UNC/кириллица/long path. Проверить, зачем вообще Node требуется удаление extended prefix для конкретной версии; срезание также теряет поддержку длинных путей.

### W15 — Windows error code 256 становится успешным 0

**Файлы:** `server/conpty-win.mjs:239–248`.

**Доказательство M:** `Environment.Exit((int)(code & 0xFF))` намеренно сохраняет только младший байт. Модель: 256 → 0; также теряется смысл HRESULT/NTSTATUS. На Windows exit status 32-битный, POSIX 8-bit convention здесь не обязателен. Windows runtime и транспорт Node exit event не проверялись.

**Воспроизведение:** helper с shell command `cmd.exe /d /c exit 256` в Windows VM и отдельно запуск той же команды без helper; сравнить raw exit. Проверить 1, 255, 256, типичный crash code.

**Последствия:** ошибка может выглядеть успехом, диагностика crash теряется. Большинство обычных shell exit кодов меньше 256, поэтому P3.

**Исправление:** сохранять 32-битный status через unchecked cast и нормализовать представление на JS стороне явно; добавить raw status в protocol/лог. Нельзя заявлять что `& 0xFF` необходимо для Node Windows.

### W16 — release dependencies не воспроизводимы

**Файлы:** `src-tauri/Cargo.toml:12–22`; `.github/workflows/release.yml:16–20,42`; `.github/workflows/ci.yml:31–33`; отсутствует `src-tauri/Cargo.lock` в предоставленной копии.

**Доказательство C:** cargo dependencies — плавающие majors (`"2"`, `"1"`), lockfile в копии нет, toolchain stable плавает, release actions закреплены тегами (`tauri-action@v0` и др.), не SHA. `rust-version=1.77` не является доказательством сборки всего графа на 1.77. Внешние action internals не загружались.

**Воспроизведение:** на двух датах/runner images собрать один SHA и сравнить Cargo.lock/resolved dependencies; проверить фактический MSRV отдельно. В текущей среде cargo нет, эксперимент не проводился.

**Последствия:** старый v-tag может собрать другой dependency graph/action behavior, подпись updater не исключает риск supply chain сборки.

**Исправление:** commit Cargo.lock приложения, locked cargo build/check, фиксированные SHA actions и Node version; обновлять их управляемо. Если lockfile отсутствует только в экспортированной копии, проверить настоящий репозиторий и снять эту часть finding.

## Windows гипотезы — НЕ подтвержденные дефекты

### H01 — сохранение exit status и quoting Windows exec wrapper

`server/tetra-server.mjs:742–751`. Хвост `& echo ...` и Node argument quoting требуют проверки на реальном cmd. **Не считаю доказанным, что echo всегда сбрасывает ERRORLEVEL:** поведение зависит от команды/способа вызова. Проверить `cmd /c exit 7`, nonexistent command, failing npm.cmd, multiline commands, quoted full executable path с пробелами, embedded quotes и `exit /b`. Сравнить API exit.code с прямым запуском; добавить batch-wrapper, который явно сохраняет статус. Также проверить stdin: `child.stdin` не закрывается/не используется, интерактивная программа в non-PTY может ожидать ввод до timeout — это ограничение режима, не новый доказанный Windows crash.

### H02 — MCP cmd /s /c quoting и percent expansion

`server/mcp.mjs:157–159,197–202`. Builder использует CRT-подобное удвоение quotes/`%%`, затем `windowsVerbatimArguments:true` и `/s /c`, без явной внешней пары quotes вокруг всего payload. Это не универсальный quoting контракт cmd. Проверить запуск `C:\Program Files\nodejs\node.exe`, `.cmd` shim, аргументы с `%PATH%`, `!`, кавычками, завершающим `\`, `&`. Harness должен печатать JSON argv и сравнивать byte-for-byte, без опасных injected commands. Исправление после подтверждения: direct spawn `.exe` с argv, отдельный тщательно тестированный wrapper для `.cmd/.bat`; не трактовать это как доказанное удаленное RCE — пользователь уже одобряет выполнение MCP config.

### H03 — production PowerShell 5.1, кириллица и readiness

`server/pty.mjs:10–12,94–101`; `server/conpty-win.mjs:205–208`; `scripts/smoke-win.mjs:37,99`. Реальный default shell — PowerShell, а smoke — cmd. `[Console]::Input/OutputEncoding` не задает PowerShell `$OutputEncoding` для pipeline в native programs; профили и PSReadLine загружаются, `ready` означает первый output byte, не готовность принять команду. Проверить cold/warm startup, PS profiles, PS7-inherited env, ввод русских путей/emoji, piping кириллицы в Node native stdin, resize, Ctrl+C, password input, alt-screen. Не объявлять ConPTY UTF-8 transport сломанным только по отсутствию `$OutputEncoding`: определить конкретный production scenario и bytes.

### H04 — совпадение hostTriple с реальным Node / target и bundle запуск

`scripts/prepare-sidecar.mjs:11–26`; `src-tauri/src/server.rs:45–57`; `.github/workflows/ci.yml:36`. Модель доказала, что имя берется из rust host без проверки Node architecture. Windows ARM64 с x64 Rust либо cross target может получить неверно названный бинарник; может работать через эмуляцию, поэтому не заявляется гарантированный startup failure. Проверить PE machine/current Node arch/tauri target, а также installed bundle **без системного Node**, из `Program Files`, с русским USERPROFILE и cwd вне проекта. CI cargo check не является установкой/запуском bundle; smoke запускает development server через системный Node, без `TF_SERVE=1`, а не Rust sidecar path.

## Дополнительные наблюдения, без нового blocker finding

- `STARTF_USESTDHANDLES=0x100` и null std handles уже присутствуют; правильность работы этого исправления требует native tests. `PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE` получает **сам HPCON** (`conpty-win.mjs:108`) — не объявляю эту строку ошибкой «нужен указатель на HPCON».
- Control protocol `\0TFRSZ ` смешан с raw terminal input (`conpty-win.mjs:139–189`). Одиночный NUL / partial marker удерживается до следующих bytes, пользовательский ввод с полным маркером становится resize и может обойти API dimension clamp. Это контракт/protocol limitation: лучше отдельный control channel или framing, особенно если ожидается прозрачная передача binary/control input. Не заявляется privilege escalation.
- `ClosePseudoConsole` выполняется при активном reader (`conpty-win.mjs:245–246`), то есть безусловный deadlock только по этой последовательности не доказан. Двухсекундный reader.Join, ignored Read/Write errors и output-drain после быстрого exit требуют стресс-теста в Windows.
- `tauri.conf.json:29` выключает CSP. Это уменьшает defense-in-depth, но сам по себе не доказывает exploit; project docs уже признают настройку. Предпочтительно изолировать preview webview/frame и включить policy главного окна. Capabilities не выдают generic shell plugin: запуск идет через custom Rust commands/backend, не надо приписывать nonexistent unrestricted shell permission.
- `tauri.updater.conf.json:5` содержит placeholder pubkey для локальной full build. Release заменяет его variable (`release.yml:34–38`) и передает private signing key action. Подписи/`latest.json` не проверены на реальных artifacts. Updater signing **не равно** Authenticode signing, отсутствие Windows certificate/SmartScreen — известное состояние, не новый ConPTY баг.
- Release сразу публикуется (`releaseDraft:false`); `tauri-action@v0` internals не проверены. Не утверждаю отсутствия latest.json только потому, что нет явного шага генерации — action может делать это по умолчанию.
- Одновременно несколько app instances могут конкурировать за port 3001 (`server.rs:69`, server default). Нет видимого single-instance coordination. Проверить два запуска: второе окно может подключиться к первому backend, а его выключение оставить второе offline. Не проводился нативный UI тест.
- Exit sessions сохраняются 60s и учитываются в cap 12 (`pty.mjs:152,192`). Это может временно запретить новый терминал после серии быстрых exits; не заявляется утечка навсегда.
- Encoding damage уже есть в диагностическом тексте `conpty-win.mjs:298` («не удалос��»), не только в runtime stdout. Исправить текст отдельно, но это косметика.
- `extras.rs` tray/shortcut/autostart просмотрены; очевидной гарантированной Rust compile error по статическому чтению не найдено. Это **не** cargo check. Тестировать tray-on-close persistence, quit, minimized autostart с включенным/выключенным tray и конфликт хоткея в реальной Windows.

## Минимальный Windows acceptance план перед выпуском

1. Исправленный smoke: default PowerShell + отдельный cmd, distinguish input echo from execution, реальный resize, кириллица, Ctrl+C, expected exit; cold helper build и warm cache.
2. Installed signed bundle в чистой Windows 10/11 VM без Node/Python; русские имена, пробелы, cwd вне проекта; sidecar version/hash и нужные resources.
3. PTY/exec/MCP process trees для normal exit, tray quit, restart, timeout/cancel, update success/failure; никаких survivors кроме явно внешних windows/editors.
4. UTF-8 chunk splits + OEM output; cwd и exit status non-PTY; MCP argv fidelity на Program Files/.cmd/percent/quotes.
5. Upgrade N→N+1 по реальным signed artifacts; неправильная signature должна отвергаться, install failure должен вернуть backend, latest.json version/URL/signature должны соответствовать artifact и target. Не использовать production ключи в test harness.
6. Release gate на том же SHA: unit tests, corrected Windows smoke, cargo locked check/build, installed bundle smoke; публиковать после проверки.
