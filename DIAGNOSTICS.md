# Mac Hardware Diagnostics — 2.0.0-rc4 / Bootstrap 1.2

```bash
curl -fL https://raw.githubusercontent.com/pioner22/MacOS/main/st.sh | bash
```

Сначала определяется работающая система, оборудование и возможности, затем профиль и меню. Первый запуск — **14 SELFTEST** (проверяет ПО, не железо). Recovery без компилятора сохраняет ограниченные Perl-сценарии; готовых нативных Mac-бинарников пока нет.

**RAW 1/13 заблокирован.** 16 — комплекс без стирания разделов, 17 — новый тестовый файл после согласия, 18 — отдельный 40-GiB bridge на внешний RESCUE, 19 — локальная очищенная обратная связь. Полный каталог журналов храните приватно.

rc4 исправляет учёт прерванных этапов, неполное RAM-покрытие, сетевые статусы, канонизацию целевого тома, строгий descriptor и отчёты. PASS самопроверки не подтверждает оборудование. RAM с уменьшенным планом — INCONCLUSIVE. Предыдущий FAIL не исчезает после прерывания; состояние исполнения сохраняется отдельно.

[Изменения и оставшиеся ограничения RU/EN](docs/diagnostics/RC4_REVIEW_FIXES.md) · [177 программных проверок](docs/diagnostics/QA_RESULTS.md) · [Архитектура Recovery](docs/diagnostics/RECOVERY_PRODUCT_RU.md)

## English

The launcher detects actual hardware, running environment and capabilities before presenting its profile and menu. Recovery may only support limited screening; clean screening is not full RAM/storage acceptance. Start with toolkit SELFTEST 14. RAW remains blocked. See the rc4 release note for changed network/coverage semantics, signal handling, consented file tests and residual limitations. Linux QA is not real-Mac validation. Offline copy: `bash st.sh --offline selftest`.
