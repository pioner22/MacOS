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

## MacBook Hardware Diagnostics — 2.0.0-rc2

Отдельный RU/EN диагностический комплекс для приёмки после ремонта. Активная реализация: `diagnostics_v2/`. Постоянная команда запуска текущего опубликованного пакета:

```bash
curl -fL https://raw.githubusercontent.com/pioner22/MacOS/main/st.sh | bash
```

Пункт 14 — self-test файлов комплекта, 15 — модель и загруженная ОС, 16 — приёмка без стирания, 17 — новый тестовый файл 1 GiB, 18 — отдельный 40-GiB RAM→внешний RESCUE. RAM/CPU/Metal/файловые тесты требуют полной Intel macOS и инструментов сборки. Наличие меню не доказывает поддержку всех версий Recovery.

**Старые разрушительные пункты 1/13 и ssd_test.sh заблокированы.** Не собирайте legacy mhdd_v2.part* вручную. Файловый тест не проверяет весь физический SSD. Сведения о питании не выдаются за аппаратный PASS. Чистые автоматические стадии требуют независимой и ручной приёмки.

Журналы включают `REPORT_RU_EN.md`, `summary.tsv`, результаты отдельных стадий; незапущенные этапы отмечаются NOT_RUN. Отсутствие remote fixture, ресурсов или компилятора — ограничение проверки, не доказательство неисправной микросхемы. Dedicated Release диагностических сетевых файлов остаётся отдельной задачей; неполное покрытие не превращается в PASS.

Подробности: [DIAGNOSTICS.md](DIAGNOSTICS.md), [единый выпуск rc2](docs/diagnostics/UNIFIED_RC2.md), [реальные программные проверки](docs/diagnostics/QA_RESULTS.md).

## License

GPL-3.0-or-later. См. `LICENSE`.
