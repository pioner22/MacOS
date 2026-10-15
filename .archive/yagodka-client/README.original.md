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

## MacBook Hardware Diagnostics — 2.0.0-rc3

Отдельный RU/EN комплекс с приоритетом Recovery без установленной ОС. Активная реализация: `diagnostics_v2/`. Постоянная команда:

```bash
curl -fL https://raw.githubusercontent.com/pioner22/MacOS/main/st.sh | bash
```

Сначала определяются аппаратная платформа, загруженная ОС/среда, консоль и работающие инструменты; затем выбирается и сохраняется профиль, после чего показывается меню. Recovery без компилятора использует ограниченные Perl-сценарии, если доступны их зависимости. Чистый ограниченный RAM/file screen — INCONCLUSIVE, не полный аппаратный PASS. Нативные большие проверки сохраняют обязательный mlock. Готовые проверенные Recovery-бинарники этим RC ещё не поставляются.

14 — self-test комплекта, 15 — профиль, 16 — адаптивная приёмка без стирания, 17 — новый тестовый файл, 18 — отдельный native 40-GiB RAM→RESCUE, 19 — локальный минимальный пакет обратной связи. Никаких автоматических отправок полных логов и встроенных upload-токенов.

**Старые разрушительные пункты 1/13 и ssd_test.sh заблокированы.** Не собирайте legacy mhdd_v2.part* вручную. Файловый тест не проверяет весь SSD; сведения о питании не являются аппаратным PASS. Приёмка требует независимой и ручной проверки.

Подробности: [DIAGNOSTICS.md](DIAGNOSTICS.md), [Recovery-first архитектура и обратная связь](docs/diagnostics/RECOVERY_PRODUCT_RU.md), [фактическая проверка rc3](docs/diagnostics/RC3_QA.md).

## License

GPL-3.0-or-later. См. `LICENSE`.
