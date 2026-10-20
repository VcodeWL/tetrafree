# F04/F05 — отдельная перепроверка исправлений родителя

Дата: 2026-10-15, около 13:35 UTC. Исторический `/data/fix-tetrafree/reaudit-ui.md` не изменён этой задачей; его findings описывают предыдущий снимок кода.

## Изменения этой задачи

В проект добавлен **только** новый `src/modals/newProject.lifecycle.test.ts`. Production, package scripts, src/server и чужие тесты не изменялись. Путь добавлен в `/data/fix-tetrafree/parent-test-files.txt` без изменения package.json — родителю остаётся включить его в штатную test-команду.

## Статус

| Finding | Статус в проверенном scope | Проверенные production-ветви |
| --- | --- | --- |
| F04 | Исправление подтверждено исполняемыми regression tests | `NewProject.tsx:150–154`: null reconcile → warning + retry, без success; `NewProject.tsx:592–597`: аналогичный warning для смены папки |
| F05 | Исправление подтверждено для resolved clone после unmount и busy header | `NewProject.tsx:53–54,130–143`: mounted guard; `Modal.tsx:6,40,76–79`: ModalBusy provider → MHead disabled |
| F01–F03 | Не переаттестованы этой задачей; исправляет UIauthor | Production в этих областях не менялся мной |

### 9/9 regression tests PASS, без skip

1. Режим new: `reconcile === null` даёт warning, не false `ok`; локальная project-запись создаётся; retry использует её pid.
2. То же для open.
3. То же для clone.
4. ProjectFolder: null reconcile после смены пути даёт warning, не false `ok`, сохраняет retry с исходным project id.
5. Успешный поздний ответ clone после unmount не вызывает createProject/reconcile/close/toast.
6. Resolved `ok: false` после unmount также не вызывает их.
7. Positive control: mounted clone продолжает нормально создавать проект и выдавать sync success — guard не блокирует всё подряд.
8. Реальный Modal возвращает provider с busy=true; внутри него реальный MHead получает disabled=true, включая custom onClose.
9. Positive controls: idle provider и standalone MHead дают enabled close, обычный handler работает; значение context не протекает за scope provider.

Это **исправляющие regression assertions**, а не прежние characterization assertions, ожидавшие воспроизведение ошибок.

## Переносимость и границы проверки

- Исходники читаются через `readFileSync(new URL(relativePath, import.meta.url))`; нет зашитого `/data`, зависимости от cwd или ручных file:// путей. `C:/work/...` и `example.invalid` — только строки benign controlled fixtures, ОС/сеть к ним не обращаются.
- Настоящие NewProject/ProjectFolder/Modal/MHead транспилируются TypeScript и выполняются без переписывания их бизнес-логики. Store, hooks, createContext/useContext, timers, backend и reconcile контролируемые. Provider для MHead берётся из настоящего output Modal, а не из вручную заданного busy-флага.
- Это не React DOM/browser/Windows test. Никакие browser/server listeners не запускались. Disabled-проверка — свойство настоящего button output, не физический browser click; намеренно не вызывается raw handler у disabled button.
- Реальный git clone, транспортная отмена, disk failure и полный React scheduler не проверены. Набор не обещает подавления всех поздних callbacks: rejected bClone после unmount и catch/finally notifications/setState этим набором не аттестуются.
- `projectPathKey` здесь scoped dependency fixture; его настоящий null/undefined integration проверял родитель отдельно.

## Команды и результаты

```sh
cd /data/tetrafree
TSX_DISABLE_CACHE=1 node_modules/.bin/tsx --test src/modals/newProject.lifecycle.test.ts
node_modules/.bin/eslint src/modals/newProject.lifecycle.test.ts
```

- Новый regression: **9/9 PASS**.
- Повторный запуск того же файла с cwd `/data`, вне проекта: **9/9 PASS**.
- Scoped eslint единственного нового файла: **0 ошибок/предупреждений**.
- Scoped TypeScript compiler API: root только новый testfile, strict/options из tsconfig, `noEmit`, `incremental:false`: **0 diagnostics**. Это не общий project typecheck и не typecheck production, загружаемого строками в fixture.
- Prettier применён только к новому testfile; финальный повтор сообщил unchanged. Global check/build/lint/format не запускались. Commit/push не выполнялись.

Логи в `/data/fix-tetrafree/reaudit-ui/`:

- `newProject-production-tests.log`
- `newProject-production-portable-cwd.log`
- `newProject-production-eslint.log`
- `newProject-production-types.log`

## Проверенный снимок (SHA-256)

```text
65bfec21d2d422bab4fcf396913471ab7f5479e6c8b7b8065c60082d658573db  src/modals/NewProject.tsx
ee0fe6ca35017a807de364cc3adeb391b763cbd697f9b399149054c1fdfe8bf0  src/components/ui/Modal.tsx
36dcf14d38762aaea7fb2b1df0a8c9663fe260bba4a53c1d87cf6a0795994dc8  src/modals/newProject.lifecycle.test.ts
92abd48e6297f35d105a017368f5a931653d733b3bce47cd218696c11c79074b  historical reaudit-ui.md
```
