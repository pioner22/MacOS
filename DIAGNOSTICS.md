# Mac Hardware Diagnostics — 2.0.0-rc1

## Русский

Обновлённый комплекс для приёмки после ремонта: **пункт 16**. Полная Intel macOS и Command Line Tools нужны для нативных RAM/файловых/Metal проверок. Recovery и недоступные инструменты дают INCONCLUSIVE, а не аппаратный FAIL.

```bash
curl -fL https://raw.githubusercontent.com/pioner22/MacOS/main/st.sh | bash
```

Загрузчик проверяет закреплённый пакет исходников. Первоначальный st.sh остаётся доверенной точкой входа; для дополнительного контроля сначала сохраните и изучите его вместо исполнения прямо из pipe.

**Внимание:** старый разрушительный RAW-движок временно заблокирован в пунктах 1/13 и прямом ssd_test.sh. Старые mhdd_v2.part* сохранены только для анализа. Пункт 17 проверяет новый временный файл без перезаписи пользовательских файлов. Пункт 18 — отдельный 40-ГиБ RAM→RESCUE с согласием; в RAM Full он больше не включён.

Пункт 14 проверяет целостность и синтаксис комплекта, не исправность Mac. Пункт 15 — фактическая модель/загруженная ОС. Пункт 16 не выдаёт окончательную приёмку до ручной и независимой проверки.

- [Приёмка, изменения и ограничения](docs/diagnostics/POST_REPAIR_RU.md)
- [Фактические программные проверки](docs/diagnostics/QA_RESULTS.md)
- [Коды состояний](RESULT_STATES_RU_EN.md)

## English

Option **16** is the non-destructive post-repair workflow. Native RAM/file/Metal stages require full Intel macOS and Command Line Tools. Missing capabilities are INCONCLUSIVE, not hardware faults. Legacy destructive RAW entry points are quarantined. Option 17 verifies a new test file; option 18 is an independently authorized external bridge. Option 14 checks the toolkit, option 15 selects the observed model/running-OS profile. Automated stage success is not whole-machine certification.

[Scope and limitations](docs/diagnostics/POST_REPAIR_EN.md) · [Actual validation](docs/diagnostics/QA_RESULTS.md)
