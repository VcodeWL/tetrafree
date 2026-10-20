# TetraFree 3.1.5 — защитный ремонт и повторный аудит

Начало аудита: 2026-10-15. Восстановление после отката среды и повторная проверка: 2026-10-20. Это отчёт о коде и выполненных проверках, **не сертификат отсутствия багов и не приёмка Windows-релиза**.

## Что сделано

Работа разделена между 7 авторами исправлений и 4 независимыми аудиторами; для второй волны процессных исправлений подключён ещё один автор — **12 отдельных субагентов**. Главный агент интегрировал API/types, preview, busy-dialog/checkpoint gates, зависимости, тесты, документацию и релиз.

Первая волна опиралась на [77 исторических наблюдений](../3.1.4/inventory.json). Это не 77 независимо воспроизведённых production-багов: в реестре есть общие root causes и статические findings. Вторая независимая волна нашла дополнительные дефекты в исправленном коде; для них добавлены отдельные desired-safety regressions. Зелёные characterization-тесты старого плохого поведения не засчитаны как подтверждение fixes.

### Основные изменения

- Редакторы и отложенные операции адресуются исходным pid/path; удалённое поколение не воскресает, pending ввод сохраняется в recovery. Файловые диалоги и Design history проверяют свежий preimage/CAS, а version batch сохраняет владельца.
- Поиск и замена исполняются в отменяемом module Worker с бюджетом времени, без синхронного regex fallback в UI.
- IndexedDB/revisioned fallback дожидаются безопасной hydration; неподдерживаемый снимок не сбрасывается. `flushPersistence()` подтверждает текущий checkpoint, а не старый debounce snapshot.
- Копии и все импорты сбрасывают cloud/path/mirror/runtime/авторазрешения. Undo документов, чатов и памяти не переезжает в другой проект.
- Agent CAS привязан к источнику вычисления; Stop блокирует последующий dispatch/late application. Markdown fences, включая контейнеры, не исполняются как примеры протокола. Инфраструктурные ошибки фоновых автоматизаций контролируются.
- Disk/cloud сохраняют конфликтные версии и acknowledged/dirty state вместо безусловного LWW; директории входят в облачную сверку. Конкретные journal/restart сценарии и границы описаны отдельно.
- Preview использует отдельный loopback origin, session/project capability и opaque sandbox; старый app-origin route возвращает 410. Сессионного токена в preview URL нет. Исторический HTML также изолирован.
- Сервер проверяет конечные файловые пути, обязательный SMTP TLS, pending credentials, MFA/step-up/epochs и shown-hash MCP approval. Непредвиденные ошибки возвращаются безопасно. Process ownership/backpressure/таймауты имеют конечные лимиты и честный статус неподтверждённого tree stop.
- Windows-shell получает Job/lifecycle и более строгие smoke assertions; release зависит от CI того же SHA, lock-файла и создаёт draft. Подписи/установленный bundle требуют настоящей приёмки.
- Vite и связанный build toolchain обновлены; `npm audit` не обнаружил известных уязвимостей на момент проверки. Это не доказательство полной безопасности зависимостей.

## Статус проверок

Окончательные команды и числа записаны в `validation.txt` рядом. Авторские scoped результаты не суммируются с независимыми повторами в якобы уникальное число проверок.

- `npm run check` на Node 22.23.3: **654/654 PASS** (147 server + 507 client), TypeScript/ESLint/Prettier — чисто.
- Независимая agent/sync приёмка после восстановления: **25/25 desired + 172/172 scoped regressions**; после финального форматирования ещё один **25/25 desired PASS**. Повторы не прибавляются к 654 как уникальные tests.
- `npm run build`: PASS, web-production build; **не Windows installer build**. Остаётся предупреждение Vite о chunk >500 kB.
- Browser regression: **8/8 PASS**, isolated test account/data, реальный Chromium; UI/editor/worker/preview/IDB reload. Реальный Vite HMR — **PASS**, без собранных ошибок React root/page. Отдельно от synthetic fixtures.
- Случайный UI-прогон: seed 31577, 120 секунд, **259 действий, 0 собранных ошибок**, без белого экрана; это один ограниченный прогон.
- Rust: 3 std-only unit tests повторно выполнены после восстановления; Windows Job module cross-target typecheck выполнен. Полный Tauri cross-check остановился на отсутствующем MSVC `lib.exe`; native Windows smoke на Linux — SKIP, не PASS.
- GitHub CI этого нового commit, установленная Windows-сборка и signed update не запускались из песочницы. Черновик не следует публиковать до их приёмки.

В ходе работы среда откатилась к промежуточному снимку. Поздние fixes восстановлены из точных patches истории, после чего проверки запущены заново. Исторические зелёные логи не подменяют новый gate; подробности — в `*-restoration.md` и `acceptance-agent.md`.

## Честные ограничения

1. **Не все возможные баги найдены.** Проверки синтетических отказов, browser и code review не равнозначны формальной проверке/реальной эксплуатации Windows.
2. Нет native atomic compare-and-write против произвольного внешнего редактора, общей физической транзакции app state + journal + disk/cloud, cross-window CAS или гарантии fsync при отключении питания. FNV — concurrency checksum текста, не криптографическая/byte-exact защита.
3. App-origin preview убрано, но проектный код остаётся недоверенным и может обращаться к разрешённым внешним HTTPS ресурсам. Local storage/SW недоступны; absolute-root `/assets` требует относительной base-конфигурации. Custom Git config/includes/helpers/hooks/LFS/submodules/worktrees ограничены защитным профилем, не silently trusted.
4. Windows per-operation native Job proof не реализован. Завершение root не доказывает завершение descendants. Живые failed-stop остаются owned; closed-root obligations хранятся конечной сводкой, без опасного повторного kill переиспользованного PID. Desktop global Job — граница app shutdown; standalone Node не получает эквивалентной гарантии.
5. Внешние редакторы/терминалы, запущенные через backend, тоже могут входить в его global Job и закрыться вместе с приложением. Требуется native UX acceptance; silent breakaway не включён.
6. Явная кнопка закрытия и установка обновления ждут checkpoint. Native/tray/OS exit и аварийное завершение не имеют полного UI↔Rust checkpoint-ack протокола; unload остаётся best effort.
7. Cloud transport сохраняет существующий локальный префикс, но новый участник пока получает только серверное окно из 80 сообщений; полной архивации/pagination нет. Metadata merge не CRDT, конфликтные копии требуют решения человеком.
8. Автопроверка отдельных JS/Python filenames через shell отключена: доступны фиксированные npm scripts. `danger.ts` — эвристика подтверждения, не OS sandbox. In-flight MCP/web эффект не отзывается одним UI Stop.
9. Vault delete/replacement проверены внутри текущей сессии, включая ABA. Durable remote-delete outbox через crash/reload остаётся отдельной задачей; реальные DPAPI, quota, SMTP, OAuth и MCP не сертифицированы этими mock tests.
10. Updater signing/установщик/SmartScreen/sidecar без системного Node/UNC/ConPTY/tray/hotkey должны быть проверены на Windows 10/11. Web build и cross-target typecheck этого не заменяют.

## Навигация по evidence

- `*-fixes.md`, `*-second-fixes.md`: авторские изменения, tests и ограничения по слоям.
- `reaudit-*.md`: исторические независимые findings **до** второй волны fixes. Их заголовок «открыто» относится к тому снимку, а не автоматически к финальному коду.
- `acceptance-*.md`: последующая независимая приёмка desired assertions. Проверяйте время/хэши; исходный characterization-report не переписывается в видимость «всегда было зелёным».
- `validation.txt`, `browser-results.json`, `source-manifest.json`: итог интеграции главным агентом.

Сырые токены/capability URLs, реальные пользовательские данные, exploit payloads и машинные снимки private storage в репозиторий не добавлялись. Test fixtures — только синтетические данные.
