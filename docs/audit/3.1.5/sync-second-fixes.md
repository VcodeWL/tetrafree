# Второй sync repair: F02 / F03 / F05

## Итог и остановка scope

Код остановлен для родительского global format/check. Ни backend/server/types/package/version, ни engine-owned файлы не изменялись. Global formatter/check/build/browser/push не запускал.

Финальный scoped run: **41/41 PASS**. Scoped ESLint — 0; TypeScript diagnostics только в 10 owned файлах — 0.

- `sync-second-tests.log` — финальный прогон после последних production bytes.
- `sync-second-lint.log`, `sync-second-typecheck.log` — scoped результаты.
- `sync-second-test-files.txt` и обновлённый `sync-test-files.txt` — 4 test-файла; новая запись добавлена в общий `test-files.txt` без замены чужих строк.
- `src/lib/syncRestart.fixture.ts` — дочерний процесс для restart-тестов, **не отдельный test entry**.

## Что изменено

### F02 — acknowledged cloud PUT отдельно от current-local cleanliness

Вместо отбрасывания факта успешного PUT при local drift введён `tf-cloud-intent:<cp>`:

1. До PUT durable `prepared` запись: last-known external state, request-local snapshot и local snapshot.
2. После ответа PUT сохраняются **принятые сервером rev/files/meta/dirs/texts** + свежий local snapshot, независимо от того, совпадает ли current local с отправленным.
3. `flushPersistence()` по-прежнему awaited. Ошибка checkpoint не продвигает старый clean baseline, **но accepted journal остаётся**. Drift обновляет local snapshot journal и оставляет current dirty относительно accepted ancestor.
4. Следующий проход использует accepted ancestor journal, а не старый clean baseline. Поэтому `sent -> undo(base)` превращается в исходящее undo, а не в pull собственной предыдущей отправки.
5. После успешного current-state checkpoint и сохранения обычного baseline journal очищается **revisioned tombstone**, не небезопасным delete.
6. На fresh-process recovery локальные отличия journal накладываются compare-before-replay; несовместимые файловые данные сохраняются `.journal-local`, метаданные проходят loss-preserving merge/copies. Полная локальная chat history в journal не усечена до wire-window.
7. Lost response сохраняет prepared/local state и принуждает full GET. `undoAncestor` не позволяет возврату к старому ancestor автоматически считаться unchanged при неизвестном результате запроса.

### F03 — disk acknowledgement/dirty journal

`tf-sync-intent:<pid>:<scope hash>` отделяет успешно записанные/удалённые **по результату partial batch** файлы от локального состояния, которое могло измениться во время await.

- После batch сохраняется accepted map только успешных путей; `failed[]/CONFLICT` не становится ack.
- Следующий scan сравнивает local с реально записанным accepted содержимым: undo во время write и restore во время remove отправляются на диск, а не поглощаются pull.
- Failure/drift checkpoint сохраняет desired local journal и старый clean base; ack не выбрасывается.
- При transport ambiguity prepared содержит attempted paths; повторный scan не классифицирует локальный undo на них как untouched только из-за старого baseline.
- Folder/backend входят в journal scope/key. Explicit forgetBase архивирует pending journal перед его сбросом, чтобы команда «Записать файлы заново» не зацикливалась на прежнем ack.
- Аналогичная фиксация наблюдённого внешнего ancestor добавлена перед checkpoint для входящих read-снимков, чтобы не отбрасывать observed state при drift.

### F05 — пустые каталоги

- Optional `Base.dirs`, normalized dirs в accepted cloud state и сравнении поколения.
- Isolated mkdir **и rmdir** выбирают PUT даже при одинаковых files/meta.
- `p.dirs` добавлен в debounce watcher signature.
- Входящие dirs с известным ancestor сливаются по membership: unchanged local принимает remote addition/deletion; локальное отличие остаётся локальным. Старая база без dirs использует conservative union до первого известного checkpoint.
- Родители surviving local files сохраняются даже при удалении пустой папки другим участником.

## Journal durability

Новый `src/lib/syncJournal.ts` использует отдельные KV записи в существующей IndexedDB, с LS fallback и маленьким revision/authority marker. Таким образом полный journal не обязан помещаться в 5 MB LS, если IDB работает. Неудачная prepare-запись блокирует внешнюю запись. Непрочитанный/неоднозначный authority не трактуется как отсутствие journal. Accepted состояние удерживается в runtime cache даже если durable update после внешнего acknowledgement больше не удаётся.

Это **не** одна транзакция project-state + ack journal + localStorage baselines + внешний сервер/диск. Наличие journal не даёт права написать «всё атомарно».

## Desired regressions (не bad-behavior witness assertions)

Реальные reconcile/cloudNow/store, транспорт полностью in-memory, без реальных shell/network/fs mutations:

- accepted PUT + file undo **и desc undo** во время await: local и server остаются undo; 2 PUT, не восстановление sent.
- accepted PUT + rejected app checkpoint + fresh Node process, который гидратит последний app snapshot (`sent`): journal восстанавливает undo для файла/desc, затем отправляет undo серверу.
- accepted disk write + undo; отдельно accepted remove + restore: второй batch возвращает local intent на диск, pull не поглощает undo.
- accepted batch + rejected app checkpoint + fresh Node process: disk и local после recovery содержат undo.
- accepted-but-lost cloud response + undo: uncertain journal/full GET сохраняют undo.
- isolated empty mkdir/rmdir и remote directory delete.
- реальный debounce watcher: только изменение dirs вызывает PUT после стабилизации исходной сигнатуры.
- fresh journal instance восстанавливает ack/local независимо от app checkpoint; clear tombstone не воскрешает старую запись.
- uncertain-request ancestor unit invariant.

Предыдущие 32 storage/domain merge regressions также проходят. Read-only witness fixtures второго аудитора не редактировались; их assertions «ожидаем плохой результат» теперь должны падать для исправленных F02/F03/F05.

## Реальные ограничения / оставшиеся риски

1. **Нет общей атомарной транзакции.** Между server acknowledgement и записью accepted journal остаётся crash window с prepared состоянием. Полная физическая потеря и IDB, и LS не исправима клиентским journal; при rejected durable accepted update runtime ack удержан, но после аварии доступно только то, что реально успело записаться. Native fsync/power-loss/WebView unload не проверялись.
2. **Replay всё ещё не содержит единой persisted app generation.** Он ориентируется на journal prior/local и compare-before-replay, а не на shared state+journal transaction. Особо важный остаточный случай: после failed sync journal содержит undo, затем пользователь делает другой edit/redo, app state успевает durably сохраниться без нового sync; если новое значение совпало с journal.prior, recovery может принять его за старый snapshot и повторить старое journal.local. Это потенциальная потеря более нового intent. Не выдавать текущие fresh-process tests за доказательство безопасности всех поздних edits/restarts. Нужен следующий шаг — общий persisted generation либо supervised per-mutation dirty journal. По просьбе координатора не добавлял сейчас ещё один крупный refactor.
3. Prepared/unknown-result recovery консервативен для покрытого undo, но **не исчерпывающая outbox state machine**. Сохранение неотправленного intent после произвольного crash/неоднозначного ответа и последующих новых правок требует отдельной проверки; текущий код не является доказанным exactly-once протоколом.
4. Server `expectedHashes` — прежний in-process CAS. Внешний OS writer не участвует в project lock; newest foreign write между hash check и mutation всё ещё может быть потерян. FNV не cryptographic/raw-byte CAS, recovery — UTF-8 text, не byte-exact non-UTF8 backup.
5. Пределы localStorage/IDB/cloud quotas остаются: если подготовка journal не сохраняется, sync блокирует внешнюю запись, а не продолжает без recovery. Нет UI для просмотра всех archived journal KV/ручного разрешения повреждённого authority.
6. Много окон/процессов не разделяют этот runtime cache/координатор; нет cross-window journal CAS/lock. Дополнительные Windows/real IDB/real server crash tests не проводились.
7. Ограничения первого `sync-fixes.md` (chat transport 80 на новом устройстве, metadata conflict copies требуют review, expiry tombstones, non-CONFLICT badPaths и т.д.) сохраняются, кроме старого утверждения «journal отсутствует»: теперь отдельный journal есть, но не shared atomic checkpoint.

**Статус:** воспроизведённые F02/F03/F05 desired tests закрыты, но generic restart/replay safety НЕ полностью закрыта. Остаточный matching-prior replay риск выше явно оставлен координатору/acceptance reviewer; не скрывать его за зелёными 41 тестами.
