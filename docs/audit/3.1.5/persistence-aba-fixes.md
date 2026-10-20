# R07-ABA — monotonic local mutation intent

Прочитаны обновлённый `/data/fix-tetrafree/reaudit-storage.md`, read-only `reaudit-storage/vault-aba.mts`, contracts.md. Fixture не редактировался, не запускался как «зелёное доказательство» исправления; SHA256 до/после совпал (`persistence-aba-audit-sha.txt`).

## Что изменено

Только расширенный назначенный scope:
- `src/lib/vaultState.ts`: in-memory monotonic generation на каждый явный saveProvider/deleteProvider, включая одинаковые значения. Отдельные `clear` и `pendingDelete` intents; это metadata без ключей, store import, диска или сети. Mutation отзывает старый vault acknowledgement. Clear intent сохраняется после delete ACK, чтобы повторный GET не спутал его с hydration-placeholder. Pending delete и clear привязаны к backend/token scope; они не переносятся в другой vault. Поколение локальных мутаций монотонно во всём runtime.
- `src/store/slices/settings.ts`: настоящие saveProvider/deleteProvider вызывают `recordVaultKeyIntent` **перед** публикацией нового state/subscriber notification. Даже empty→new→empty и empty→empty имеют новое generation. Это не value-only comparer; explicit save считается намерением сохранить key-поле переданного Provider.
- `src/lib/vault.ts`: GET захватывает key **и generation**. Remote fill допускается только для unchanged generation, прежнего пустого placeholder и отсутствия local clear intent. Push обрабатывает pending deletes даже после предыдущего failed init, даже если provider удалён. SET/DELETE completion также проверяют generation: stale ACK не подтверждает новый ABA intent; ставится следующий проход. Подпись subscriber включает generation, поэтому explicit same-empty save может повторить неудавшееся удаление без synthetic idle loop.
- Тесты: `src/store/persistence-durable.test.ts`, `src/lib/vaultState.test.ts`.

`src/lib/account.ts`, `src/lib/backend.ts`, persistence.ts и все остальные production-файлы **не менялись в этом проходе**. Удалённый parent legacy setPreviewToken не возвращался.

## Настоящая трёхшаговая negative regression

Initial key **empty** → задержанный GET → настоящий saveProvider(TEMPORARY-LOCAL) → настоящий saveProvider(empty) → await flushPersistence() → release remote OLD-REMOTE.

Assert: durable state до ответа содержит empty; после ответа память и persistence остаются empty; vaulted=false; **ровно 1 delete и 0 set**. До исправления этот safety test падал (delete не отправлен, прежняя реализация восстанавливала remote); после generation fix проходит.

Дополнительно:
- explicit same-empty save во время GET — это clear intent, не placeholder;
- remote delete 503 сохраняет runtime pending intent, последующий настоящий same-empty save повторяет delete; успешный ACK снимает pending, но не clear intent;
- ABA generations строго возрастают, устаревший ACK не снимает новое pending-delete;
- pending delete/clear не переходит с backend A на B;
- прежние scoped backend-response/idle, clear/change/remove, checkpoint и merge regressions остаются зелёными.

## Точные результаты

- **До production fix:** `persistence-aba-before.log`: 19 tests, **18 pass / 1 fail**, падает новый R07 ABA safety test. Characterization script для этого результата не использовался.
- **После fix:** `persistence-aba-after.log`: 21/21 pass (durable + существующие vaultState tests на том шаге).
- **Итог с дополнительными regression tests:** `persistence-aba-tests.log`: **65/65 pass**, 0 fail/cancelled/skipped.

```
./node_modules/.bin/tsx --test src/store/persistence-durable.test.ts src/store/persistence.test.ts src/store/snapshots.test.ts src/lib/docplan.test.ts src/lib/merge3.test.ts src/lib/vaultState.test.ts
```

Scoped ESLint 5 изменённых файлов: `persistence-aba-eslint.log` (пустой при успехе). Scoped TypeScript owned roots/imports с включёнными settings.ts/vaultState.test.ts: `persistence-aba-types.log`. Global check/build/browser/global formatter не запускались. Только scoped Prettier моих 5 файлов. Package/version/types/lock и другие чужие файлы не изменялись.

Список изменённых тестов: `persistence-aba-test-files.txt`; новых test files нет, package.test дополнять не нужно.

## Честный pending

**Durable intent outbox для remote-delete-failure + process crash/reload НЕ реализован.** Поколения/clear/pendingDelete — in-memory metadata. В текущем процессе failed delete не теряет намерение и может быть повторён; это не доказывает сохранение намерения после перезапуска. Чтобы закрыть reload, нужен versioned backend/account-scoped durable outbox с ordering перед изменением state, recovery и ACK/CAS очисткой; token нельзя просто вписать в persisted metadata. Не называю runtime retry durable outbox.

Browser/WebView2/Windows/DPAPI/реальный IDB crash и multiwindow не проверялись; IDB/fetch в tests — controlled in-memory, store/actions/vault — настоящие production модули.
