# Независимый повторный аудит storage / domain — TetraFree

Дата: 2026-10-15. Проверяемый проект: `/data/tetrafree`, package.json **3.1.4**, `PERSIST_VERSION=7`.

**Статус первоначальной находки: findings переданы автору; ниже добавлена отдельная приёмка поступивших fixes.** Это аудит текущих файлов, не пересказ прежних отчётов. Исправления в репозитории не выполнялись. P0 не установлен. Ниже **8 наблюдений: 3 P1 и 5 P2**, причём R02 — явно выделенный recovery/checkpoint contract gap, а не доказанная потеря сохранённых байтов. Вероятность проявления на Windows не измерялась.

## Текущий итог после параллельных fixes

**7 findings закрыты в пределах scoped-приёмки; R07 закрыт только для исходного сценария, остаётся подтверждённый P2 R07-ABA.** Утверждения и номера строк в основной таблице/разделах R01–R08 ниже описывают **первоначально проверенную копию**, а не обещают совпадение со строками после чужих правок. Репозиторий менял автор параллельно; аудитор его не редактировал.

| Finding | Приёмка поступившего исправления |
|---|---|
| R01 | SAFE: tombstone остаётся в IDB, stale LS не воскресает; даже пустой IDB со старым LS и более новым authority отвергается |
| R02 | SAFE: journal failure теперь reject checkpoint; после разрешения записи явный retry даёт читаемый authoritative LS |
| R03 | SAFE для доказанного shrink-await сценария: свежий текст replace-target остаётся, image вставляется рядом |
| R04 | SAFE: backup import сбрасывает auto/mirror/running и создаёт новую identity |
| R05 | SAFE: production undo callback с новым pid API возвращает память в A и снимает A tombstone, B не меняется |
| R06 | SAFE: production doc callbacks с новым pid API меняют/удаляют A, не копию B |
| R07 | PARTIAL: исходный nonempty→empty случай исправлен, но сравнение значений не покрывает ABA (см. ниже) |
| R08 | SAFE: тот же большой непересекающийся input даёт точный ожидаемый merge без RangeError |

### Открыт R07-ABA — P2: сравнение конечного значения вместо поколения намерения

Актуальный candidate `src/lib/vault.ts:44` запоминает `Map<id, apiKey>` до GET, а `:54` разрешает восстановить remote при `!p.apiKey && before.get(p.id) === p.apiKey`. Это защищает **изначально непустой** ключ, который очищен во время запроса, но не доказывает отсутствие локальных изменений.

Новый независимый процесс `reaudit-storage/vault-aba.mts` выполняет настоящий store/startVault и удерживает только synthetic GET. Начальная строка ключа пуста (обычный stripped placeholder после hydration). За время ожидания реальные два saveProvider делают `пусто → SYNTHETIC-TEMP → пусто`, затем flush сохраняет конечную пустоту. После разрешения GET candidate снова ставит `SYNTHETIC-REMOTE-OLD`, считает ключ vaulted и **не делает ни одного delete**. `vault-aba.log`: **CONFIRMED OPEN R07-ABA**. Это регрессия сохранённого намерения очистить ключ, не внешняя эксплуатация; реальный UI double-save lifecycle не запускался.

**Оставшийся fix proposal:** монотонное поколение локальных изменений/явный clear intent на provider id (и, при необходимости, его semantics), captured до GET. Возвращение значения к прежней пустой строке не должно возвращать право на remote fill. Только неизменённый hydration-placeholder разрешает восстановление; local clear должен пройти durable ordering и remote delete. Нужен negative regression с изначально пустым ключом и промежуточной мутацией, а не только before-key=nonempty. Быстрый локальный semantic сравниватель without generation не закрывает эту границу.

### Артефакты приёмки

- `acceptance.mts` / `acceptance.log`: независимые assertions перевёрнуты на **требуемое безопасное поведение**, **11/11 PASS** (8 исходных finding cases + 3 controls). В отличие от `regressions.log`, PASS здесь означает безопасное поведение, а не воспроизведение бага.
- `candidate-existing-tests.log`: повтор тех же 7 выбранных test files после авторских добавлений — **88/88 PASS**.
- `candidate-hydration.log`: свежие процессы pending/future/old/v6 — **4/4 PASS** после fixes.
- `final-before.sha256` / `final-integrity.log`: **все 265 проверенных src-файлов совпали в интервале последней независимой acceptance+hydration**; точное число строк берётся из лога. Эта проверка не означает неизменность всего проекта с начала аудита.
- `repo-integrity.log` ранее показал параллельный drift 11 файлов, включая package.json и domain files; `candidate-drift.log` тоже фиксирует промежуточный drift. Это не изменения аудитора. `acceptance-first-drift.log` содержит 2 отказа harness-селекторов после замены автором helper API на pid actions, **не два доказанных дефекта**; harness адаптирован по свежему исходнику, финальный повтор прошёл.
- `vault-aba.log` — дополнительная, более строгая проверка поверх 11/11: остаётся OPEN. Не выдавать 11/11 за полное закрытие vault mutation-CAS.
- Общий check/build/push по-прежнему **не выполнялись аудитором**. Приёмка была синтетической/read-only; финальный владелец должен перепроверить после исправления ABA и любых дальнейших параллельных правок.

## Метод, артефакты и границы

- `AGENTS.md` прочитан целиком. Прочитаны авторские `/data/fix-tetrafree/persistence-fixes.md`, `domain-fixes.md`, `contracts.md` и исторические `docs/audit/3.1.4/{storage,domain}.md`; их утверждения не принимались за доказательства.
- Прочитаны реальные `store/{index,idb,persistence,snapshots}.ts`, целевые slices, `main.tsx`, `account/token/vault/vaultState`, `docplan/docsync/merge3`, `projectIO/backup/mdfiles`, связанные формы/callback и релевантные sync/team call sites.
- Новые проверки: `/data/fix-tetrafree/reaudit-storage/regressions.mts` и `hydration.mts`. Логи рядом: `regressions.log`, `hydration.log`.
- Независимый harness использует настоящий Zustand + Immer + production storage/IDB adapter/actions/vault/backup/merge3. IDB и LS заменены транзакционной in-memory моделью отказов. Настоящего диска IndexedDB/WebView2 она не моделирует. Все fetch запрещены либо заменены строго локальным responder; токены/ключи — заведомо синтетические.
- Для R03 выполняется извлечённый без изменения production-фрагмент `fresh/addImages`; для R05/R06 — точные production arrow callbacks, с проверкой уникальности текста, и настоящие store actions. React/DOM/lifecycle/доступность переходов в реальном модальном UI **не** эмулируются полностью. Это не browser E2E.
- Не запускались глобальные check/build/prettier, браузер, серверы/listeners, реальные аккаунты, команды пайплайнов, сеть. Проект READ ONLY; скрипты/логи только в указанном каталоге, этот итоговый отчёт — по отдельно заданному пути.
- SHA256-инвентарь регулярных файлов проекта: `reaudit-storage/repo-before.sha256`; результат проверки — `repo-integrity.log`. Он фиксирует копию до тестов; если автор начнёт fixes после передачи отчёта, последующие несовпадения необходимо отличать от действий аудитора.

## Краткий список для назначения fixes

Все production-пути ниже относительно `/data/tetrafree/`.

| ID | Severity | Дефект / граница | Точные точки исправления |
|---|---|---|---|
| R01 | P2 | Удаление снимает IDB-tombstone при оставшемся старом LS; authority игнорируется при успешном пустом чтении IDB | `src/store/persistence.ts:103–112,174–199,220–235` |
| R02 | P2, contract gap | Flush подтверждён, но authority fallback не записан; при недоступном IDB этот checkpoint нельзя открыть штатно | `src/store/persistence.ts:87–120,123–145,179–190`; `src/store/index.ts:80–84` |
| R03 | P2 | Pending image replacement стирает свежий текст в том же блоке | `src/workspace/DocView.tsx:69–88,423–429` |
| R04 | P1 | Backup import обходит detach: наследует execution approval, mirror и runtime running | `src/lib/backup.ts:70–90`; общий reset: `src/lib/projectIO.ts:10–20` |
| R05 | P1 | Undo памяти восстанавливает запись в текущий, а не исходный проект | `src/modals/Activity.tsx:195–201`; `src/store/slices/memory.ts:37–42`; `src/store/types.ts:178` |
| R06 | P1 | Отложенное rename/delete документа адресуется текущему проекту, в том числе копии с тем же doc ID | `src/workspace/Sidebar.tsx:405–412,421–429`; `src/store/slices/docs.ts:39–52` |
| R07 | P2 | Поздний vault GET отменяет уже сохранённое пользователем удаление ключа | `src/lib/vault.ts:41–57,71–81`; `src/store/slices/settings.ts:28–32` |
| R08 | P2 | `merge3` падает на допустимом большом непересекающемся фрагменте вместо результата/null | `src/lib/merge3.ts:73–88`; вызов `src/lib/team.ts:533–540` |

P1 здесь — нарушение изоляции проекта/разрешений или изменение/удаление чужой пользовательской записи. P2 — узкий сценарий локальной потери, API-регрессия, recovery/availability либо отказ отдельной операции. Это приоритет исправлений, не CVSS и не утверждение о внешней эксплуатации.

## R01 — P2: tombstone уничтожается раньше, чем исчезает stale fallback

**Code evidence.** `write()` успешно пишет tombstone в IDB и обновляет journal, но ошибка `localStorage.removeItem(k)` намеренно поглощается (`persistence.ts:103–112`). Затем `removeItem()` безусловно пытается физически удалить ключ из IDB (`:233–235`). На следующем запуске успешное IDB-чтение возвращает `undefined`; authority проверяется только при `readError` (`:179–190`), а `:192–198` выбирают оставшийся LS независимо от journal.

**Test evidence.** `regressions.mts:57–66`, R01. При успешно удалённом IDB-ключе остаются LS rev=1 и journal rev=2/backend=idb. Новый настоящий `idbStorage.getItem()` возвращает **OLD**, а не null/recovery. Никакой гонки окон для этого не нужно.

**Граница.** Это неполностью закрытый S02/S01 на storage API. В production исходниках текущего клиента не найден вызов `persist.clearStorage()`/прямого `removeItem('tetrafree')` из UI; поэтому не выдаю его за уже доступное каждому пользователю удаление/reset приложения и ставлю P2, а не P1.

**Fix proposal.** Оставлять revisioned tombstone в IDB; физический GC допустим только после подтверждённого удаления LS и безопасного решения authority для пустого IDB. При чтении учитывать journal также для `disk === null/undefined`, не только ошибок чтения. Старый LS не должен выигрывать у более нового tombstone/IDB-authority. Добавить regression с отказом именно LS remove и успешными IDB put/delete.

## R02 — P2 / contract gap: durable bytes ≠ штатно восстанавливаемый checkpoint

**Code evidence.** При отказе journal `mark('pending')` и наличии LS `allowIdb=false` (`persistence.ts:91–103`); fallback записывается и сверяется (`:115–116`), но отказ `mark('ls')` поглощается (`:117–120`). Затем очищается `lastError`, flush resolves. При последующем IDB read failure тот же модуль отвергает этот LS, если journal не совпадает (`:187–190`). Экспортированный checkpoint в `index.ts:80–84` не знает, что authority не подтверждён.

**Test evidence.** `regressions.mts:67–76`, R02: flush с NEW успешно завершается, raw NEW находится в LS, journal остаётся на OLD; новый экземпляр при недоступном IDB уходит в recovery.

**Что НЕ доказано.** NEW-байты не потеряны, остаются доступны recovery-экспорту. Если IDB читается, revision comparison находит NEW. Автор уже описывает conservative recovery как допустимый trade-off. Поэтому это не заявляется как «flush ничего не записал» и не приравнивается к исходному S14; проблема — слабее ожидаемая пригодность checkpoint для штатного restart.

**Fix proposal.** Для barrier перед baseline/ancestor требовать не только прочитанный обратно raw, но и подтверждённый соответствующий authority либо другую атомарную схему, позволяющую следующему запуску доказать актуальность fallback. Если это невозможно — reject flush, сохранить retryable pending и предупредить. Альтернатива — явно разделить API «raw bytes сохранены, нужен recovery» и полноценный checkpoint; sync не должен молча считать их эквивалентными. Не ослаблять read-side защиту до слепого принятия любого LS.

## R03 — P2: fresh array не защищает содержимое replace-target после await

**Code evidence.** `addImages()` действительно перечитывает текущие blocks после `await shrinkImage` (`DocView.tsx:75–76`), но при наличии `replaceId` заменяет текущий block целиком на `{...nb,id}` (`:79–82`), не сравнивая его с исходным пустым placeholder. `replaceId` захватывается до выбора/сжатия файла (`:423–429`).

**Test evidence.** `regressions.mts:96–110`, R03. В начале block b пуст; пока сжатие ожидает, настоящий `updateDoc` сохраняет в **тот же b** `CONCURRENT LOCAL TEXT`. После разрешения Promise реальный callback оставляет единственный image-block с пустым text. Свежий текст не сохранён ни в соседнем блоке, ни в конфликтной копии.

**Граница.** D06 исправлен для смены pid и независимых concurrent blocks, но не для изменения replace-target. Это узкий сценарий одного блока; его осуществимость через реальные UI input/image callbacks не проверялась браузером.

**Fix proposal.** Захватить ожидаемое содержимое/тип replacement target; после await заменять только при CAS-совпадении с этим placeholder. Если пользователь уже поменял блок — сохранить его и вставить image рядом либо запросить решение. Регрессия должна менять именно replaceId, а не добавлять другой block.

## R04 — P1: отдельный backup-import не применяет политику detach

**Code evidence.** ZIP/direct import/duplicate применяют `detachProject` с `delete mirror`, `deploy.auto=false`, `chat.running=false` (`projectIO.ts:10–20`; `projects.ts:171,190`). Но `importBackup()` строит новый объект через `...p` и сбрасывает только path/cloud/lanes, отдельно unpack versions (`backup.ts:80–88`). Все остальные flags остаются из входного snapshot. Это отдельный реальный путь импорта, а не проверенный авторами ZIP path.

**Test evidence.** `regressions.mts:111–122`, R04. Настоящий `importBackup()` добавляет независимый проект с новым pid, пустым path и без cloud, но с `deploy.auto=true`, `mirror=true`, `chats[0].running=true`. Проверяются только harmless flags; ни пайплайны, ни команды, ни сервер не запускались.

**Последствие, обоснованное кодом.** `ci.ts:99–104` доверяет `p.deploy.auto` при обходе импортированных проектов; `:57–63` использует тот же флаг для триггеров. Импорт данных, в отличие от явного включения автоматизации пользователем, сохраняет разрешение источника. Сохранение mirror/running — дополнительное расхождение domain-policy; фактическое выполнение или push не утверждается.

**Fix proposal.** Применять общую detach/normalization policy также к backup import (после корректного unpack версии), сохранив содержимое/историю, но сбросив auto/mirror/running. Если backup должен уметь восстановить approvals, сделать это отдельным явным выбором, не default. Проверить также streaming/active turn normalization; не менять поддержку delta snapshots случайно. Нужен отдельный тест `importBackup`, не только ZIP roundtrip. Existing unsafe bindings в уже сохранённых проектах этим не исправляются.

## R05 — P1: memory undo повторяет ошибку исходного chat undo

**Code evidence.** В `ActivityModal` callback тоста — `() => st().restoreMemory(keep)` (`Activity.tsx:201`), без pid. `restoreMemory` ищет `find(s)` (`memory.ts:39`), то есть текущий проект. Снять tombstone умеет только у него (`:41`). В отличие от restoreChat, сигнатура не принимает pid (`types.ts:178`).

**Test evidence.** `regressions.mts:123–131`, R05. Настоящие forget(A) → openProject(B) → извлечённый production undo: в A запись отсутствует и tombstone остаётся; в B появляется `SYNTHETIC NOTE A`. Совпадение memory IDs в B **не требуется**. Это одновременно неправильное восстановление и перенос содержимого между проектами.

**Fix proposal.** Capture pid в момент удаления, добавить optional pid в `restoreMemory` и адресовать только исходный проект, снять его tombstone, при его удалении показать отказ без fallback на текущий. Пройти также delayed edit/saveEdit в Activity (`:15–19`), который пока аналогично зависит от активного проекта; отдельный UI repro для него в этом аудите не выполнялся. Undo должен сохранять intended record, не переключая активный экран.

## R06 — P1: document confirm/rename остаются current-project dependent

**Code evidence.** Sidebar умеет защищать chat dialogs по pid, но doc rename — `st().updateDoc(d.id,{title:v})` (`Sidebar.tsx:411`), doc confirm — `st().deleteDoc(d.id)` (`:429`). `updateDoc` имеет optional pid, но здесь не передан; `deleteDoc` вообще ищет активный project (`docs.ts:47–52`). `duplicateProject` меняет project id, но сохраняет document IDs; это допустимо только если callbacks всегда scoped.

**Test evidence.** `regressions.mts:132–142`, R06. Создана копия через настоящий duplicateProject, не вручную подобранные одинаковые doc IDs. Callback захвачен для A, затем активирована копия B. Rename меняет title B, а delete удаляет doc B; A остаётся нетронутым.

**Граница.** Это модель смены проекта между открытием и подтверждением, а не браузерное доказательство возможности кликнуть сквозь модальную подложку. В этой же копии/импорте общие doc IDs — нормальный production state.

**Fix proposal.** Capture pid для doc menu/dialog. Передавать его в updateDoc; добавить pid в deleteDoc или guards аналогично chat dialog с явной отменой при смене контекста. Не полагаться лишь на глобальную уникальность doc IDs. Тестировать rename и delete, включая удалённый origin и actual duplicate/import.

## R07 — P2: vault GET считает любую текущую пустоту placeholder-ом

**Code evidence.** После GET `/api/secrets` `init()` смотрит на **текущих** providers; любой `remote && !p.apiKey` трактуется как ключ, который нужно восстановить (`vault.ts:46–50`), выставляет acknowledgement и записывает remote в store (`:55–56`). Scope/base/token guard не проверяет поколение локальной правки ключа. Поэтому осознанное clearing после отправки GET неотличимо от stripped placeholder после hydration.

**Test evidence.** `regressions.mts:168` и далее, R07. GET удерживается; реальный saveProvider очищает ключ, затем настоящий flushPersistence фиксирует пустое значение. После завершения старого synthetic GET ключ снова в store, `isVaulted=true`; delete-запросов **0**, set-запросов **0**. Никаких настоящих ключей/аккаунтов нет.

**Fix proposal.** Capture generation/semantic key map на отправке GET и принимать remote fill лишь для неизменённого placeholder. Для явного удаления нужен локальный pending-delete/intent (либо generation и очередь delete), не голая пустая строка. В случае гонки не подтверждать старый remote как актуальный. Регрессии: clear key и delete provider во время initial GET, смена provider semantics при том же id, повторный init после отказа flush. Существующий backend-scope тест этот сценарий не покрывает.

## R08 — P2: bounded LCS не ограничивает аргументы spread

**Code evidence.** `merge3.chunk()` делает `out.push(...co/ct)` (`merge3.ts:77–79`), а конфликтная ветка также использует spread (`:82–87`). LCS проверяет произведение изменённых размеров и возвращает null для слишком дорогой задачи (`:18–22`), но вставка длинного блока против пустого диапазона проходит эту проверку и превышает лимит аргументов движка. `team.ts:533–540` ожидает normal result/null; при исключении проход не доходит до предусмотренного fallback.

**Test evidence.** `regressions.mts:160–166`, R08. Чистая функция получает обычный текст меньше 1 MiB с большим вставленным диапазоном и независимым коротким изменением другой стороны. В текущем Node/V8 возникает `RangeError`, а не Merge3/null. Никакие файлы пользовательского проекта не создавались.

**Граница.** Точный порог количества аргументов зависит от JS-движка; Windows/WebView2 не проверен. Это доказанный отказ функции, не доказанное повреждение snapshot: Immer mutation при throw откатывается, наружный sync catch существует. Последствие — невозможность завершить соответствующий merge/повторяемый отказ sync для такого нормального текста.

**Fix proposal.** Append итерацией/порциями без unbounded argument spread во всех ветках chunk, включая conflict; дополнительно ограничить общий размер/строки и возвращать null, если операция не поддерживается. Regression: большой независимый insert должен завершиться корректно либо вернуть null, не бросать RangeError.

## Что из старых fixes выдержало эту проверку

Это scoped результаты, а не утверждение, что весь исторический аудит закрыт.

- **S01 основной сценарий:** newer revisioned LS выигрывает у older IDB, успешный IDB commit очищает LS — существующий scoped regression проходит. Отказ IDB при неавторитетном LS fail-closed; остаются R01/R02.
- **S03 downgrade/recovery:** отдельно свежими процессами проверен настоящий `hydrateStore()` для схем 8 и 3. `hasHydrated=false`, flush rejects, raw не заменён. Отдельный corruption control также сохраняет raw. Legacy v6 реально гидратируется и сохраняется в v7; unknown reset из AGENTS.md больше не описывает реальный код.
- **S04/S05:** реальный store сохраняет текст прерванного stream, снимает streaming/running; delayed hydration не считается завершённой, checkpoint до неё rejects. `main.tsx:77–91` запускает UI/писателей только после hydrate; 10s recovery timer не разблокирует пустой store. Сам timeout/UI не запускался E2E.
- **S14 обычный barrier:** независимый C02 удерживает transaction completion и проверяет, что экспортированный flush не resolved до release; после release сохраняется CURRENT. Author docsync regression проверяет отсутствие `tf-docs:<pid>` при отказе state write и trash при удалении зеркала; проходит. `docsync.ts:87–88` действительно await state перед ancestor, `:25–31` сериализуют pid.
- **S12/S13:** image-disabled doc сохраняет ownership/base в docplan, не превращается в удалённый; CRLF resolver реально сохраняет выбранные content/EOL. Независимый C03 выполняет merge3/hasMarkers/resolveMarkers; passes. R08 — отдельный непокрытый размерный случай.
- **S15 account:** текущие api/verify/login/logout действительно имеют captured epoch/token/base и проверяют stale results; выбранный authored regression со stale 401/success/login/slow logout проходит. Production Auth передаёт API result без копирования, WeakMap context не теряется в прочитанных done() call sites. Реальные OAuth/MFA/cross-tab сценарии не запускались.
- **S16/S17 vault:** scoped backend смена и поздний ответ прежнего backend отклоняются; idle не создаёт постоянных записей. Это не доказывает mutation-CAS; R07 остаётся.
- **D01–D06, S10/S11:** ZIP/direct import/duplicate detach, normalized folder guard, chat undo pid, delayed Markdown import pid, independent-field task form CAS и async image fresh blocks проходят выбранные существующие tests. В прочитанном актуальном `NewProject.tsx:71,114–160,546,575–587` уже есть normalized comparison/catch/finally: замечание автора domain-fixes про их отсутствие **устарело**. R03/R04/R05/R06 — отдельные непокрытые ветки.

## Выполненные команды и результаты

Воспроизводить только в изолированной среде без реальных storage/accounts; harness сам запрещает внешнюю сеть.

```sh
/data/tetrafree/node_modules/.bin/tsx --test \
  /data/tetrafree/src/store/persistence-durable.test.ts \
  /data/tetrafree/src/store/persistence.test.ts \
  /data/tetrafree/src/store/snapshots.test.ts \
  /data/tetrafree/src/lib/docplan.test.ts \
  /data/tetrafree/src/lib/merge3.test.ts \
  /data/tetrafree/src/lib/vaultState.test.ts \
  /data/tetrafree/src/store/slices/domain.test.ts

/data/tetrafree/node_modules/.bin/tsx \
  /data/fix-tetrafree/reaudit-storage/regressions.mts

# Каждый CASE — новый процесс/реальный module instance store.
/data/tetrafree/node_modules/.bin/tsx \
  /data/fix-tetrafree/reaudit-storage/hydration.mts CASE
# CASE: pending, future, old, v6
```

- `existing-tests.log`: **70/70 PASS**.
- `regressions.log`: **11/11 PASS** = **8 воспроизведений дефектов/contract gap + 3 controls**. PASS в R-тестах означает «текущее ошибочное поведение подтверждено», **не «bug исправлен»**.
- `hydration.log`: **4/4 PASS**, отдельные процессы pending/future/old/v6.
- В начальном package.json `test` файлы `persistence-durable.test.ts` и `slices/domain.test.ts` ещё не были включены. При финальном чтении package.json автор уже добавил оба entrypoint. Это замечание первоначального аудита больше не открыто; отдельный полный check аудитор не запускал.

## Остаточные ограничения и невыданные за findings предположения

- Нет browser-IDB integration, production quota, Windows/WebView2/DPAPI, реального filesystem crash, multiwindow CAS, desktop close/unload теста. `idb.ts:62` использует transaction без explicit durability option: browser transaction completion не даёт здесь отдельно проверенной гарантии OS-power-loss. Честно не приравниваю модель commit к fsync/сохранению при выключении питания.
- `beforeunload/pagehide` async flush остаётся best-effort (`persistence.ts:150–155`); в прочитанном frontend нет awaited desktop-close checkpoint. Это известная открытая граница, а не новая доказанная Windows потеря.
- Полная schema validation, совместная атомарность state + всех baseline/ancestor, distributed revision/CAS, ранее сохранённые cloud/path bindings и физическая Windows folder identity не проверены/не реализованы этим аудитом. Epoch/base/token guard не заменяет их.
- `docsync` проверен чтением полностью и existing failure/trash regression; его поведение при удалении/восстановлении того же pid во время checkpoint отдельно не воспроизведено. `startDocSync()` callback coverage для фоновых неактивных проектов не объявляется полной.
- Прочитаны релевантные места `sync/team`, но не выполнен второй полный аудит сетевой синхронизации (исторические S06–S09/S18/D07). Этот отчёт не закрывает их wholesale.
- D08/design inspector вне данного storage/domain callback scope; здесь ни подтверждения fixes, ни нового заключения по нему.
- Ни эксплойты, ни эксплуатационные payload/цепочки не создавались. Все доказательства — локальные fault-order/intent/identity tests с синтетическими данными.

## Порядок исправлений и приёмка

1. R04/R05/R06: общий detach для всех импортов, scoped pid для всех delayed document/memory callbacks.
2. R01: tombstone/authority GC; R02: определить и реализовать строгий restart-readable barrier либо явно разделить гарантию API.
3. R03/R07: CAS локального намерения после await, не только свежий массив или правильный backend scope.
4. R08: убрать unbounded spread.
5. После изменений перевернуть R-assertions на требуемое безопасное поведение и прогнать scoped tests; затем основной владелец выполняет финальный check/build/push. Аудитор repo не меняет и push не выполняет.
