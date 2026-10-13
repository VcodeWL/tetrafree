# Зависимости — npm audit

Проверка: 2026-10-13. Выполнен `npm audit --json`, exit 1: обнаружены 2 затронутых пакета, не 2 доказанные эксплуатационные цепочки. **Это dev dependencies**: Vite dev server не используется как сервер установленного Tauri bundle. Риск относится к разработке/preview и не должен автоматически приписываться каждому Windows установщику.

## DEP-01 — esbuild, moderate

Affected range: `<=0.24.2`. Прямой dependency: False.

- [esbuild enables any website to send any requests to the development server and read the response](https://github.com/advisories/GHSA-67mh-4wv8-2f99)

Рекомендация: перейти на поддерживаемую версию вне affected range, совместимую с React plugin, Node и Tauri; затем полный check/build/dev smoke. Не применять `npm audit fix --force` вслепую: предлагается major migration. Не открывать dev server внешней сети.

## DEP-02 — vite, high

Affected range: `<=6.4.2`. Прямой dependency: True.

- [Vite Vulnerable to Path Traversal in Optimized Deps `.map` Handling](https://github.com/advisories/GHSA-4w7w-66w2-5vf9)
- [launch-editor: NTLMv2 hash disclosure via UNC path handling on Windows](https://github.com/advisories/GHSA-v6wh-96g9-6wx3)
- [vite: `server.fs.deny` bypass on Windows alternate paths](https://github.com/advisories/GHSA-fx2h-pf6j-xcff)

Рекомендация: перейти на поддерживаемую версию вне affected range, совместимую с React plugin, Node и Tauri; затем полный check/build/dev smoke. Не применять `npm audit fix --force` вслепую: предлагается major migration. Не открывать dev server внешней сети.

