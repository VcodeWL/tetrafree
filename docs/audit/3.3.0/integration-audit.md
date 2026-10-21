# Independent parent-integration acceptance

**Итог: активных подтверждённых findings в проверенном срезе нет. 17/17 scoped checks PASS.** Production/repo tests не изменялись. Приёмка parent integration написана отдельными внешними fixtures; прежние author builder/component test suites не переиспользовались и не перезапускались.

## Проверенные стыки

- `src/lib/diagnosticSnapshot.ts:9–38` → настоящий builder/serializer: synthetic private markers находятся в project names/paths/IDs, provider key/URL, backend base/root/shell/error и journal/context полях. Ни preview/export, ни whitelist adapter не отражают эти поля. Getter на file content не вызывается, учитываются только имена ключей для количества. Реальные bytes не заявляются; durability/checks остаются not_checked; unknown pending count не превращается в ноль. Недоступная history остаётся unknown/null.
- `sync` передаётся семью явно выбранными полями, без projectId/lastDiskCheckAt/context; confirmed project checkpoint не повышает общую durability и checks.sync. Произвольные backend version/platform strings отсекаются на настоящей export boundary.
- `src/modals/ModalRoot.tsx:98–99`: lazy DiagnosticsModal получает именно parent captureDiagnostics. Доступен и без workspace/project. Сам root не собирает/не копирует данные до mount выбранного окна.
- Полная controlled цепочка parent collector → lazy ModalRoot → настоящая DiagnosticsModal → preview/copy/download: нет mount-time clipboard/download; explicit copy и download получают **точно показанный JSON**, без повторного чтения live snapshot. Все clipboard/download dependencies — безопасные mocks; fetch в исполняемых fixtures запрещён.
- `src/modals/Settings.tsx:1244,1375`: старой функции diagnostics и raw-copy action больше нет. Оба новых diagnostic callback исполнялись отдельно: только openModal({type:'diagnostics'}), без автоматической копии или toast «скопировано». Исторический D01 legacy raw-export path закрыт в проверенной Settings integration; это не доказательство отсутствия всех возможных экспортов в приложении.
- `src/components/TitleBar.tsx:84–105`: настоящий SyncPill с реальной syncHealthLabel не превращает unchecked disk + confirmed project checkpoint в disk success. Cloud live отображается как соединение с явной оговоркой, что доставка всех правок не подтверждена.
- `src/modals/Settings.tsx:1040–1050,1212–1241`: настоящий BackendSection с offline health после успешного checkpoint/retry показывает «нет связи», а не совпадение диска; toast остаётся checkpoint-only, с оговоркой об облаке. Внешние эффекты загрузки редакторов/backup не выполнялись — это status/callback fixture, не аудит их реализации.
- `src/lib/search.ts:30–39` и 4 новых `search.test.ts`: чужой активный pid с теми же object IDs, удалённые targets, изменённый source file не открываются; unchanged results сохраняют обычную навигацию. По коду doc/task/chat/memory повторно проверяются в текущем исходном проекте на наличие query. Это навигационные guards, не обещание идентичности всех полей объекта после delete/recreate.
- `src/workspace/AgentTurn.tsx`: actual RetryBtn читает chat исходного pid и передаёт opts.pid **шестым** аргументом sendMessage, с массивом attachments третьим. Actual file apply/reject, command stop/retry, TurnBar apply-all/reject-all/revert сохраняют исходный pid в соответствующих позициях API; stale file path click и replay/diff не открывают чужой активный проект. `src/workspace/ChatView.tsx:573` pid prop и ключ [pid,m.id] проверены по JSX source. Это проверка UI propagation, не повторная приёмка engine/native write authorization или параллельного token-ABA ремонта.

## Исправленные во время review наблюдения

При первом чтении adapter содержал b.local вместо b.info?.local, теряя это поле до null. В **протестированном финальном срезе** уже b.info?.local; independent desired regression с actual info.local=true проходит. В окончательном AgentTurn также уже корректная шестая позиция opts.pid. Эти промежуточные строки не перечисляются как активные findings.

## Артефакты и воспроизведение

```
node --test /data/audit-next-tetrafree/integration-audit/acceptance.test.cjs
TSX_DISABLE_CACHE=1 node_modules/.bin/tsx --test src/lib/search.test.ts
```

- Новые независимые external fixtures: **13/13 PASS** (`external-tests.log`).
- Parent search regressions: **4/4 PASS** (`search-tests.log`).
- External test manifest: `/data/audit-next-tetrafree/integration-audit/test-manifest.txt`.
- Actual-source hashes: `integration-audit/tested-sources.sha256` (checked after tests); дополнительные просмотренные search/engine source hashes: `additional-reviewed-sources.sha256`. The engine hash is a point-in-time API-signature read, not ownership/freeze of the parallel author domain.

## Границы

Compiler/hook/output fixtures выполняют актуальные bodies с контролируемыми dependencies; они не являются браузерным mount/hydration/clipboard/native тестом. Реальные auth/network/clipboard/filesystem, all-state durability, native CAS и свежесть внутреннего sync observation здесь не доказывались. Aggregation и fixed output limits просмотрены, но отдельный performance benchmark/обход миллионов проектов не выполнялся. Никаких browser/server/listeners/global check/build/format/commit/push. Исходные отчёты и исторические witnesses не переписывались. Scope завершён, READ-ONLY STOP.
