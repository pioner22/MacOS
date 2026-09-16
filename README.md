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

## MacBook Hardware Diagnostics

В репозитории сохранён автономный двуязычный диагностический набор для Intel Mac / macOS Internet Recovery и полноценной macOS.

Постоянная команда запуска:

```bash
curl -L https://raw.githubusercontent.com/pioner22/MacOS/main/st.sh|bash
```

Меню включает:

- чистый SSD/HDD full-LBA test;
- RAM Quick;
- RAM Full Hardcore;
- RAM Map;
- CPU/Cache;
- GPU/VRAM + Metal verifier;
- Video/Display;
- Network DNS/TCP/TLS;
- Download Integrity;
- Power/Thermal;
- Hardware Snapshot;
- Safe Full Suite;
- Full Complex с RAM-gate перед destructive SSD.

Каждый тест выводит `PASS`, `FAIL` или `INCONCLUSIVE`, русское и английское объяснение результата и следующий рекомендуемый шаг.

### GitHub network fixtures

Для проверки сети подготовлен детерминированный набор файлов 1/8/32/128/512 MiB. Генератор: `tools/generate_network_fixtures.py`; эталоны: `network-fixtures.sha256` и `network-fixtures.tsv`; публикация: `.github/workflows/network-fixtures.yml` в Release `diagnostic-fixtures-v1`.

`DOWNLOAD TEST` использует эти файлы как основной источник. Если Release временно недоступен, тест автоматически переключается на публичные GitHub Release assets PowerShell/LLVM с опубликованными SHA-256.

Подробное описание, ограничения, коды ошибок и правила интерпретации: [`DIAGNOSTICS.md`](DIAGNOSTICS.md).

## License

GPL-3.0-or-later. См. `LICENSE`.
