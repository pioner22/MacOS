# Mac Hardware Diagnostics — 2.0.0-rc9 / Bootstrap 1.4

## Русский

Постоянная команда:

```bash
curl -fL https://raw.githubusercontent.com/pioner22/MacOS/main/st.sh | bash
```

Один проверенный immutable-пакет → наблюдение фактической среды → реестр и пробы инструментов → профиль и доступность → меню. Новый пункт **21 COMPATIBILITY** сохраняет паспорт/план без аппаратных тестов. **14 SELFTEST** проверяет комплект, не железо. **15** редактирует ограничивающий профиль и возвращается в меню. Остальные пункты выполняют один сеанс, сохраняют отчёт и завершаются; автоматического повторения нагрузки нет.

**20 READ ONLY** — чтение HDD/SSD без записи тестовых данных. **17** создаёт отдельный тестовый файл после согласия. **18** — отдельно разрешаемый 40-GiB bridge. **1/13** остаются BLOCKED. **16 POST-REPAIR** не является единственным основанием аппаратной приёмки. Recovery без компилятора имеет только доступные ограниченные сценарии; готовые проверенные нативные Recovery-бинарники ещё не поставляются.

Реестр содержит 13 документальных записей устройств (11 идентификаторов), 9 приоритетных шаблонов и 12 контрактов возможностей. Это не исчерпывающая база всех Mac/ОС. Год не определяет Bash; неоднозначные правила не открывают нагрузку. На целевой машине для реестра не нужны Python/jq/JSON::PP. Память, том, права и согласие перепроверяются при запуске этапа.

[Аудит и исправления rc9](docs/diagnostics/RC9_QA.md) · [Исправление тайм-аутов rc8](docs/diagnostics/RC8_PROBE_TIMEOUT_RU.md) · [Проверки rc8](docs/diagnostics/RC8_QA.md) · [Реестр и ограничения](docs/diagnostics/RC7_REGISTRY_RU.md) · [Read-only режим](docs/diagnostics/RC6_READONLY_HDD.md)

## English

The stable launcher selects one verified release. Live facts and capability probes feed the integrated registry before the menu. Option 21 records compatibility only; 14 checks software; 15 edits the profile and returns to the menu. One test/suite selection ends in a report and exit. No new heavy workload, automatic upload or destructive RAW mode is enabled. Native Recovery binary distribution and actual Mac validation remain pending. [rc9 audit and fixes](docs/diagnostics/RC9_QA.md) · [rc8 probe timeout fix](docs/diagnostics/RC8_PROBE_TIMEOUT_EN.md) · [Registry](docs/diagnostics/RC7_REGISTRY_EN.md) · [Validation](docs/diagnostics/RC8_QA.md).
