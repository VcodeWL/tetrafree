<p align="center">
  <img src="public/logo.png" alt="TetraFree" width="96" />
</p>

<h1 align="center">TetraFree</h1>
<p align="center">Десктопное приложение для совместной разработки с ИИ-агентами.</p>

<p align="center">
  <a href="https://github.com/VcodeWL/tetrafree/releases/latest"><img alt="Релиз" src="https://img.shields.io/github/v/release/VcodeWL/tetrafree?style=flat-square" /></a>
  <a href="https://github.com/VcodeWL/tetrafree/actions"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/VcodeWL/tetrafree/ci.yml?style=flat-square&label=CI" /></a>
</p>

---

### Установка

Скачай установщик для Windows на странице [Releases](https://github.com/VcodeWL/tetrafree/releases/latest) и запусти. Обновления приходят сами.

> Установщик пока без подписи — Windows может показать предупреждение SmartScreen («Подробнее → Выполнить в любом случае»).

### Что внутри

- **Агенты.** Чаты с агентами, которые пишут и правят файлы, запускают команды и сами проверяют результат. Свои провайдеры: Anthropic, OpenAI, любой OpenAI-совместимый API, Ollama.
- **Проект на диске.** Настоящая папка, настоящий терминал, настоящий git. Версии с диффами и откатом на каждый ход агента.
- **Слэш-команды и навыки.** `/loop`, `/match`, `/autopilot`, `/audit`, свои команды и навыки в `.tetra/`. → [docs/SLASH.md](docs/SLASH.md)
- **Автоматизации.** «Когда X — сделай Y»: по расписанию, при правках, при смене статуса задачи. → [docs/AUTOMATIONS.md](docs/AUTOMATIONS.md)
- **Расширения.** MCP-серверы и каталог навыков, команд и наборов в один клик.
- **Режим дизайна.** Страницы на холсте и библиотека компонентов shadcn/ui, Magic UI, React Bits. → [docs/COMPONENTS.md](docs/COMPONENTS.md)
- **Команда.** Участники, общие задачи, документы, расходы и деплой.

### Быстрый старт

1. Зарегистрируйся или войди.
2. «Настройки → Провайдеры» — добавь ключ модели.
3. «Новый проект» — выбери папку и напиши агенту, что сделать. Набери `/`, чтобы увидеть команды.

`Ctrl K` — палитра команд, `Ctrl /` — все сочетания клавиш.

### Разработка

```bash
npm install
npm run dev            # http://localhost:3000, сервер встроен
npm run check          # типы, линтер, тесты
npm run desktop:dev    # окно Tauri (нужен Rust)
npm run desktop:build  # установщик
```

React 18, TypeScript, Vite, zustand, Tauri 2; сервер — Node без зависимостей.

### Документация

[Подробности и безопасность](docs/DETAILS.md) · [Архитектура](ARCHITECTURE.md) · [Инструкции для агентов](AGENTS.md) · [Дорожная карта](ROADMAP.md) · [Список изменений](CHANGELOG.md)

### Если что-то не работает

Приложение пишет лог в `%USERPROFILE%\TetraFree\server.log`. Приложите его к [issue](https://github.com/VcodeWL/tetrafree/issues).
