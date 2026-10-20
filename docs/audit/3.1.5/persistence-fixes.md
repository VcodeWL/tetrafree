# Persistence / account / vault — итог

Прочитаны **весь** корневой `AGENTS.md` до правок, `docs/audit/3.1.4/storage.md` и актуальный `/data/fix-tetrafree/contracts.md`. Вложенных AGENTS вне node_modules не найдено.

## Fixed IDs

- **ST01 / S01**: revision в persisted envelope, выбор новейшей IDB/LS копии после crash. Cleanup LS после каждой успешной IDB-записи. Маленький `tetrafree:authority` journal инвалидирует старый LS authority **перед** более новой IDB-записью. Если IDB нельзя прочитать, LS допустим только при подтверждении backend=ls и совпадающей revision; неоднозначность → recovery, не старый state. Legacy snapshots без revision/journal читаются при доступном IDB.
- **ST02 / S02**: put/delete в одной очереди. Pending/timer отменяются; revision guard не даёт failed in-flight put восстановить pending после более новой мутации/delete. Degraded delete сохраняет revisioned tombstone.
- **ST03 / S03**: migrate неизвестных старых/будущих схем **throws**, не reset. Raw unsupported/corrupt IDB/LS не перезаписывается. Recovery UI реально экспортирует исходные байты и позволяет повторную загрузку; нет writable пустого приложения. Добавлена базовая runtime shape validation, не полный validator всей доменной схемы.
- **ST04 / S04**: partialize и merge сбрасывают chat.running; hydration завершает persisted streaming, сохраняя текст.
- **ST05 / S05**: skipHydration + explicit `hydrateStore()`. App и фоновые писатели стартуют только после успешной hydration. Через 10 секунд — безопасный recovery/ожидание, без разрешения записи; поздняя hydration уже не может перезатереть пользовательские правки, т.к. до неё редактирование не запускалось. Recovery имеет объяснение совместимости версии, экспорт raw (с предупреждением о секретах) и reload.
- **ST12 / S12**: live-ID по allDocs. Image-disabled doc продолжает владеть mirror path и сохраняет ancestor: нет delete, overwrite или orphan reimport. Настоящие удаления зеркала docsync предварительно сохраняет в trash.
- **ST13 / S13**: resolver принимает LF/CRLF/mixed marker lines, сохраняет выбранные content/EOL байты. Проверены ours/theirs/both и реальное удаление маркеров; неполные конфликты не меняются.
- **ST14 / S14 (моя часть)**: `flushPersistence(): Promise<void>` экспортирован из persistence.ts. Заново сериализует **текущий** Zustand state и ждёт committed IDB transaction либо проверенную durable LS-запись. Reject до успешной hydration или при невозможности записи. Swallowed write не считается checkpoint. docsync сериализован по pid и **await** barrier перед base; ошибка не продвигает ancestor. sync/team await и generation checks интегрирует другой агент; эти файлы я не редактировал.
- **ST15 / S15**: captured epoch/token/base на send. Stale 401 и successful replies отклоняются до effects; verify/config/invites/profile/preview защищены. Logout инвалидирует локальную сессию немедленно: медленный ответ logout не стирает новый login. API login results имеют WeakMap-привязку контекста для applySession.
- **ST16 / S16**: acknowledgement scoped к backend **и token/access context**. Смена scope отзывает ack, сохраняет fallback текущих ключей и запускает новый GET /secrets. Поздние ответы старого backend не применяются.
- **ST17 / S17**: acknowledgement сохраняется через checkpoint без synthetic providers-array mutation. Subscriber сравнивает semantic id/key set. Проверено: после стабилизации за 1650 мс idle нет provider updates, HTTP-запросов или persistence transactions.
- Дополнительно: failed IDB open / versionchange / close не кешируются навсегда. Поздний success заблокированного open закрывается; InvalidStateError сбрасывает handle для следующей попытки.

## API / handoff

```
import { flushPersistence } from '../store/persistence'
await flushPersistence() // BEFORE advancing baseline/revision/ancestor
```

Reject нельзя swallow с последующим сохранением baseline в catch/finally. Это barrier, **не** shared atomic transaction всех baselines; sync-владелец проверяет generation/state после await согласно contracts.md.

Старт/реальный store harness: `await hydrateStore()` из `src/store/index.ts`. Flush до этого rejects. main делает это сам.

Account public API:
- `captureSession(): SessionContext {epoch,token,base}`
- `sessionIsCurrent(context): boolean`
- `applySession(res, context?)`: api result автоматически проверяется по WeakMap. Если OAuth/MFA UI копирует/преобразует ответ или ведёт несколько запросов, можно захватить context в начале flow и явно передать его в applySession. Формы, endpoints и MFA/OAuth response shapes в этой области не менялись.

Короткий контракт также в `persistence-api.md`. Прямая MCP-доставка сообщения родителю ранее дала capability error; файлы доступны на общем компьютере.

## Tests

Новый файл для package.test: **src/store/persistence-durable.test.ts**. Записан в `persistence-test-files.txt` и добавлен без удаления чужих записей в общий `test-files.txt`. package/lock не трогал.

Изменены существующие тесты `src/store/persistence.test.ts`, `src/lib/docplan.test.ts`, `src/lib/merge3.test.ts`.

**53/53 passed**:

```
./node_modules/.bin/tsx --test src/store/persistence-durable.test.ts src/store/persistence.test.ts src/store/snapshots.test.ts src/lib/docplan.test.ts src/lib/merge3.test.ts src/lib/vaultState.test.ts
```

Итоговый лог: `persistence-tests.log`. Harness — контролируемая transactional in-memory IDB fault/order model + **настоящий** Zustand/immer/store/account/docsync/vault. Проверяет fallback crash reconstruction, put/delete race/tombstones, raw unsupported/corrupt preservation, pending hydration write block, failed durable retry/current checkpoint, doc ancestor barrier/trash, stale 401/success/login/logout, backend switching/stale vault response/idle. Внешняя сеть и настоящие секреты не использовались.

Scoped ESLint изменённых production/test файлов: `persistence-eslint.log` (пустой при успехе). Scoped TypeScript owned-root diagnostics: `persistence-types.log`; скрипт `check-persistence-types.cjs` обходит imports, но выдаёт только ошибки назначенных файлов, не общий tsc/check/build. Форматировались только мои файлы.

## Remaining / verification limits

- Windows/WebView2/DPAPI, настоящий browser IndexedDB, production quota, OS crash/закрытие окна, two-window не проверены. Transaction model **не** browser integration. Main timeout проверен структурой gate + controlled pending read, не реальным 10-second UI e2e.
- Async unload/pagehide не гарантирует commit при уничтожении процесса: desktop lifecycle должен отдельно await checkpoint. Rust не трогал.
- Межоконного CAS/lock нет. Revision монотонна в storage instance, не distributed revision.
- Если IDB недоступен, а LS authority неоднозначен/отсутствует (legacy/failed journal), намеренно открывается recovery вместо непроверенного fallback. Нужны восстановление IDB/экспорт, не reset.
- Полная runtime validation доменной схемы и атомарный state+all-sync-bases journal остаются вне scope. Этот barrier закрывает доказанный state-before-baseline split совместно с await/generation интеграцией sync-агента.
- Account OAuth/MFA UX/endpoints не изменял; API для главного указан выше. Преобразованные/не-api результаты должны явно использовать captured context.
- После сетевого отказа vault хранит fallback; retry init зависит от следующего store/backend события после cooldown, не обещается бесконечный фоновый retry.
- Git metadata отсутствует в текущей копии /data/tetrafree (git status: not a repository). Коммит/push не выполнялся. package/version/types/lock/changelog и чужие sync.ts/team.ts не редактировались.

## New audit observations / docs для parent

1. Revision comparison недостаточен при failed LS cleanup + последующей невозможности прочитать IDB: старый fallback мог вновь стать authority. Добавлены conservative journal и regression.
2. Failed in-flight put может восстановить pending **после** queued delete даже с общей очередью; дополнительный revision guard закрывает этот второй resurrection путь.
3. Vault scope reset без проверки уже запущенных GET/POST всё ещё принимает stale acknowledgement. Добавлен captured scope check.
4. docsync имел отдельный state/ancestor durability split; несколько вызовов, ожидающих один Promise, могли начать следующий проход одновременно. Исправлены checkpoint ordering и serial chain.
5. AGENTS.md раздел данных устарел: localStorage указан основным, unknown-schema reset — допустимым. Parent должен обновить на IDB + revisioned LS fallback + safe recovery. AGENTS вне назначенной области не менял. PERSIST_VERSION оставлен 7: revision/journal — additive envelope metadata, не новая доменная схема; версии релиза оставлены parent.
