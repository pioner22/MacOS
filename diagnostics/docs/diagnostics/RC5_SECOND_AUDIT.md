# Повторный аудит — 2.0.0-rc5 / Bootstrap 1.2

Дата: 2026-09-20. Исходный main: `170489d81f48aef29e76532d09185a20a046225e`. Аудит продолжает rc4, не заменяет архитектуру и не добавляет автоматических тяжёлых нагрузок.

## Подтверждённые проблемы и исправления

| Область | Найдено в rc4 | Изменение rc5 |
|---|---|---|
| Профили | Неуспешный sysctl/sw_vers/diskutil мог вывести правдоподобные данные, которые принимались за наблюдение. | Новый pf_read допускает stdout только при успешном завершении pf_probe. Пробы модели, RAM, CPU, версии ОС, root volume и toolchain используют этот контракт. Неполные сведения не повышают профиль. |
| Супервизор | Завершение процесса могло предшествовать чтению EOF: оставшиеся буферизованные байты ошибочно считались незавершённым потомком. | После waitpid предусмотрено ограниченное время дренирования pipe. 25 последовательных реальных коротких процессов с 256 KiB вывода завершились без ложной ошибки. |
| Оставшиеся процессы | Фоновый потомок с перенаправленным stdout мог остаться после успешного родителя; cleanup убивал его, но возвращался код 0. | Существующая группа после завершения означает UNFINISHED_DESCENDANTS и неполный результат. Отдельная проверка подтверждает, что корректный wait не создаёт ложного отказа. |
| Итоговый отчёт | Отказ сохранения отчёта мог оставить PASS/0 в метаданных и вывести путь несуществующего отчёта. | Итог не PASS; код 3, REPORT=UNAVAILABLE, исправление метаданных по возможности. Прежний отчёт переименовывается в REPORT_INCOMPLETE_RU_EN.md. Известный FAIL сохраняется отдельно от ошибки отчёта. |
| Скачивания | После первого несовпадения продолжались остальные загрузки, а комплекс мог предложить файловую запись. | Немедленная остановка передач при ошибке целостности; после DOWNLOAD FAIL ни полный, ни Recovery-комплекс не запускает STORAGE_FILE. HTTP/DNS/TLS ограничения остаются INCONCLUSIVE. |
| Bridge | Подтверждение External через pipeline могло потерять ошибку diskutil и использовать частичный ответ. | Подтверждение берётся из одного канонического target_preflight: обязательны metadata rc=0 и Device Location=External до сборки/записи. |
| Self-test | Отсутствующий модуль Perl мог восприниматься как дефект файлов комплекта. | Предварительная bounded module probe даёт INCONCLUSIVE/PERL_SELFTEST_DEPENDENCIES_UNAVAILABLE, а не аппаратный FAIL. |

Эти исправления не означают, что устранены все возможные гонки или любые аппаратные зависания. Сигналы по-прежнему адресуются собственной группе этапа. Зависшее ядро, ушедшие в другую группу процессы и блокирующая запись самого журнала требуют отдельного анализа. При полностью неисправном хранилище нельзя гарантировать успешную перезапись файлов статуса; поэтому ошибка также выводится в консоль.

## Расширенные программные проверки

Добавлено 30 методов в test_round5.py. Помимо сценариев таблицы они проверяют реальный отказ открытия report.tmp, сохранение прежнего FAIL при отказе отчёта, сохранность старого отчёта как незавершённого и остановку полного/Recovery-плана после download mismatch.

Пять тестов выполняют настоящий файловый C-движок на 1 MiB с контролируемыми short read/write, EINTR, EIO, ENOSPC и EACCES. QA-only io_fault_shim.c использует Linux LD_PRELOAD только для дескрипторов собственных .macdiag-test-* файлов. Проверяются точное завершение частичных операций, классификация ошибок и сохранность контрольного пользовательского файла. Это не физический дефект SSD и не механизм производственной диагностики. Shim не входит в исполняемый пакет, загрузчик его не использует. Чистый файловый тест на Linux ожидаемо возвращает INCONCLUSIVE из-за отсутствия Apple cache controls.

## Фактическая проверка

**Итоговый прогон: 207 tests in 168.252s, OK, 0 skipped.** Это один набор: 177 прежних и 30 новых методов. Подсценарии и 25 повторов pipe-drain не прибавлены к числу test methods.

```bash
python3 -m unittest discover -s tests/diagnostics_v2 -v
```

Среда: Linux x86_64, Bash 5.2.37, Python 3.13.5, GCC 14.2, Perl 5.40.1, curl 8.10.1, pexpect 4.9.0. C/Perl выполнялись на малых выделениях; существующие HTTPS-тесты использовали настоящий локальный TLS-сервер; PTY/сигналы и файловые ошибки исполнялись реально. Сведения Mac, bridge metadata и транспорт bootstrap в регрессиях имитировались. Ни один результат не относится к ноутбуку пользователя.

SHA-256 распакованного полного журнала qa-rc5-linux.log.gz: `925bfa464718ef18db96f55e5df44529f4363f157e89c01497fd078285c00fc6`.

Дополнительно выполнены ASan/UBSan: RAM 1 MiB, Full 134 шаблона, exit 0; file 1 MiB, два цикла, exit 3 из-за отсутствия Apple cache controls, содержимое проверено. Диагностик sanitizer не зарегистрировано. SHA-256 отдельного журнала: `92ff60ba839aa8d76c5635a68d032b8d114982f6f38b8861124c3f46f075d8a7`.

Ранний запуск без установленного pexpect и предварительный прогон с двумя устаревшими версиями в assert не засчитаны как PASS. Версионные проверки теперь читают ожидаемую версию из descriptor. Итоговый прогон выполнен после фиксации настоящего payload commit. Предупреждения тестовой среды сохранены в журнале. Наличие конфигурации GitHub Actions не означает CI PASS.

Payload: `7079a87070501e261d3b036cf025766a93d0c8b0`.
Manifest SHA-256: `9013316a1cd8fd8cf67371e9aaaa243bb95ccef7445abb2d941b301451cc480e`.
Bootstrap не изменён: 1.2. Один запуск фиксирует один пакет; постоянная команда не меняется.

## Следующая аппаратная валидация

Новые тяжёлые режимы сейчас не добавлены. Приоритет: получить реальный профиль и SELFTEST в Recovery; затем проверить совместимые готовые native binaries и небольшой smoke-test без компилятора. Эти бинарники, подписи, реальная Bash 3.2/Apple clang/Metal матрица и исполнение 40–48 GiB ещё не реализованы/не подтверждены этим выпуском.

Для следующего этапа полезны отдельный cold-boot readback на явно выбранном носителе, контролируемый RAM retention и ступенчатая комбинированная нагрузка. Они требуют собственных критериев, согласия и независимой проверки; в меню rc5 их нет. Сначала следует испытать имеющийся комплект на реальной машине.

Сохранены: Recovery-first профиль до меню, строгий mlock, INCONCLUSIVE при уменьшении RAM-плана, ограниченный Perl screen, запрет RAW 1/13, отдельный consented bridge и локальный reviewed SUPPORT. Нет сервера загрузки, автоматической передачи журналов, гарантии сохранения хвоста при отключении питания или сертификата аппаратной исправности.

## English

rc5 fixes failed-probe stdout being trusted, a supervisor EOF/reaping race, unjoined descendants incorrectly yielding success, stale PASS metadata after report failure, bridge authorization from failed metadata and continued transfers/storage after integrity failure. Missing Perl modules are now an environment limitation. No additional automatic heavy hardware mode was added.

The final pinned-payload suite passed 207 methods in 168.252 seconds, no skips, on Linux. New tests include real small file I/O with QA-only short-operation/error injection, actual process/PTY behavior and explicitly mocked Mac facts. ASan/UBSan small RAM/file runs had no sanitizer diagnostics. These are software checks, not real macOS/Recovery/Metal or repaired-device acceptance. Private logs, unfinished results, strict mlock and RAW quarantine remain essential. Earlier unsuccessful preparation runs are not counted as passing validation.
