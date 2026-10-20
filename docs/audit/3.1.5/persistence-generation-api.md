# Persistence generation/runtime API — restored owner handoff

Восстановлено после rollback Oct15 13:56 из точных patches собственной истории. **Source и tests побайтово совпали с прежними финальными SHA, фактически вычисленными заново**; документы восстановлены по смыслу из истории, byte-identical прежних отчётов не заявляется. Предыдущая independent acceptance25/regressions172 — исторический результат, не новая acceptance после отката.

## Public API

```ts
import {
  capturePersistenceGeneration,
  capturePersistenceRuntimeRevision,
  flushPersistence,
} from '../store/persistence'
const { current, hydrated } = capturePersistenceGeneration()
const runtimeRevision = capturePersistenceRuntimeRevision()
```

- `current` — монотонный issued ordering watermark, **не durable proof**. Каждый real persisted setItem выдаёт следующую revision синхронно, включая одинаковые/queued/debounced snapshots; delete тоже выдаёт revision. Дополнительно runtime mutation резервирует revision до публикации state/subscribers.
- `hydrated` — revision реально выбранного прочитанного durable envelope. IDB20/LS24 → hydrated24. Legacy без revision — 0. Tombstone тоже сохраняет прочитанную revision.
- Migration auto-write, setItem, reserveRevision и flush НЕ меняют hydrated. Настоящий v6 envelope N → middleware auto-write N+1 даёт `{current:N+1,hydrated:N}`; explicit flush N+2 всё ещё оставляет hydratedN.
- Успешный explicit rehydrate может обновить read provenance; current не уменьшается даже при чтении более старой копии в том же instance.
- Getter возвращает exact pair `{current,hydrated}`, синхронно читает metadata app/root adapter. Не переключается на последний test adapter; до root registration throws.
- Safe-integer overflow throws, не создаёт alias старых revision.

## Почему reservation — до notifications

Установленный Zustand persist вызывает core set → subscribers → storage.setItem. Простой getter внутри subscriber видел бы предыдущую revision. index.ts оборачивает **все 8 factories** и public setState в publish, который reserveRevision вызывает до set. Actual setItem затем выдаёт ещё более высокую revision. Reservation — watermark порядка, не обещание durable записи. Hydration core set не считается новой пользовательской mutation.

Финальные bindings: ui/projects/files/chats/docs/tasks/settings/memory → publish. Исторический пропуск chatsActions(set) устранён и отдельно проверен настоящими createChat/renameChat/pushMsg и свежим процессом.

## Критичный отдельный runtime guard (A04)

Пары current/hydrated недостаточно: человек мог изменить live state после hydration, до первого sync. `capturePersistenceRuntimeRevision():number`:
- 0 после successful completeHydration;
- растёт только на reserveRevision runtime core/public invocation после successful hydration (writable);
- plain storage.setItem, migration auto-write и flush не увеличивают его;
- before-subscriber ordering, root-only getter; отдельный adapter не сбрасывает app counter;
- coarse all-runtime guard: фоновые мутации тоже консервативно блокируют replay. Не классифицирует human/background и не выводится из current>hydrated.

## Согласованная fresh redo policy (sync owner)

Journal сохраняет `appRevision=current` синхронно после capture local snapshot.

- `hydrated < appRevision && runtimeRevision === 0`: older durable snapshot доказан и runtime ещё не менялся; owner может применить authoritative redo с проверкой scope/валидности.
- `hydrated < appRevision && runtimeRevision > 0`: **не replay**, live не трогать, visible desired/prior recovery JSON, warning, 0 outgoing, no clean advancement, включая cached retries.
- `hydrated >= appRevision`: obsolete/already-applied journal; не проигрывать старый full snapshot поверх durable app.
- Legacy/no valid tokens: recovery copy + block/warning, не value-based replay.

Hydrated — read provenance, не latest runtime commit watermark. API не решает multiwindow CAS/lineage reset/out-of-band raw rollback. Sync/team/recovery policy принадлежит sync owner; owner metadata tests не подменяют independent whole-replay acceptance.

`registerPersistenceCheckpoint(flush,capture?,captureRuntime?)` сохраняет совместимость с существующими tests, передающими только flush; optional absence не сбрасывает root readers. Adapter exposes `.captureGeneration()`, `.reserveRevision()`, `.captureRuntimeRevision()`.

## Restored tests

В существующем persistence-durable.test.ts восстановлены:
- выбранная LS24 вместо IDB20, queued identical issuance25/26 и actual commit без изменения hydrated;
- настоящий middleware v6 migration N→N+1, explicit flush N+2, hydratedN/runtime0;
- slice/public subscriber ordering и реальный fresh durable read после ABA;
- failed IDB+LS write: current53 не фабрикует durable hydrated53, реально прочитан52;
- runtime: migration/flush0, slice1/public2 до subscribers, isolated adapters не меняют root, successful rehydrate resets0;
- реальные createChat/renameChat/pushMsg, каждый шаг runtime>0;
- representative actual state-changing actions из всех 8 factories + before-notification runtime guard.

Новый post-rollback прогон и его точные результаты: `persistence-restoration.md`, логи `persistence-restored-*`. Test manifests: `persistence-generation-test-files.txt`, `persistence-slice-coverage-test-files.txt`; новых test files нет.

Изменены только мои persistence.ts/index.ts/persistence-durable.test.ts. Vault ABA с monotonic intent уже пережил rollback, не редактировался повторно. Durable vault delete-intent outbox после crash/reload остаётся pending. Global check/build/browser/global formatter/push не выполнялись; Windows/OS-power-loss/browser IDB не объявляются доказанными.
