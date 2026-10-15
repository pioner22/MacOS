# rc7 — фактическая проверка / actual validation

Версия: 2.0.0-rc7; Bootstrap 1.4; реестр 2026-09-20.1.

**Финальный повтор с закреплённым payload/bootstrap: 300 tests in 63.441s, OK, без пропусков.** Это один набор: 241 проверка rc6, 19 проверок ранее неопубликованного lifecycle-патча и 40 новых проверок реестра. Subtests отдельно не прибавлялись.

```bash
python3 -m unittest discover -s tests/diagnostics_v2 -v
python3 tools/build_diagnostics_registry.py --check
```

Фактическая локальная команда использовала системный /usr/bin/python3 и PATH=/usr/bin:/bin:/usr/sbin:/sbin. Pexpect 4.9.0 и ptyprocess предоставлены из отдельного каталога зависимостей разработческих тестов; они не входят в исполняемый пакет. Среда: Linux x86_64, Bash 5.2.37, Python 3.13.5, GCC 14.2.0, Perl 5.40.1, системный curl 8.14.1.

Реально выполнялись небольшие C/Perl RAM/file/read-only операции, искусственное внесение ошибок в тестовых сборках, локальный TLS/curl, сигналы/PTY, запись отчётов и пробные вызовы Bash/Perl/awk/tee/SHA. Сведения Mac, diskutil, некоторые отказы инструментов, объёмы памяти и транспорт bootstrap в соответствующих тестах имитируются. Registry-проверки не делают внешних сетевых запросов.

Проверены: 4 сгенерированные таблицы, отсутствие/подмена/неверный формат/дубли, неоднозначность приоритетов, точные ограничения build/Bash, Recovery без компилятора и без Perl, Apple silicon/Rosetta, unknown/limited, разные годы одного Model Identifier, отличия версий curl и неуспешный option probe после успешного --version, реальные KAT/модули, отказ запуска недоступного этапа, запись плана без ложного аппаратного PASS и отдельный режим profile с кодом 5. Сохранены регрессии полного жизненного цикла, в том числе ложные ранние сообщения об успехе и продолжение Recovery-плана после незавершённых RAM/CPU.

Исторический предварительный прогон 260 методов с несогласованными локальными манифестом/wrapper и mock-провайдерами завершился 9 неудачными проверками и не засчитан. После согласования набора 300 методов прошло до фиксации ссылок; числовой результат выше относится к отдельному итоговому повтору уже с настоящим commit.

**Не проверено:** настоящие macOS/Recovery, Bash 3.2, Apple clang, Metal, 40–48 GiB нагрузки, реальный диск пользователя, полная матрица моделей. ShellCheck локально не выполнялся. Новая macOS CI-конфигурация — задание на проверку, не доказательство её успешного выполнения. Нет новых prebuilt/native binaries, сервера логов или подписи независимого доверенного выпуска.

Полный неизменённый лог qa-rc7-linux.log.gz включён в архив исходников, приложенный в чате; в GitHub публикуется эта сводка. SHA-256 распакованного журнала: `dd0c637fed1f42fb43a88bded029febcb72dc63c38d8037558fb8ee29fbb03a1`.
Payload/bootstrap: `7a2ac61cf15943f3d1d4fda2c9cf9d6cf5f811c6`.
Manifest SHA-256: `2da22287b1e6b346ad16b92f2a2abb45fcbcecb186bf8cb75bd19ae12c176c43`.
Bootstrap SHA-256: `98e4067b5e209c497bdec137a00eeb43bc5995a2cff834f8c0b2d146d3200afc`.

## English

One final pinned-reference suite passed 300 methods in 63.441 seconds, no skips. Actual local Linux code execution coexists with explicitly mocked Mac facts and bootstrap transport. Forty new registry tests and nineteen previously unpublished lifecycle tests supplement the prior 241. A capability probe proves only its stated operation; READY is not a hardware PASS. Real macOS/Recovery/Bash 3.2/Metal and hardware acceptance remain pending. The unmodified compressed test log and immutable source references identify this validation.
