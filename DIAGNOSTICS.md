# Mac Hardware Diagnostics — 2.0.0-rc3

## Русский

Основной сценарий — Terminal в Recovery без установленной ОС. Работа из полной macOS сохранена. Постоянная команда:

```bash
curl -fL https://raw.githubusercontent.com/pioner22/MacOS/main/st.sh | bash
```

Минимальный preflight → проверка неизменяемого пакета → фактическая модель/CPU/архитектура/ОС/среда → пробы инструментов → составной профиль → сохранение профиля → меню. Ожидаемая версия `RELEASE_VERSION=2.0.0-rc3`. Профили — правила выбора сценария, не сертификат совместимости.

Без компилятора Recovery получает ограниченные Perl-сценарии при наличии работающих зависимостей: RAM quick до 256 МиБ, extended до 1 ГиБ; новый файл до 256 МиБ; уменьшенная CPU/SHA нагрузка и сетевые проверки. Чистый RAM/file screen остаётся INCONCLUSIVE с объяснением ограничений, а не полным аппаратным PASS. Большой нативный тест требует совместимого toolchain и успешного mlock. Готовые проверенные macOS/Recovery-бинарники пока не поставляются.

14 — SELFTEST; 15 — профиль; 16 — адаптивный комплекс без стирания; 17 — отдельный новый файл; 18 — отдельный native RAM→RESCUE 40 ГиБ с согласием; 19 — локальный минимальный пакет обратной связи, БЕЗ отправки. 1/13 и legacy RAW остаются заблокированы. SAFE 12 не запускает файловую запись или extended RAM.

Профиль/пробы/инструменты сохраняются до меню. `REPORT_RU_EN.md`, `summary.tsv`, `environment.tsv`, `capabilities.tsv`, `probes.log` и журналы движков находятся в каталоге сеанса. Recovery /tmp может исчезнуть после перезагрузки: сохраняйте на смонтированный внешний том. Автоматического форматирования и публикации полных логов нет.

[Архитектура, профили, качество и обратная связь](docs/diagnostics/RECOVERY_PRODUCT_RU.md) · [Фактическая проверка rc3](docs/diagnostics/RC3_QA.md)

## English

Recovery is the primary scenario, with full macOS retained. Detection and tool probes precede profile selection and the diagnostic menu. Limited Perl RAM/file screening is explicitly INCONCLUSIVE, not native/full hardware acceptance. Native prebuilt Recovery binaries are not yet supplied. Legacy RAW stays blocked. Option 19 produces a reviewed local metadata/issue-draft package and never uploads raw logs or credentials.

[Architecture and limits](docs/diagnostics/RECOVERY_PRODUCT_EN.md) · [Actual QA](docs/diagnostics/RC3_QA.md)
