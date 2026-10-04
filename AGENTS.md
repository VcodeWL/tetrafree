# TetraFree — инструкция для ИИ-агентов и разработчиков

Десктопное Windows-приложение «совместная разработка с ИИ-агентами». Только Windows 10/11, только русский язык. Это не демо: никаких заглушек, вымышленных данных и «симуляций» — если что-то нельзя сделать по-настоящему, этого нет в интерфейсе.

## Стек и карта репозитория
- `src/` — React 18 + TypeScript (strict) + Vite 5. Состояние: zustand + immer + persist (localStorage), `src/store/`. Режим «Дизайн» — `src/design/`. Агент — `src/agent/` (`engine.ts`, `llm.ts`, `ci.ts`, `prompt.ts`).
- `server/*.mjs` — локальный Node-сервер (файлы, git, shell, PTY, аккаунты, почта, бэкапы, хранилище ключей `secrets.mjs`, ConPTY-помощник `conpty-win.mjs`). Без внешних зависимостей.
- `src-tauri/` — оболочка Tauri 2 (Rust): запуск сервера через sidecar `node`, трей/автозапуск/хоткей (фича `extras`), автообновление (фича `updater`).
- `.github/workflows/` — `ci.yml` (проверки) и `release.yml` (сборка установщика, подпись, GitHub Release, `latest.json` для автообновления).
- `docs/TEST_PROMPT.md` — промпт для ИИ-тестировщика на Windows. `scripts/fake-llm.mjs` — поддельная модель для проверки агента без ключа.

## Команды
```
npm ci                # ставит зависимости и раскладывает картинки из binary-assets/ (postinstall)
npm run dev           # http://127.0.0.1:3000 (сервер встроен)
npm run check         # tsc + eslint + prettier --check + все тесты — обязательно зелёным перед коммитом
npm run build
npm run desktop:build:full   # установщик с автообновлением (см. release.yml)
```

## Правила
1. Перед коммитом: `npx prettier --write src server scripts`, затем `npm run check`.
2. Не добавляй мок-данные, демо-режимы, «симуляции» и заглушки. Не пиши «TODO» вместо реализации.
3. Версии: `x.y.Z` — исправления, `x.Y.0` — новые функции, `X.0.0` — крупная переработка. Новая версия = запись сверху в `src/data/changelog.ts` (в стиле Steam) + `CHANGELOG.md` + номер в `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `package-lock.json`.
4. Новый модуль в `server/`, импортируемый из другого — обязательно добавь в `bundle.resources` (`src-tauri/tauri.conf.json`); тест `server/bundle.test.mjs` это проверяет.
5. Интерфейс на русском, доступность (axe) без нарушений, учитывай «Меньше анимации» (`html.reduced`).
6. Новый CSS — в конец `src/styles/app.css`; `components.css` грузится позже и может переопределять.
7. Ключи API не пишутся в localStorage, логи и бэкапы (`src/lib/vault.ts`, `server/secrets.mjs`). Единственное исключение — сервер недоступен: тогда ключ остаётся в localStorage, пока хранилище не ответит, и сразу уходит в него.
8. Картинки хранятся как base64 в `binary-assets/`; после замены файла выполни `node scripts/restore-binaries.mjs --pack`.
9. Честность: если что-то не удалось проверить (нет Windows, Rust, ключа), пиши это явно в описании PR и в changelog.

## Известные ограничения
Не проверено на реальной Windows: ConPTY-помощник на C#, DPAPI через PowerShell, sidecar Node, трей/автозапуск/хоткей, автообновление. Установщик не подписан сертификатом (SmartScreen). CSP в Tauri выключен (мешает превью в режиме «Дизайн»).
