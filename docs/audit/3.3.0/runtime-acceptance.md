# Независимая runtime acceptance 3.3.0

## Вердикт: CURRENT ROLE-FIX PASS в ограниченном portable runtime scope — 24/24

## Последняя приёмка после role-prefix key fix — authoritative current bytes

По explicit parent STOP после own-format выполнен **свежий scoped прогон 24/24 PASS**, 0 fail/skip/cancel; Node v22.23.3, 5860.3 ms. Лог `acceptance-runtime/tests-rolefix.log`. SHA guard после прогона: sources=[], fixtures=[]. Current ChatView SHA совпал с handoff: `013819fc47e165aabb51a3b660e2a683283c27014a11b121c6a88f96ea971e7b`.

**Точная проверка:** actual source ChatView.tsx:120/122 теперь использует `thread:${draftKey(pid,cid)}` и `composer:${draftKey(pid,cid)}`. D10 проверяет role-prefixed значения обеих sibling keys, их неравенство внутри одного render, смену обоих ключей между A/B с одинаковым chat ID и explicit AgentTurn pid. Старое точное ожидание composer key без префикса обновлено под новый контракт; добавлены проверки Thread/sibling uniqueness, остальные safety assertions не менялись. Fixture diff — `rolefix-fixture.diff`. Исправление React identity warning, **не finding о потере данных**. Инертный JSX-тест проверяет ключи, не заменяет parent browser повтор React warnings.

Current snapshot manifest `snapshot/manifest.json`, timestamp `2026-10-21T11:27:36.098087+00:00`, SHA256 `6a433be909976a18af2058e93332a297782a520256c80903896c30fccde98b1d`. Предыдущие postformat snapshot/report сохранены в `snapshot-postformat-before-rolefix/`, `report-postformat-before-rolefix.md`; старый PASS не выдаётся за новый. Дельта source/test: src/lib/chatDraft.test.ts, src/modals/ModalRoot.lazy.test.ts, src/workspace/ChatView.tsx. Дельта fixtures: runtime-ui.test.ts; полный `rolefix-delta.json`.

D08/D09, positive pin/task/toast/CAS, controller/queue/retry/approval/drafts всё ещё PASS. Открытых подтверждённых findings в этом bounded scope нет. Production READ ONLY; global check/build/browser/сеть/сервер/listeners не запускались. Package/docs вне AGENTS не входят в guard. Parent browser и общий gate независимы от этих 24 portable tests.

## История предыдущего postformat snapshot (до role-prefix fix)

## Свежая postformat приёмка — текущий authoritative результат

После parent handoff о завершении formatter и STOP владельцев выполнен **новый** прогон тех же fixtures без изменений: **24/24 PASS, 0 fail/skip/cancel**, Node v22.23.3, duration 9402.9 ms. Лог: `acceptance-runtime/tests-postformat.log`. SHA guard сразу после прогона: `sources=[]`, `fixtures=[]` (`stability.json`). Никаких production edits со стороны аудитора; global check/build/browser/listeners/сеть не запускались.

- Postformat manifest: `acceptance-runtime/snapshot/manifest.json`, timestamp `2026-10-21T11:19:23.440413+00:00`; SHA256 `2f788314e38aafeb702e01be7b4d062e23e77f5fd633fab43f080e6aec21d770`.
- Preformat snapshot и отчёт сохранены отдельно: `snapshot-preformat/`, `report-preformat.md`, `stability-preformat.json`; прежние logs не подменяют новый прогон.
- Изменилось 25 из ранее отслеженных source/test/instruction файлов; полный список `postformat-delta.json`. Это инвентаризация SHA, не самостоятельное доказательство семантической эквивалентности formatter.
- Hashes всех пяти external fixtures совпали с preformat, assertions не менялись.
- D08/D09 по-прежнему PASS; functional pin/task + origin-bound toast и stale text/pinned/deleted message проверки PASS. Открытых подтверждённых findings в проверенном bounded runtime scope нет.
- Package/lock/version и docs вне AGENTS не входят в этот guard. Это не Windows/E2E и не общая сертификация приложения.

### Current postformat SHA-256

```text
0ed7584c70b48f1de893c1878d5070b6079bb949106e33f46def6dba41d1d1f4  src/agent/engine.ts
e78bfa263a6662f0292c88cce383b0b03c28a0eb448369a95cd5402c890744db  src/agent/queue.ts
dcc5cb9cfe21e3b3ea4e0ea0f89d6d35e9d1e7dd48854ed9f18b6714f3b5dac6  src/agent/live.ts
e1912f8830042b1d5cb7e6a9098bc717369d0d7764c21ba9af26e5a80c5b36a3  src/agent/loop.ts
90389ed0ffc98bec325bf942ec1d22c6956d155061829ca908de8a795a149c8a  src/agent/commands.ts
28ff8b05e1b0ea28d1cdc0c361063784bc6b43b8c3f841f3f698b39eec3e1fd7  src/workspace/AgentTurn.tsx
41847cbda2e0f30e0b31a2ef1f1074499825317a5f897a2a6ffaae1721c514ad  src/workspace/ChatView.tsx
eea8c03bff7e0b56d5a253c5cd33b0091a92d536a4df5442764420b1346e342f  src/workspace/Composer.tsx
72d5fa214cfe5f681d66be1de247432f2bc8d6a07075dfcdb03e4d8ba8461271  src/lib/chatDraft.ts
cc38649408ede470f62bdcb6269ad8e5c4bf201d46412a559a19b9a7c2f9f317  src/store/navigation.ts
```

## Сохранённая история preformat приёмки

Новый bounded scope runtime isolation; прежние 25/172 НЕ использованы. Production READ ONLY. После explicit owner STOP и parent pause formatter повторены **те же 22 desired fixtures: 22/22 PASS** (`acceptance-runtime/tests-fixed.log`). Добавлены две узкие positive/CAS проверки, затем единый текущий прогон **24/24 PASS** (`tests-fixed-all.log`), Node v22.23.3. SHA guard: sources=[], fixtures=[]. 319 source/test/instruction файлов в `snapshot/manifest.json`, timestamp 2026-10-21T11:16:34.659488+00:00. Это pre-global-format acceptance.

### Независимая приёмка минимального fix R01

- Изменённые source/test между pre-fix RED22 и fixed24: src/lib/chatDraft.test.ts (owner regression tests), src/workspace/ChatView.tsx. Единственный production delta — ChatView.tsx.
- ChatView current SHA: `41847cbda2e0f30e0b31a2ef1f1074499825317a5f897a2a6ffaae1721c514ad`; совпадает с explicit handoff.
- Actual source :477–484 проверяет captured current target, существующее human message и exact text; :494–500 saveTask explicit pid, :515–522 delayed toast target/task guard; :544–547 pin CAS по исходному pinned + explicit pid.
- D08/D09 прошли **без изменения desired fixtures**, hashes runtime-ui/engine совпадают с pre-fix manifest. Pre-fix RED22 сохранён в tests-final.log, прежний отчёт в report-prefixed.md.
- P01 доказал, что valid pin и создание задачи работают в A, B неизменён, toast не открывает чужую B задачу, возврат в A допускает свой action.
- P02 доказал отказ при stale pinned/text и удалённом сообщении. Initial P01 fixture ошибочно выбирал seeded sys-message; исправлен selection по реальному human id. Это только mock/fixture correction, не production defect и не ослабление assertions.
- **Открытых подтверждённых findings в этом bounded runtime scope не осталось.** Это не общая сертификация приложения/Windows/сети/всего UI.

Current authoritative source SHA — manifest. До fix независимо было 20/22 PASS с двумя проявлениями R01; ниже оставлено точное pre-fix evidence, не current failure.

## R01 — MEDIUM — исправлено и независимо перепроверено (ниже pre-fix evidence)

**Пути:** `src/workspace/ChatView.tsx:477–495` (task), `:515` (pin). `MsgActions` получает captured `pid`, но эти два пути его не используют: `patchMsg(chatId,m.id,patch)` и `saveTask(task)` разрешают implicit selected project. Quote рядом (:463–475) уже имеет текущий target guard и передаёт pid.

**Текущее evidence:** D08/D09 в `tests-final.log`; desired assertions оставлены красными. Fixture использует реальные chatsActions/projectsActions/tasksActions с Immer, настоящий duplicateProject (historical chat/message ID сохраняются), actual transpiled MsgActions JSX callbacks, inert React hooks. Создать A, скопировать в B, сохранить A callback, выбрать B, вызвать сохранённый callback:
- D08: B message с тем же ID получает `pinned: true`, вместо неизменных B messages.
- D09: B.tasks из [] превращается в задачу с title `benign A task text`, вместо неизменного массива.

Без файловой записи/команд/сети; только benign in-memory state. Это доказательство callback-origin нарушения, **не** утверждение о гарантированной browser event reachability при любом ordering. Remount keys проверены отдельно, но не делают уже полученный callback origin-bound. Нарушен явный invariant AGENTS.md: callback хранит pid, совпадающий ID в клоне не является исходным объектом.

**Предлагаемый bounded fix:** pin передать captured pid (или отклонить stale target), task перед записью проверить актуальный captured target и существование исходного сообщения; если API поддерживает explicit pid — использовать его. Отложенное toast action открытия созданной задачи тоже привязать/проверить pid. Не remap ID и не менять clone semantics. Production нами не менялся.

## Что независимо прошло (20 cases)

- I01–I11: tuple queue/generations/legacy bucket, независимые controller/stop для одинакового chat ID, late output и delayed dequeue, live cleanup, full tuple retry/ambiguous stop, stale approval/reject/revert, actual loop stale-before cancellation, отсутствующий explicit send origin.
- D01–D07: реальные clone/draft actions, legacy preservation и intentional empty, navigation origin guard/focus detail, Composer stale setter/send, quote isolation, все проверенные AgentTurn apply/reject/revert/retry/stop callback arguments, commands queue/draft/send opts sixth.
- D10/D11: actual ChatView composer/agent remount keys и pid; RetryBtn captured origin и sixth send argument.

Manual A turn, продолжающийся при выбранном B, допустим: проверяется отсутствие B contamination, а не произвольная отмена. Loop намеренно single-selected-project; foreign loop operations не затрагивают текущую сессию.

## Reported vs verified / ограничения

Owner agent report заявляет 154 scoped PASS; domain report 34. Эти цифры — owner evidence, НЕ наши запуски и не суммируются с 22. Agent/queue/controller/retry/approval и draft/quote contracts независимо прошли приведённые tests, R01 затем исправлен и независимо закрыт, как указано выше; whole UI вне перечисленного bounded scope не сертифицируется. Не запускались global check/build/prettier, server/listeners, browser, сеть, Windows runtime или внешние команды. Stubs provider/backend/hooks означают component acceptance, не Windows/E2E certification.

Во время первого ожидания среда откатилась и первоначальные logs/snapshot исчезли. Исторические промежуточные 18/22 не выданы за current proof: fixtures восстановлены, повторно выполнены 20 и затем все 22 с новым manifest. В собственных fixtures исправлены resolveDir внешнего harness, неверное требование reference equality непустой queue (данные не изменились) и closed CmdCard mock для доступа к retry. Desired production safety assertions НЕ ослаблялись.

## SHA-256 pre-fix snapshot (историческое evidence R01)

```text
ce8804921c70201ecab1e498ddb3c60077a3c326b0c84255eafd5ff7d4cb3973  src/agent/engine.ts
ee4a3ff7b98b1e276111df626a2ecbfc40742d9a8846e936cd7f2f6fb6f9a27f  src/agent/queue.ts
02c1d51a254b2a9d3ecf9ed87c6d663d495bb0e13f602d230dfab18d58b25c7a  src/agent/live.ts
9af4d4db03cc79546bf2823aedd0e6b8c73ac217526b8d5b71a8cb14e3257e43  src/agent/loop.ts
73165c229ba516769a52cf4ef99d13d80768e6e90b4320db7f3d3a0bca6efc53  src/agent/commands.ts
f62e688200a6a902853067415b37efeca42e45316fa9c429f6224ba17a4304b6  src/workspace/AgentTurn.tsx
41b5319390165db105e8ef4135ae015b3a6f4a83ed92b6c35738b3d8454a4b9d  src/workspace/ChatView.tsx
eea8c03bff7e0b56d5a253c5cd33b0091a92d536a4df5442764420b1346e342f  src/workspace/Composer.tsx
72d5fa214cfe5f681d66be1de247432f2bc8d6a07075dfcdb03e4d8ba8461271  src/lib/chatDraft.ts
cc38649408ede470f62bdcb6269ad8e5c4bf201d46412a559a19b9a7c2f9f317  src/store/navigation.ts
c1f1c764a02442de39e589faf9200c76a335da47246124d3c5c9a0bf58fdee57  src/store/slices/chats.ts
3901893e0a53fd66d397fcb955c92f870a79a8e9ca3e33c550d86b82a6c7447a  src/store/slices/tasks.ts
```

Все остальные source и fixture SHA — в manifest. При последующем formatter нужно повторить exact fixtures на новом snapshot; этот отчёт не доказывает будущие bytes. Никаких production edits/push этим аудитом не сделано.


## SHA current fixed scope

```text
ce8804921c70201ecab1e498ddb3c60077a3c326b0c84255eafd5ff7d4cb3973  src/agent/engine.ts
ee4a3ff7b98b1e276111df626a2ecbfc40742d9a8846e936cd7f2f6fb6f9a27f  src/agent/queue.ts
02c1d51a254b2a9d3ecf9ed87c6d663d495bb0e13f602d230dfab18d58b25c7a  src/agent/live.ts
9af4d4db03cc79546bf2823aedd0e6b8c73ac217526b8d5b71a8cb14e3257e43  src/agent/loop.ts
73165c229ba516769a52cf4ef99d13d80768e6e90b4320db7f3d3a0bca6efc53  src/agent/commands.ts
f62e688200a6a902853067415b37efeca42e45316fa9c429f6224ba17a4304b6  src/workspace/AgentTurn.tsx
41847cbda2e0f30e0b31a2ef1f1074499825317a5f897a2a6ffaae1721c514ad  src/workspace/ChatView.tsx
eea8c03bff7e0b56d5a253c5cd33b0091a92d536a4df5442764420b1346e342f  src/workspace/Composer.tsx
72d5fa214cfe5f681d66be1de247432f2bc8d6a07075dfcdb03e4d8ba8461271  src/lib/chatDraft.ts
cc38649408ede470f62bdcb6269ad8e5c4bf201d46412a559a19b9a7c2f9f317  src/store/navigation.ts
```
