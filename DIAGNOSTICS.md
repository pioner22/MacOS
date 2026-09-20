# Mac Hardware Diagnostics — 2.0.0-rc6 / Bootstrap 1.3

```bash
curl -fL https://raw.githubusercontent.com/pioner22/MacOS/main/st.sh | bash
```

Сначала определяются оборудование, загруженная среда и доступные инструменты, затем профиль и меню. Пункт 14 SELFTEST проверяет ПО, не железо.

**Новый пункт 20 — HDD/SSD READ ONLY, без записи тестовых данных:** явный выбор целого физического диска, выборочное или полное чтение, подтверждение `READ diskN`. Работает через Perl/diskutil без компилятора, при выполненных требованиях среды. Выборочный чистый результат остаётся INCONCLUSIVE; полный PASS означает только чтение указанного логического объёма без ошибок, не проверку записи и не сертификат исправности. Перед чтением повреждённого диска сохраните важные данные. ОС и файлы журналов могут писать отдельно; это не блокировка всех записей.

Пункты 1/13 с разрушительным RAW заблокированы. 16 — комплекс без стирания разделов (может предлагать запись нового файла), 17 — отдельный новый тестовый файл после согласия, 18 — 40-GiB RAM→внешний RESCUE, 19 — локальный очищенный SUPPORT. Пункт 20 не включён в комплексы автоматически. Для задачи «только чтение» выбирайте именно 20.

[Режим 20, ограничения и 241 программная проверка](docs/diagnostics/RC6_READONLY_HDD.md) · [Архитектура Recovery](docs/diagnostics/RECOVERY_PRODUCT_RU.md) · [Сохранённые исправления rc5](docs/diagnostics/RC5_SECOND_AUDIT.md)

## English

Start with option 14 (toolkit only), then option 20 for a separately confirmed read-only scan. No compiler is needed; compatible Darwin/Perl/diskutil/device permissions are still required. Sample completion is incomplete coverage; a full PASS proves only reported-capacity readability. No formatting, repair or test-data writes; OS and log writes remain possible independently. Legacy destructive modes stay blocked, file-write checks remain separate. The 241 Linux software regressions do not validate real macOS/Recovery or physical HDD/SSD hardware. Offline package selftest: `bash st.sh --offline selftest`.
