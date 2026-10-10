---
description: Выпустить версию TetraFree (changelog, версии, проверки)
argument-hint: <X.Y.Z> <название>
---
Выпусти версию $ARGUMENTS по разделу «Релиз» из AGENTS.md:
1. Подними версию в package.json, package-lock.json, src-tauri/tauri.conf.json, src-tauri/Cargo.toml.
2. Добавь запись сверху в RELEASES (src/data/changelog.ts): kind `patch` для исправлений, `logic` для новых функций; пункты только `new | imp | fix`, пиши для пользователя.
3. Добавь раздел в CHANGELOG.md и допиши строку «Выпущено» в ROADMAP.md.
4. `npx prettier --write src server scripts && npm run check && npm run build` — всё должно пройти.
5. Коротко отчитайся: что изменилось, что не проверено. Тег `vX.Y.Z` поставит человек.
