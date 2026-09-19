# Проверки 0.3.0-rc1 / Actual validation

Дата: 2026-09-19. Базовая ветка до изменений: pioner22/MacOS@12d4be8d53e815e69f7d151d32f8d0d3ee1a336d. Изменения относятся к диагностике; Yagodka/Electron не тестировалась и не менялась.

## Выполнено в этой среде

**79 автоматических проверок прошли:** 75 в tests/diagnostics_v2 плюс 4 проверки новых точек входа. Среда Linux x86-64, Bash 5.2, Python unittest, core Perl и локальный C-компилятор. Это не выполнение на Mac. Логи: regression-0.3.log и sanitizers-0.3.log рядом с этим файлом.

```bash
python3 -m unittest discover -s tests/diagnostics_v2 -v
python3 -m unittest discover -s tests -p test_profile_entrypoints.py -v
```

Покрытие: C-сборка с -Wall -Wextra -Werror; все 134 RAM-паттерна на малом объёме; намеренная битовая ошибка; устойчивый FAIL; отмена; файл write/close/reopen/readback; защита существующего файла, /dev и symlink; намеренная порча и обрезка; реальный локальный HTTPS с тестовым CA, обрыв, тайм-аут, короткий/длинный ответ, 404, неверный SHA, Range 206/неверный Content-Range/игнорирование Range; отсутствие дублирования retry-потока; пять независимых повторов без порчи параметров; захват exit/completion marker; остановка потомков; gate RAM/CPU; профиль; tamper/truncation загрузчика; cleanup; контроль ошибок журнала.

Эталоны пяти файлов 1/8/32/128/512 МиБ и диапазона 16 МиБ заново вычислены из SHAKE-256. Это не скачивание этих assets с GitHub и не подтверждение опубликованного Release.

**AddressSanitizer + UndefinedBehaviorSanitizer:** RAM 16 МиБ, два quick-прохода; file-I/O 16 МиБ, два чтения. Оба запуска завершились кодом 0, без зарегистрированных ошибок санитайзеров.

## Пока НЕ подтверждено

Реальные macOS/Bash 3.2/Recovery; компиляция и работа Metal на Mac; нагрузка 64-ГиБ машины; физические DRAM/VRAM/T2/SSD; отключение питания и сохранность журнала; независимый результат ремонта. В CI добавлена Linux/macOS Intel матрица, но существование workflow не равно успешному запуску. Реальная готовность Mac определяется отдельной приёмкой после ремонта.

## EN

79 local tests passed: 75 runtime/bootstrap regressions plus 4 entry-point compatibility checks. Executed on Linux, not macOS. C tests use small bounded allocations and test-only fault injection. Local HTTPS scenarios use a test CA; they are not measurements from the user's network. All five fixture hashes and the range hash were recomputed independently. RAM and file-I/O ASan/UBSan runs (16 MiB) returned zero.

Not established: real Mac/Bash 3.2/Recovery execution, Metal compilation/runtime on Mac, physical hardware health, actual large-memory coverage, power-loss recovery, published fixture assets or completed repair acceptance. CI workflow presence is not a CI success claim. Raw full-device legacy tests are disabled in active entry points, not certified as repaired.
