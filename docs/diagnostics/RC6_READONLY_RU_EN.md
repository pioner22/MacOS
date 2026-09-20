# HDD/SSD без стирания — 2.0.0-rc6 / Bootstrap 1.3

## Русский

Новый отдельный пункт **20 — HDD/SSD READ-ONLY** выполняет один последовательный проход чтения всего объявленного логического объёма выбранного физического диска. Постоянная команда не меняется:

```bash
curl -fL https://raw.githubusercontent.com/pioner22/MacOS/main/st.sh | bash
```

Сначала self-test комплекта (14), затем снова меню → 20. Скрипт показывает `diskutil list`, принимает только целый физический `diskN`, выводит модель/размер/геометрию и требует **READ diskN**. Пустой ввод отменяет запуск; диск по умолчанию не выбирается. Нельзя выбирать раздел `diskNsM` или синтезированный APFS-диск. Метаданные должны успешно прочитаться, соответствовать запрошенному устройству и не измениться после подтверждения и по завершении. Не отключайте и не переподключайте устройства во время проверки. Эти проверки идентичности не являются криптографической идентификацией конкретного накопителя.

### Без записи на цель

Читающий движок открывает `/dev/rdiskN` только с **O_RDONLY | O_NOFOLLOW**, проверяет тип устройства и соответствие открытого дескриптора. В нём нет операций записи, создания/удаления файлов на цели, исправления файловой системы, форматирования или изменения разметки. Прочитанные байты не сохраняются и не печатаются в журнал. Размонтирование и изменение режима монтирования автоматически не выполняются.

Это не forensic write blocker: работающая ОС, драйверы и журналы могут отдельно записывать на тот же диск. Каталог журналов виден перед запуском; для минимизации записей на исследуемый носитель выбирайте другое устройство через существующий MACDIAG_REPORT_DIR. Это именно ограничение *движка чтения*, не обещание полного отсутствия записей всей системы. В Recovery сначала нужен смонтированный носитель для постоянных логов; имя RESCUE само по себе не доказывает внешний диск. Утилита не создаёт и не форматирует том для журналов.

**При щелчках, исчезновении диска или незаменимых данных сначала защитите данные: образ/восстановление, а не полный диагностический проход.** Read-only не означает отсутствие механической нагрузки на неисправный HDD. При первой ошибке чтения тест останавливается без повторного чтения проблемной области и без попыток «ремонта».

### Recovery и полная macOS

Компилятор, Xcode CLT, Python и Homebrew для нового режима не нужны. Требуются работающие Perl с 64-битными числами/файловыми смещениями и core-модулями, diskutil, существующий supervisor и профиль, допускающий проверки. Доступ к raw device может потребовать соответствующих прав. При отказе, неизвестной геометрии или непройденном профиле — INCONCLUSIVE, без автоматического sudo, отключения защит или обхода проверки метаданных. Поддержка Recovery определяется по фактическим возможностям, а не предполагается только из названия ОС. Новое текстовое распознавание diskutil консервативно: неизвестный формат не считается разрешением читать произвольную цель.

Рабочий буфер — 4 МиБ, а не десятки гигабайт. Выводятся прочитанные байты и процент. Время ограничено 24 часами; фактическая длительность зависит от носителя/соединения. Ctrl+C сохраняет незавершённость, насколько позволяют ОС и хранилище журналов. Периодический heartbeat supervisor не гарантирует продвижение зависшего драйвера. Гарантии остановки заблокированного в ядре I/O нет.

### Результат и границы

- PASS / STORAGE_RO_ALL_BYTES_READ: весь объявленный логический объём прочитан без зарегистрированной ошибки чтения, контроль завершения и метаданных пройден.
- FAIL / STORAGE_RO_READ_PATH_ERROR: ошибка чтения или преждевременный EOF. Фиксируются смещение запроса, его LBA/длина и исходный errno, когда доступны. Это не точный номер неисправного физического сектора и не локализация причины: возможны носитель, контроллер, кабель, питание и другие части пути.
- INCONCLUSIVE: отказ доступа, несовместимая среда, изменение метаданных, тайм-аут или неполный результат. Сигналы сохраняют коды прерывания. Частичный проход не даёт PASS.

Запросы длительнее 2 секунд отмечаются как наблюдения, а не доказательство «плохого сектора». Контрольный образ содержимого отсутствует: тест не устанавливает правильность файлов, не сверяет файловую систему, не проверяет запись/удержание данных, резервные физические сектора или запасные NAND-ячейки. Не выполняется SMART self-test. PASS чтения не означает, что накопитель безусловно исправен, и не заменяет независимые проверки RAM/данных.

В стадии сохраняются `engine.log`, `read-coverage.tsv`, метаданные `ro-info-*.txt`; в итоговом REPORT_RU_EN.md — запланированные и прочитанные байты и ограничения. После прерывания последний сохранённый счётчик может отставать от фактического чтения. Логи приватные и автоматически не отправляются.

Пункт **17** остаётся отдельным тестом *нового временного файла с записью и сверкой*. Пункты **1/13 с разрушительным RAW заблокированы**. Новый пункт 20 не включён автоматически в SAFE или POST-REPAIR — полный проход требует отдельного выбора и согласия. Добавлена совместимая точка входа `hdd_readonly_test.sh`; рекомендуемый вход остаётся st.sh.

### Фактическая программная проверка

После фиксации настоящих payload/bootstrap ссылок выполнен один полный набор: **238 tests in 173.796s, OK**, без пропусков. 207 предыдущих + 31 новый метод. Команда:

```bash
python3 -m unittest discover -s tests/diagnostics_v2 -v
```

Linux x86_64, Bash 5.2.37, Python 3.13.5, Perl 5.40.1. Новый алгоритм действительно читал небольшие обычные файлы; SHA-256 до/после совпадал. Искусственные короткие чтения/EINTR/EIO/EACCES/EOF/тайм-аут/отмена, строгие метаданные, отказ без подтверждения, изменение геометрии, menu 20 и отчёт прерывания проверены. Подмена read-функции используется только внутри тестового Perl-процесса, не через производственную опцию. Реальный Mac raw device не открывался. Сохранились прежние локальные TLS, малые C/Perl и PTY проверки. Bootstrap transport и данные diskutil имитировались. Предупреждения среды сохранены в полном логе.

**Не выполнено:** реальная macOS/Recovery/Bash 3.2, чтение физического HDD/SSD Mac, большие полнодисковые проходы, Metal. Состав инструментов и текстовый вывод diskutil на конкретном Mac пока требуют практической проверки. Наличие workflow не означает CI PASS. Предварительный успешный прогон до фиксации новых ссылок отдельно не прибавлен к числу тестов. Ранний отладочный прогон нового модуля обнаружил ошибку числового сравнения размера в awk; она исправлена до обоих полных прогонов.

Полный лог: `qa-rc6-linux.log.gz`. SHA-256 распакованного лога: `f5db81675a03ce54304220b818d83b431fa3934e0e842814a7db2ae6fd2c72ff`.
Payload: `ceca9f0d25e511785b76200659a092a282ed3c2d`.
Bootstrap: `66ba6f126c724edf471ab76da05f08ec7aad1c85`.
Manifest SHA-256: `4abd3e81bff7262d8d693dedac250c0f7746c11c525d1d6f4272e2bd6be7c1ff`.

## English

Option **20 HDD/SSD READ-ONLY** reads the selected physical whole disk sequentially using O_RDONLY|O_NOFOLLOW and a 4 MiB buffer. It never writes target sectors, repairs filesystems, formats, changes partitions or automatically unmounts volumes. Existing OS/log writes are not blocked; this is not a forensic write blocker. Prefer another device for private logs. Do not scan a clicking/disconnecting drive holding irreplaceable data before recovery/imaging.

A valid whole disk ID, successful diskutil geometry, an explicit `READ diskN` confirmation and unchanged metadata are required. No compiler is needed: this uses validated 64-bit core Perl and the existing supervisor in capability-approved Recovery/full macOS. Missing tools, access or uncertain metadata fail closed. No automatic sudo or security bypass. Stop at the first read error, no retries. The maximum duration is 24 hours, without guarantees for uninterruptible kernel I/O.

PASS covers logical readability only, not expected file contents, filesystem correctness, writes, retention or spare physical sectors. Error offsets identify failed requests, not exact bad physical sectors or a faulty component. Slow reads are observations. Partial or interrupted scans do not pass. Read counts, metadata and reports remain local. Option 17 separately writes/verifies a new file; destructive modes 1/13 remain blocked; option 20 is never automatically included in suites.

Final local software validation passed **238 tests in 173.796 seconds**, 31 new methods, no skips. Real small regular-file reads and byte-preservation checks; controlled errors, mocked Mac metadata and bootstrap transport, retained local TLS/PTY/native regressions. No actual macOS/Recovery/Bash 3.2/physical Mac disk read or full-device run was validated. The source references and uncompressed log digest above identify this validation, not a repaired-device certificate.
