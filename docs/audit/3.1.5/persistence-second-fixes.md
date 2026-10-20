# Second persistence pass — R01 / R02 / R07 / R08

Прочитаны независимые `reaudit-storage/regressions.log`, `regressions.mts`, актуальный `contracts.md` и текущие исходники. Аудитный script **не редактировался и не запускался как критерий исправления**; SHA256 до/после совпал (`persistence-second-audit-sha.txt`, проверка `sha256sum -c`: OK).

## Исправления

### R01 — delete + failed LS cleanup resurrection

`src/store/persistence.ts`:
- После logical remove **сохраняется committed revisioned IDB tombstone**, а не физически удаляется ключ сразу после его записи. Иначе при failed LS cleanup пропадало единственное доказательство более свежего удаления.
- Следующий set заменяет tombstone более высокой revision.
- При чтении authoritative journal с revision выше любой доступной копии блокирует stale hydration, даже если IDB вернул «нет ключа», а не ошибку. Не загружаем старый LS поверх недоступной последней revision.
- Существующий ordered-delete тест теперь проверяет логическое отсутствие state/tombstone, а не физическое отсутствие IDB-ключа.

Negative regressions: delete + failed LS remove → повторное чтение **null**, а не OLD; следующий set читает AFTER-DELETE. Отдельно: отсутствующий authoritative snapshot + старый LS → reject/recovery, raw LS не стирается.

### R02 — durable raw без пригодного authority ложно подтверждал flush

`src/store/persistence.ts`:
- Fallback checkpoint подтверждается только после **обязательной** записи LS authority и точного read-back marker.
- Throw или silently ignored journal write → flush rejects. Raw NEW оставляем для восстановления; pending NEW сохраняется для retry. Baseline нельзя продвигать.
- Успешный retry после восстановления journal подтверждает fallback; он читается даже при IDB read failure.
- Для успешно committed IDB state marker по-прежнему может остаться pending при отказе LS journal: сам IDB checkpoint durable, а при последующей невозможности читать IDB recovery fail-closed. Это не выдаётся за подтверждённый LS fallback.

Negative regressions: throwing marker и silently dropped marker оба **reject**; NEW raw сохраняется, retry создаёт пригодную authority, restart с недоступным IDB читает NEW.

### R07 — delayed vault GET resurrects a locally cleared key

`src/lib/vault.ts`:
- До первого await GET захватывается provider id→key snapshot.
- Remote key подставляется в пустое поле только если тот же provider уже существовал в начале GET и key за время запроса не изменился.
- Returned remote acknowledgement учитывается отдельно от восстановления значения: если пользователь очистил key, push отправляет **delete**, а не восстанавливает его; если заменил — set нового значения; provider, удалённый во время GET, также удаляется из remote vault.
- Обычная загрузка persisted пустого key из vault сохранена и проверяется прежним scoped/idle тестом. Backend/token context response guard сохранён.

Negative regressions используют настоящие saveProvider/deleteProvider и реальный store: локальный clear сначала persist, затем старый GET → key остаётся пустым, vaulted=false, **1 delete / 0 set**. Дополнительно replacement остаётся LOCAL-NEW и отправляет set; удалённый provider не воскресает и отправляет delete.

### R08 — benign large insertion throws RangeError

`src/lib/merge3.ts`:
- Убраны все `out.push(...largeLines)` и смешанный spread больших conflict sides.
- Результирующие строки добавляются итеративно, без зависимости от engine argument-count limit. Не делаем silent truncate и не превращаем нормальное независимое слияние в конфликт.

Negative regressions: вставка **150000 строк**, текст <1 MiB, плюс независимый append → точный merged text без конфликта в обоих порядках ours/theirs. Большой конфликт → реальные маркеры, ours/theirs resolver возвращает **обе исходные стороны без потерь**. Existing incompatible-size/null protection остаётся зелёным.

## Реальные результаты (не characterization-green)

1. **До production исправлений** добавленные пять safety assertions были запущены против старой реализации:
   - 27 tests: **22 pass / 5 fail**.
   - Именно R01, R02, R07 и оба R08 теста падали на небезопасном поведении.
   - Лог: `persistence-second-before.log`.
2. После исправлений тот же первичный набор: **27/27 pass**, лог `persistence-second-after.log`.
3. После ещё трёх edge regressions полный целевой набор: **61/61 pass**, 0 failed/cancelled/skipped, лог `persistence-second-tests.log`.

```
./node_modules/.bin/tsx --test src/store/persistence-durable.test.ts src/store/persistence.test.ts src/store/snapshots.test.ts src/lib/docplan.test.ts src/lib/merge3.test.ts src/lib/vaultState.test.ts
```

Всего во втором проходе **8 новых safety tests**: по два для R01/R02/R07/R08. Только два уже существующих тестовых файла изменены:
- `src/store/persistence-durable.test.ts`
- `src/lib/merge3.test.ts`

Список: `persistence-second-test-files.txt`. Новых test files во втором проходе нет; persistence-durable уже записан в первоначальные manifest для parent/package.test.

Scoped ESLint только пяти изменённых production/test файлов: **0 ошибок**, `persistence-second-eslint.log` пуст. Scoped TypeScript owned-file diagnostics: **0**, `persistence-second-types.log`.

## Границы / remaining

- Characterization audit не менялся. Его первоначальный RESULT 11 passed означал обнаруженные баги, **не исправления**. Результаты выше — repo tests с противоположными, безопасными assertions.
- R03–R06 не редактировались, отданы другому владельцу согласно сообщению parent.
- Не трогал package/version/types/lock, sync.ts/team.ts или чужие domain/UI файлы. Global check/build/browser/global formatter не запускал. Prettier — только persistence.ts/vault.ts/merge3.ts и два моих test files. Push не выполнялся.
- IDB fault/order и fetch контролируются in-memory harness, но store/actions/vault/merge — настоящие production модули. Windows/WebView2/DPAPI, browser-IDB/real OS crash и два окна не проверялись.
- Межоконного CAS по-прежнему нет. Unload остаётся async best effort. Неоднозначный/недоступный authoritative snapshot вызывает recovery вместо stale state.
- Vault clear при успешном ответе GET теперь корректно отправляет remote delete; этот проход не добавляет durable outbox/tombstones для **неудавшегося remote delete с последующим crash/reload**. Такая долговременная user-intent recovery остаётся отдельным контрактом, не выдаётся за проверенную здесь.
