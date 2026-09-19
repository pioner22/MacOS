# Mac Hardware Diagnostics — 2.0.0-rc2

## Русский

Одна активная реализация: `diagnostics_v2/`. Постоянный запуск:

```bash
curl -fL https://raw.githubusercontent.com/pioner22/MacOS/main/st.sh | bash
```

`st.sh` читает актуальный `diagnostics-release.tsv`, затем проверяет и запускает единый пакет по неизменяемой ревизии. Ожидаемая текущая строка: `RELEASE_VERSION=2.0.0-rc2`.

Сначала пункт **14 SELFTEST**, затем **16 POST-REPAIR** в полной Intel macOS с Command Line Tools. **1/13 и старый RAW-тест заблокированы**. Пункт **17** пишет только новый временный файл 1 GiB; **18** отдельно проверяет 40-GiB RAM→внешний RESCUE с согласием. Пункт **15** — модель и фактически загруженная ОС. Обязательное mlock не ослаблено. Отсутствие инструментов/ресурсов — INCONCLUSIVE, не аппаратный диагноз.

Результат: `REPORT_RU_EN.md`, `summary.tsv` и подробные логи в отдельном каталоге. Не выполненные этапы отображаются NOT_RUN. После Ctrl+C запуск останавливается; зависимые тесты после неполного/ошибочного RAM/CPU не стартуют. Чистые автоматические этапы не заменяют независимый тест и холодный повтор: остаётся PENDING_MANUAL.

- [Описание единого выпуска и ограничений](docs/diagnostics/UNIFIED_RC2.md)
- [Фактические 93 проверки](docs/diagnostics/QA_RESULTS.md)
- [Полный журнал](docs/diagnostics/qa-rc2-linux.log)
- [Базовая инструкция нативных движков](docs/diagnostics/POST_REPAIR_RU.md)
- [Состояния](RESULT_STATES_RU_EN.md)

## English

One active implementation; the permanent URL resolves the current release descriptor once and pins/verifies the complete package. Start with toolkit self-test (14); post-repair (16) needs full Intel macOS and Command Line Tools. RAW (1/13) stays quarantined, file mode (17) is non-destructive, bridge (18) requires separate consent. Reports distinguish unexecuted/incomplete/manual stages from PASS. Real macOS/Metal and the user's hardware remain to be validated.
