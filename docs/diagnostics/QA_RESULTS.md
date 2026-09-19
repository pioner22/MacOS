# Проверка / Validation — 2.0.0-rc2

Повторный прогон опубликованного набора исходников перед объединением: **93 tests, 0 failures, 0 errors, 41.632 seconds, OK**.

```bash
python3 -m unittest discover -s tests/diagnostics_v2 -v
```

Среда: Linux, Bash 5.2, Python unittest, pexpect 4.9.0, Perl, curl и системный cc. Это программная проверка, не результат проверки ноутбука.

Проверены прежние исправления downloader/native RAM/file I/O и дополнительные сценарии: маршруты всех 17 исполняемых пунктов меню, неверный ввод, отклонение противоречащего профиля, пустое/EOF подтверждение записи, отчёт PASS/FAIL/INCONCLUSIVE/PENDING_MANUAL, NOT_RUN после RAM/CPU gate, настоящая отмена Ctrl+C через PTY, TERM для дочерней группы, отказ открытия лога, сохранение обработчиков вызывающего shell, offline-пакет и повреждение файла пакета. Пропуски не выдаются за PASS. HTTP 404 означает недоступный эталон, не поломку RAM.

К основным регрессиям относятся реальные локальные TLS/curl передачи: верный/повреждённый/слишком длинный/оборванный объект, timeout+новая попытка с отдельным хэшем, Range и неправильные заголовки. C-движки исполнялись на малых выделениях, fault injection существует только в тестовых сборках.

Отдельные ASan/UBSan-прогоны: RAM Full 134 шаблона на 1 MiB, код 0; file I/O 1 MiB, 2 прохода, код 3 (ожидаемое отсутствие macOS cache controls на Linux), содержимое проверено. Диагностик sanitizer не зарегистрировано.

**Не проверено здесь:** настоящая macOS/Recovery/Bash 3.2, Metal compile/runtime, 40/48 GiB нагрузка, плата пользователя, его сеть, F_NOCACHE/F_FULLFSYNC Apple, холодный повтор. Эти ограничения нельзя заменить Linux PASS.

Полный журнал: `qa-rc2-linux.log`; SHA-256: `1736c1059e928931f562c3e2cde013bbac2ed3e5d272cbc458ba5cc7b1ccbf0f`.

Пакет: `28f01d8bbc81afff6512fac0d522765bbb8f674e`. Bootstrap: `da6537e4fa8cb81291f9057d5ab6d268432f9f0e`. На каждом новом запуске стабильный bootstrap читает одно актуальное описание выпуска, затем фиксирует все файлы на его commit. Проверка манифеста и размеров выполнена отдельно.

93 — число test methods; отдельные маршруты меню входят в subtests. Старые числа 71 и 79 не складываются. Их независимые кандидаты не являются двумя активными версиями в новой публикации. CI следует проверять отдельно: наличие workflow не означает зелёный GitHub Actions.

## English

The exact final local suite passed 93 tests in 41.632 seconds. It exercises software semantics, local TLS/curl, small native allocations, injected faults, menu routing, PTY cancellation and generated reports. It does not certify real macOS/Metal or the repaired Mac. Missing capabilities and incomplete coverage stay INCONCLUSIVE. A clean automatic workflow still requires manual and independent acceptance checks. Source and bootstrap references above identify the checked implementation; the release descriptor selects the current published package.
