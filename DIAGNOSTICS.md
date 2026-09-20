# Mac Hardware Diagnostics — 2.0.0-rc5 / Bootstrap 1.2

```bash
curl -fL https://raw.githubusercontent.com/pioner22/MacOS/main/st.sh | bash
```

Сначала определяются загруженная система, оборудование и работоспособность инструментов; затем выводятся профиль и меню. Первый запуск — **14 SELFTEST**: проверка ПО, не железа. Recovery без компилятора сохраняет ограниченные Perl-сценарии. Готовые проверенные нативные бинарники для Recovery пока не поставляются.

**RAW 1/13 заблокирован.** 16 — комплекс без стирания разделов, 17 — новый файл после согласия, 18 — отдельный 40-GiB bridge на подтверждённый внешний RESCUE, 19 — локальная очищенная обратная связь. Полные журналы храните приватно. Уменьшенный RAM-план не даёт полноценного PASS. Незавершённый этап и известная ошибка не должны исчезать из отчёта.

rc5 исправляет использование частичного вывода неуспешных проб, гонку супервизора при завершении короткого процесса, учёт оставшихся потомков, отказ записи итогового отчёта и подтверждение внешнего тома bridge. Несовпадение скачанных данных немедленно останавливает дальнейшие передачи и зависимую файловую проверку. Недоступный модуль Perl считается ограничением среды. Новые тяжёлые режимы не добавлены: расширены регрессии самой диагностики.

[Новые исправления и 207 проверок RU/EN](docs/diagnostics/RC5_SECOND_AUDIT.md) · [Полный журнал](docs/diagnostics/qa-rc5-linux.log.gz) · [Архитектура Recovery](docs/diagnostics/RECOVERY_PRODUCT_RU.md) · [Сохранённые правила rc4](docs/diagnostics/RC4_REVIEW_FIXES.md)

## English

The permanent launcher selects one verified immutable package. Hardware, running environment and capabilities are detected before the menu. Start with SELFTEST 14; it validates the toolkit, not the machine. Recovery may offer only limited screening, not full RAM/storage acceptance. rc5 hardens failed probes, supervisor completion, report failure handling, bridge metadata and integrity-stop gates. No new automatic heavy workload, RAW writes or log uploads were introduced. The 207 Linux software regressions do not validate real macOS/Recovery/Metal. Offline: `bash st.sh --offline selftest`.
