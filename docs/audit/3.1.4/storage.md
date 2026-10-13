# TetraFree — восстановленный аудит хранения и синхронизации

> Архивирование аудита: стенд был сброшен после паузы пользователя. Этот текст восстановлен из журнала сессии; ссылки на первоначальные локальные harness/log-файлы — описание методики, а не обещание их наличия в репозитории. Полный check/build и UI-репродукции повторены после восстановления. Windows, реальные OAuth/SMTP/model providers и browser-IDB failure integration не проверены.

Исходный аудит: 2026-10-13, `/data/tetrafree`, package.json 3.1.4, PERSIST_VERSION 7.

**Статус восстановления:** отчёт восстановлен из сохранённого контекста сессии после перезапуска песочницы. Повторный аудит, чтение текущих исходников и повторный запуск тестов не выполнялись. Номера строк относятся к исходникам, прочитанным во время первоначального аудита, а не к вновь проверенной копии. Исходные harness, логи и SHA256-файл исчезли вместе с папкой и здесь не выдаются за существующие артефакты. Ни код проекта, ни его настройки не изменялись; push не выполнялся.

## Краткий вывод и исторические результаты проверок

Подтверждено **18 сценариев дефектов/опасного поведения: 12 P1, 5 P2, 1 P3**. Наиболее важны: неавторитетный fallback после ошибки IndexedDB; потеря локальной правки при внешнем удалении; несогласованный durable-state/cloud-baseline; усечение истории чатов; небезопасная конфликтная копия; сохранение cloud-идентичности при дублировании проекта.

- P1 — потеря/порча пользовательских данных либо блокировка синхронизации, исправлять прежде дальнейшего расширения хранения.
- P2 — условный/узкий сценарий, нарушение жизненного цикла или функциональности.
- P3 — фоновая работа/производительность.
- P0 не установлен. Частота дефектов на Windows не измерялась.

**Во время первоначального аудита:** существующие тесты `persistence.test.ts`, `snapshots.test.ts`, `docplan.test.ts`, `merge3.test.ts`, `vaultState.test.ts` — **38/38 passed**. Изолированный `storage-repros.mts` — **18/18 подтверждённых сценариев**. Его assertions специально проверяли наличие опасного поведения: зелёный результат не означал корректность продукта. Последний вывод: `{"confirmed":18,"failed":0}`; idle-vault: `vault idle provider updates: 3`.

## Методика первоначального аудита

Прочитаны реальные `src/store/{idb,persistence,index,defaults,helpers,snapshots}.ts`, действия `slices/{projects,files,docs,chats,memory,tasks,settings,ui}.ts`; `src/lib/{sync,docsync,docplan,merge3,vault,vaultState,account,token,team,backend,backup,projectIO,docmd,mdimport,paths}.ts`; запуск в `src/main.tsx`, связанные UI-вызовы переименования/разрешения конфликтов, контракты `/api/fs/{hashes,read,batch}` и секретов на сервере. «Cloud» фактически реализован в `src/lib/team.ts`.

Harness импортировал реальные модули, настоящий Zustand/immer/persist, `reconcile`, `cloudNow`, `api`, действия стора, `planDocs`, `merge3`, `startVault`. Подменены только окружение: localStorage, минимальная асинхронная транзакционная модель IndexedDB и fetch. HTTP-ответы контролировались; настоящие токены/секреты и внешняя сеть не использовались. Gate ставил мутацию строго между чтением и применением ответа. Время обычных сценариев — миллисекунды; vault idle — 1650 мс. `process.exit` завершал тестовые таймеры.

Исторические команды (harness сейчас не восстановлен):

```bash
cd /data/tetrafree
./node_modules/.bin/tsx --test src/store/persistence.test.ts src/store/snapshots.test.ts src/lib/docplan.test.ts src/lib/merge3.test.ts src/lib/vaultState.test.ts
./node_modules/.bin/tsx /data/audit-tetrafree/storage-repros.mts
```

## Доказанные результаты

### S01 — P1: новые данные fallback проигрывают старым данным IndexedDB

**Места:** `src/store/persistence.ts:75–98,117–130`; особенно `122–124` и `79–88`.

**Root cause:** read всегда предпочитает любой валидный IDB snapshot; failed put не переключает авторитет на localStorage. Нет revision/timestamp/указателя актуального backend. Очистка fallback зависит от одноразового `migrated`.

**Воспроизведение:** IDB содержит OLD. Первое getItem устанавливает migrated=true. Ошибка следующего put отправляет NEW в localStorage. Новый экземпляр idbStorage.getItem возвращает OLD, хотя LS содержит NEW. После успешной записи RECOVERED старый LS fallback NEW также остаётся, поскольку очистка выполняется только при !migrated. S01 проверял обе копии и результат чтения.

**Последствие:** после перезапуска последние изменения исчезают; следующая запись способна затереть NEW. При будущей недоступности IDB возможен возврат ещё более старого fallback.

**Рекомендация:** монотонная ревизия и авторитетный указатель; при деградации отмечать LS как актуальный, выбирать свежую завершённую ревизию. Убирать fallback после каждой подтверждённой более новой durable-записи, не только первой миграции.

### S02 — P2: removeItem не упорядочен с уже поставленным flush

**Места:** `src/store/persistence.ts:100–107,136–139`.

**Root cause:** remove очищает только pending, но не уже извлечённый p в flushing; delete выполняется вне write promise-chain.

**Воспроизведение:** setItem(key,value) → pagehide ставит write в очередь → немедленный await removeItem(key) → дождаться write. В транзакционной модели key снова существует: delete опережает put.

**Последствие:** очистка persistence может воскресить удалённое состояние. Обычный resetData выполняет set, не remove; непосредственный пользовательский путь к этому remove не установлен, поэтому P2.

**Рекомендация:** единая очередь delete/write, generation/tombstone для инвалидирования старых writes и отмена таймера.

### S03 — P1: downgrade/неподдерживаемая версия сбрасывает данные

**Места:** `src/store/persistence.ts:215–221`; `src/store/index.ts:49–52`; тест сброса: `src/store/persistence.test.ts:200–205`.

**Root cause:** migrate для from>6 либо from<4 возвращает initialPersisted вместо отказа от записи/режима recovery.

**Воспроизведение:** migrate({projects:[проект с несохранённым файлом]},8) возвращает projects=[]. При открытии новой схемы старой сборкой persist впоследствии может сохранить пустое состояние поверх исходного. Это намеренное действующее правило, но оно противоречит инварианту сохранности данных.

**Рекомендация:** unsupported-version → read-only/error, не reset. Сохранить оригинальный raw snapshot в recovery-key до преобразования; предложить обновление/экспорт. Поддерживаемые старые версии мигрировать явно.

### S04 — P1: persisted chat.running блокирует исходящий cloud после reload

**Места:** `src/store/persistence.ts:145–165,178–181,199–206`; `src/lib/team.ts:376,597–602`.

**Root cause:** stripVolatile снимает streaming у сообщения, но partialize/merge сохраняют chat.running. hasRunning верит persisted bool без живого runtime turn.

**Воспроизведение:** partialize → JSON round-trip → merge проекта с chat.running=true и streaming agent-message. Сообщение становится streaming=false, chat остаётся running. После установления cloud-base изменить файл и вызвать cloudNow: PUT отсутствует.

**Последствие:** файлы и метаданные всего проекта не отправляются, пока другой action не снимет зависший running; cloud-чтение при этом возможно.

**Рекомендация:** на hydration сбрасывать process-local chat.running и остальные runtime-состояния по отдельной политике. Проверять наличие реального активного turn.

### S05 — P1: поздняя гидратация заменяет уже сделанные изменения

**Места:** `src/main.tsx:24–41`; `src/store/persistence.ts:117–130,199–206`.

**Root cause:** через 10 секунд main запускает write-capable UI/подсистемы без отмены pending hydration; merge распространяет persisted поверх изменённого current.

**Воспроизведение:** durable OLD; начать persist.rehydrate и задержать IDB read; выполнить настоящий writeFile('x','NEW'); завершить OLD read. В сторе снова OLD.

**Граница доказательства:** rehydrate — минимальная управляемая модель незавершённой первоначальной hydration. Реальные 10 секунд ожидания не выполнялись; достижимость ранних мутаций после timeout установлена чтением main.tsx.

**Рекомендация:** timeout должен показывать безопасный recovery UI, а не запускать запись. Либо буфер операций/generation и явный reconcile поздней hydration вместо overwrite.

### S06 — P1: «только внешние удаления» теряют локальную правку во время запроса

**Места:** `src/lib/sync.ts:92–107,142–187,224–249`.

**Root cause:** untouched-проверка dropLocal находится только внутри pull.length>0; ветка drop-only применяет план от старого proj.files без проверки актуального content.

**Воспроизведение:** base/store {a:'old',b:'unchanged'}. Начать reconcile, задержать /hashes; в сторе изменить a на NEW; ответ диска содержит только b. Ветка dropLocal без pull удаляет a. Итог files.a===undefined; NEW нет и в созданном snapshot.

**Рекомендация:** expected hash/content перед каждым drop независимо от наличия pulls; при изменении сохранить прежний base и запланировать повтор. Простое перечитывание проекта после await без полного пересчёта плана недостаточно.

### S07 — P1: конфликт с диском уничтожает незакоммиченную чужую версию

**Места:** `src/lib/sync.ts:186–197,204–205,283–292`; `server/tetra-server.mjs:639–652`.

**Root cause:** policy «store wins» отправляет batch-write без read/recovery-copy исходного дискового текста и без expected-hash CAS. Toast обещает Git/историю, хотя старая версия туда не помещалась.

**Воспроизведение:** base='base', store='mine', disk='their-uncommitted'. reconcile перезаписывает disk на mine; не запрашивает прежний текст; versions не содержат their-uncommitted. Произвольные незакоммиченные working-tree данные не гарантированы Git.

**Рекомендация:** до overwrite read + durable conflict copy/версия либо явный выбор. Серверный batch должен проверять expected hash; commit после write не восстанавливает старый working tree.

### S08 — P1: cloud refresh удаляет локальный префикс истории чата

**Места:** `src/lib/team.ts:114–122,439–444,548–553`.

**Root cause:** exportMeta ограничивает messages до последних 80; base.meta описывает усечённый wire-window. unchanged=true разрешает applyMeta полностью заменить локальные chats этим окном.

**Воспроизведение:** локально 100 сообщений. PUT отправляет 80. Другой участник меняет только desc и возвращает тот же 80-message чат. После cloudNow локально остаётся 80, первый ID m20; m0..m19 потеряны.

**Рекомендация:** ограниченное окно не считать полным снимком. Сливать messages по ID и сохранять локальный префикс даже при unchanged; удаление только явными операциями/tombstones. Серверу нужны pagination/cursor.

### S09 — P1: преобразование actor-ID портит произвольный пользовательский текст

**Места:** `src/lib/team.ts:89–91,125–142,549`.

**Root cause:** toWire/fromWire — глобальный JSON reviver по значению строки, а не по типизированному ID-полю.

**Воспроизведение:** doc.title='me', paragraph.text='me'. Реальное тело PUT содержит account uid вместо обоих значений. У другого участника строка остаётся uid автора. fromWire также меняет любой текст, равный текущему uid, на me.

**Рекомендация:** schema-aware преобразование только creator/author/assignee и других настоящих user-ID fields; не изменять текстовые значения по совпадению.

### S10 — P1: duplicate/import сохраняют cloud identity оригинала

**Места:** `src/store/slices/projects.ts:145–159,166–177`; `src/lib/projectIO.ts:31–39,49–55`; `src/lib/team.ts:41–61,486–488,617–624,806–807`.

**Root cause:** deep clone/spread сохраняет cloud.pid при новом local id/name/path; base/txt ключи также привязаны к общему cloud.pid.

**Воспроизведение:** duplicateProject облачного проекта. Копия имеет прежний cloud.pid. После установления baseline правка копии x='clone-edit-2' отправляется PUT в серверный проект оригинала. В тесте первая правка без сохранённой базы не отправлялась, поскольку tickOnce принимал current за common baseline; следующая уже перезаписала remote. Это не делает копию независимой.

**Дополнение:** ZIP export/import сохраняет cloud через spread; этот путь установлен чтением кода, не отдельным ZIP-e2e.

**Рекомендация:** по умолчанию очищать cloud при duplicate/import, как в backup-import; новый team-project создавать явно. Если общие views намеренны — один coordinator либо запрет нескольких writable local копий одного cloud.pid.

### S11 — P1: memory edit/chat rename теряются из-за неизменяемого stamp

**Места:** `src/store/slices/memory.ts:24–30`; `src/store/slices/chats.ts:91–95,119–128`; `src/lib/team.ts:384–389,437–438,449–464`.

**Root cause:** mergeSet выбирает только строго больший stamp. Память сравнивается по времени создания at, чат по lastAt последнего сообщения; editMemory/renameChat не обновляют эти поля.

**Воспроизведение:** общая база memory.at=10/chat.lastAt=10. Удалённо поменять memory.text/chat.title с тем же stamp (так работают actions). Локально изменить мету, чтобы включилась mergeSet-ветка. Remote memory проигрывает local, remote rename исчезает. Подтверждено также сохранение memory.at=10 после локального editMemory.

**Рекомендация:** updatedAt/revision на каждую мутацию; three-way merge меты с общим ancestor и сохранением конфликтов. Одного wall-clock LWW недостаточно даже после исправления stamp.

### S12 — P2: image-block превращает живой doc в «удалённый» Markdown

**Места:** `src/lib/docplan.ts:68–69,132–139`; `src/lib/docsync.ts:36–37`.

**Root cause:** live-ID вычисляется из docs, уже отфильтрованных по отсутствию image, а не из allDocs.

**Воспроизведение:** обычный doc зеркалируется в docs/A.md; добавить image в тот же doc; следующий plan содержит docs/A.md в remove. Документ остался живым. docsync удаляет файл напрямую без корзины, далее sync может удалить его с диска.

**Граница:** отдельно не измерялась потеря front matter/непредставимого Markdown импортированного файла; доказан сам неожиданный remove.

**Рекомендация:** live-ID по allDocs; при отключении mirror сохранить файл/базу и отметить disabled. Удалять файл только при настоящем удалении doc с recovery.

### S13 — P2: CRLF-маркеры обнаруживаются, но resolve не работает

**Места:** `src/lib/merge3.ts:105–106,125–130`; `src/workspace/RightPane.tsx:928–939`.

**Root cause:** regex resolver требует буквально =======\n; Windows CRLF содержит =======\r\n.

**Воспроизведение:** получить conflict от merge3 и преобразовать result LF→CRLF. hasMarkers=true, resolveMarkers(text,'ours') возвращает исходный текст с маркерами. Причина также применима к theirs/both.

**Рекомендация:** line parser с LF/CRLF и сохранением выбранного EOL либо normalize→resolve→restore. Тесты CRLF/mixed-EOL и assert реального удаления маркеров после UI-action. Обычный CRLF merge3 без преобразования marker-lines отдельно не проверялся.

### S14 — P1: cloud baseline durable раньше самого Zustand state

**Места:** `src/store/persistence.ts:100–107,132–134`; `src/lib/team.ts:41–55,491–502,623–634`; аналогичный split: `src/lib/sync.ts:251–252`, `src/lib/docsync.ts:72–73`.

**Root cause:** state отложен на 500 мс в IDB, а common base/rev и ancestor записываются отдельно в localStorage без общего атомарного checkpoint.

**Воспроизведение:** durable local OLD, remote OLD rev1. Изменить local на NEW и выполнить cloudNow до flush. Remote уже NEW rev2, LS base уже rev2, IDB всё ещё OLD. Реконструировать store из единственного committed IDB snapshot, оставив durable base. GET since=2 отвечает same; следующий PUT отправляет OLD с правильной baseRev, remote становится rev3/OLD.

**Доказательство:** проверялись обе durable-копии до реконструкции и реальные последующие cloudNow/PUT. ОС не убивалась: смоделировано состояние crash-before-commit, не частота crash.

**Рекомендация:** атомарная IDB-транзакция state+bases+ancestors на одну generation либо recovery journal/outbox. Не продвигать baseline до durable checkpoint; incomplete recovery требует полного remote fetch, а не трактовки старого local как сознательного edit.

### S15 — P2: stale 401 старой сессии уничтожает новую

**Места:** `src/lib/account.ts:76–86,93–99,109–117`.

**Root cause:** ответ запроса не привязан к captured token/session epoch; api смотрит на текущий getToken и вызывает expireSession.

**Воспроизведение:** отправить /api/invites с OLD-SESSION, задержать ответ. Установить NEW-SESSION/user и signIn. Старый ответ завершить статусом 401. Итог: новый token=null, user=null, authed=false.

**Рекомендация:** capture epoch/token/base на send; применять ошибки/результаты только при совпадении epoch. Abort pending requests на logout/login; защищать и успешные verifySession-ответы.

### S16 — P2: vault acknowledgement не привязан к backend

**Места:** `src/lib/vault.ts:11,20–27,39–46,95–118`; `src/lib/vaultState.ts:6–13`; backend URL: `src/lib/backend.ts:44–46`.

**Root cause:** ready и synced map глобальны; смена backend не сбрасывает их. stripSecrets считает подтверждение с A достаточным для B.

**Воспроизведение:** startVault получает тестовый key от A, isVaulted=true. Сменить base на B: нового GET /secrets нет; isVaulted всё ещё true; partialize сохраняет apiKey=''. У B не выполнялась реальная сеть — доказаны отсутствие повторной проверки и stripping, не DPAPI B.

**Последствие:** после reload на B без этого key persistent локальная копия уже пуста. Ключ пока есть в памяти и на A; уничтожение всех копий не заявляется.

**Рекомендация:** acknowledgement/ready scoped к backend identity/vault generation и контексту доступа. При смене backend хранить durable fallback до нового подтверждения, reset/reinit vault.

### S17 — P3: vault push бесконечно вызывает сам себя

**Места:** `src/lib/vault.ts:80–83,110–116`; `src/store/persistence.ts:132–134`.

**Root cause:** push безусловно создаёт новый providers array; subscriber замечает новую ссылку и через 500 мс снова вызывает push.

**Воспроизведение:** после успешного startVault не выполнять действий 1650 мс; получено 3 новых provider-array updates. При неизменных ключах POST не нужен: это бесконечная локальная работа, не обязательный бесконечный HTTP-stream.

**Последствие:** partialize/перезапись всего persistent state около двух раз в секунду в idle.

**Рекомендация:** не менять store при отсутствии семантического изменения/ack change; semantic key-set comparison или origin-маркер собственных flush. Idle regression test должен ожидать отсутствие updates после стабилизации.

### S18 — P1: конфликтная .cloud-копия затирает существующий файл

**Места:** `src/lib/team.ts:528–543`, особенно `541`.

**Root cause:** fallback присваивает p.files[k+'.cloud']=remoteFiles[k] без выбора свободного имени/recovery существующего target.

**Воспроизведение:** base x='base', local x='mine', remote x='theirs'; x.cloud='precious existing file' неизменен с обеих сторон. Ancestor text отсутствует. cloudNow перезаписывает x.cloud на theirs. Затем обработка ключа x.cloud видит rh===b и оставляет испорченный local. Precious нет и в versions.

**Граница:** проверен fallback без ancestor, не лимит огромного merge.

**Рекомендация:** свободный путь с учётом Windows case-insensitivity, durable recovery обеих конфликтующих версий. До overwrite/remove snapshot/корзина. Тесты repeated conflicts, пользовательского .cloud и разных порядков keys.

## Гипотезы и дополнительные риски — не входят в 18 подтверждённых

1. **Несколько окон/вкладок:** весь state под одним tetrafree; нет cross-window CAS/lock/BroadcastChannel. Возможен last-writer-wins для независимых проектов. Двухоконный e2e не выполнен.
2. **IDB handle:** `src/store/idb.ts:7–29` кеширует failed open/закрытый handle навсегда; onversionchange закрывает db без сброса opening. Может усилить S01. Реальное upgrade/versionchange не воспроизведено.
3. **Повреждённая текущая схема:** merge/migrate/unpackVersions без полноценной runtime shape validation; hydration error + timeout может открыть пустой runtime и затереть частично восстанавливаемую базу. Fuzz не выполнен.
4. **Смена path во время reconcile:** stale proj после await используется для batch; удаление/смена папки, forgetBase против busy-прохода требуют реальных two-folder tests.
5. **Hashes→read/write TOCTOU:** read не возвращает привязанной revision/hash, next использует прежний scan; batch без expected-hash CAS. S07 доказывает конфликтную перезапись, отдельный real-fs TOCTOU не тестировался.
6. **Failed mkdir/rmdir:** saveDirs сохраняет emptyNow даже после failed mkdir; badPaths подавляет retry той же версии после временного EPERM. Recovery прав доступа без content edit отдельно не проверялся.
7. **Meta LWW:** docs/tasks целиком выбираются по timestamp; равный Date.now/clock skew могут потерять версии. S11 доказывает более узкий дефект неизменённых stamps. Сложный LCS/property-based merge3 не проверялся.
8. **First-run doc import limit:** planDocs ограничивает orphan-files только в firstRun; docsync сохраняет {} после отказа, следующий init=false может импортировать всё. Реальный второй UI-trigger/нагрузка отдельно не измерялись.
9. **Account boundaries:** global store/проекты/ключи остаются после signOut; server vault общий для OS-user. Нужно сверить обещанный продуктовый контракт изоляции аккаунтов; сохранённый локальный проект сам по себе не доказывает нарушение.
10. **Stale successful auth replies:** verifySession/profile/preview не защищены epoch. S15 доказал stale 401, не старый успешный profile или все cross-tab гонки.
11. **Unload:** async flush из beforeunload/pagehide не гарантирует commit при уничтожении WebView. S14 — алгоритмический persisted split, не Windows lifecycle e2e. Требуется awaited desktop close checkpoint.
12. **Rename stale UI:** renameFile/renamePath сами не защищают target; UI checkPath может устареть до run. Direct action без настоящей UI-гонки не считался подтверждённым пользовательским сценарием.

## Ограничения и исчезнувшие артефакты

- Нет Windows/Tauri/WebView2/DPAPI, реального закрытия окна/аварии питания, двух настоящих участников либо живого облачного сервера.
- IDB fault/order — минимальная асинхронная транзакционная модель; бизнес-логика оригинальная. Browser-IDB эксперимент начат, но не завершён: Playwright package не был доступен обычному Node resolution; Chromium CLI завис без dump-dom и был остановлен. **Настоящий browser-IDB результат никогда не заявлялся подтверждённым.**
- S05 использовал rehydrate для управляемой задержки; S14 реконструировал store из committed snapshot. Это алгоритмические тесты порядка операций, не Windows crash-e2e.
- Полный npm check/build/autofix этим аудитором не запускался. Проверялись только 38 существующих тестов области и изолированный harness.
- Нет production quota exhaustion, destructive real fs, live SMTP/OAuth, больших пользовательских баз, load-test, сравнения merge3 с git merge-file.
- Первоначально существовали `storage-repros.mts`, `storage-repros.log`, `storage-existing-tests.log`, `storage-source-hashes.txt` и незавершённые `storage-browser-*`. Они исчезли при перезапуске. Этот файл восстанавливает выводы и сценарии, **не точные байты harness/logs/SHA256**.
- При восстановлении создан только отчёт; никаких команд изменения проекта, установки пакетов, форматирования, git commit/push или повторного аудита.

## Рекомендуемый порядок исправлений/regression tests

1. Durable checkpoint state+bases+ancestors, recovery ошибок/версий/поздней hydration: S01/S03/S05/S14.
2. Compare-before-apply в sync и уникальная durable conflict copy: S06/S07/S18.
3. Безопасный cloud-meta merge и независимость duplicate/import: S08/S09/S10/S11.
4. Очистка process-local running при hydration: S04.
5. Ordered delete, image mirror, CRLF, session epoch, vault identity/idle loop: S02/S12/S13/S15/S16/S17.

На каждое исправление — regression test, утверждающий противоположный безопасный результат указанной репродукции. Отдельно нужны реальный IndexedDB integration и два WebView/два клиента против сервера.
