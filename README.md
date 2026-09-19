# Yagodka macOS Client

macOS/Electron клиент Ягодки. Репозиторий содержит desktop shell, update feed tooling и общий web runtime, который пакуется в приложение.

## Что внутри

- `src/`, `public/`, `scripts/` - общий клиентский UI/runtime и сборка web assets.
- `desktop/` - Electron main/preload runtime.
- `electron-builder.json` - конфигурация desktop сборки.
- `build/` - macOS entitlements.
- `test/` - web + desktop/Electron regression tests.

## Локальная разработка

```bash
npm install
npm run dev
```

Во втором терминале:

```bash
npm run desktop:dev
```

## Проверки и сборка

```bash
npm run typecheck
npm run test
npm run desktop:build
```

Unsigned macOS ZIP и update feed для тестирования:

```bash
npm run desktop:dist:mac:unsigned
```

## Auto-update

Desktop auto-update использует `electron-updater` и generic feed. Production feed по умолчанию:

```text
https://yagodka.org/desktop-updates/mac/
```

Перед публичным signed release нужны Apple signing/notarization secrets. Они не хранятся в репозитории.

## MacBook Hardware Diagnostics — 0.3.0-rc1

Исправленный экспериментальный диагностический пакет RU/EN для приёмки Intel Mac после ремонта. Нативные тесты требуют полной macOS и установленных Command Line Tools; Recovery поддерживается ограниченно. Реальная macOS/Metal в текущей проверке не подтверждена.

```bash
curl -fL https://raw.githubusercontent.com/pioner22/MacOS/main/st.sh | bash
```

**Пункт 16 — приёмка после ремонта.** Пункт 15 — модель и загруженная ОС. Пакет загружается по закреплённому commit с проверкой размера/SHA-256 всех модулей.

**Внимание к изменению поведения:** активные SSD/HDD и Full Suite больше не используют разрушительный RAW-движок. Вместо этого создаётся отдельный новый тестовый файл с явным подтверждением. Это не проверка всего SSD. Старые `mhdd_v2.part*` не вызываются новыми точками входа и не объявлены проверенными.

RAM Quick/Full/Map используют новый нативный C-тестер, Full включает 134 шаблона и адаптивный объём. RAM, файловый I/O, GPU, сеть и скачивание имеют отдельные результаты. Неполный тест, ошибка среды или отсутствие Release-эталонов не превращаются в общий PASS. Автоматическая приёмка требует отдельного ручного списка и повторного запуска после выключения.

Проверено локально: **79 регрессионных тестов**, C AddressSanitizer/UndefinedBehaviorSanitizer на малых объёмах. Это не аппаратный PASS Mac. GitHub CI запускался, но jobs завершились до выполнения steps: подробности в [CI_STATUS.md](docs/diagnostics/CI_STATUS.md).

[Руководство](DIAGNOSTICS.md) · [Приёмка RU/EN](docs/diagnostics/POST_REPAIR_RU_EN.md) · [Состояния](RESULT_STATES_RU_EN.md) · [Фактическая проверка](docs/diagnostics/QA_RESULTS_0_3.md).

## License

GPL-3.0-or-later. См. `LICENSE`.
