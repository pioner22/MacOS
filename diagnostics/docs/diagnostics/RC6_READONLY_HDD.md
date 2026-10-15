# HDD/SSD без стирания — 2.0.0-rc6 / Bootstrap 1.3

## Русский

Пункт **20 — HDD/SSD READ ONLY** добавляет отдельную проверку чтения. Постоянный запуск:

```bash
curl -fL https://raw.githubusercontent.com/pioner22/MacOS/main/st.sh | bash
```

Сначала профиль и пункт 14 SELFTEST, затем 20. Выберите целый физический диск по списку diskutil (например, disk2 — это только пример, не предписание), режим и подтвердите `READ disk2` с фактически выбранным номером. Номер не выбирается автоматически. Проверка метаданных повторяется после согласия; при изменении размера/сектора/идентификатора запуск отклоняется. Не отключайте и не переподключайте диск во время процедуры: одинаковые метаданные не доказывают идентичность заменённого устройства.

### Два режима

- **1 — выборочное чтение:** до 32 диапазонов по 1 МиБ, распределённых по логическому объёму, включая начало и конец. Тайм-аут 15 минут. Чистое завершение — `INCONCLUSIVE / READONLY_SAMPLE_CLEAN`: весь диск не проверен. На диске до 32 МиБ читается весь объём, но режим всё равно обозначается выборочным.
- **2 — полное чтение:** последовательное чтение всего подтверждённого логического объёма порциями до 1 МиБ. Тайм-аут 24 часа, не оценка длительности. `PASS / READONLY_FULL_READ_COMPLETED` означает только, что все запрошенные байты прочитались без зарегистрированной ошибки чтения. Это не сертификат исправности накопителя.

При первой ошибке чтения или неожиданном конце устройства нагрузка останавливается. Журнал содержит смещение, LBA относительно заявленного логического сектора, errno, число прочитанных байтов и завершённость. Это не локализация физической NAND-ячейки. Долгое чтение фиксируется как `READ_SLOW_OBSERVATION`, не объявляется bad sector. Ctrl+C и тайм-аут не дают PASS. Прерывание блокирующего вызова драйвера/ядра не гарантируется мгновенным.

### Что именно не записывается

Движок открывает выбранное `/dev/rdiskN` только `O_RDONLY | O_NOFOLLOW`; после открытия проверяет тип дескриптора. Он не создаёт тестовые данные на выбранном устройстве, не форматирует, не исправляет разделы, не монтирует и не размонтирует тома. Чтение не требует удаления файлов или свободного места для тестового файла.

**Однако это не аппаратная блокировка записи:** работающая ОС, другие приложения и выбранное место хранения журналов могут независимо писать на тот же диск. Для сохранения данных сначала нужна резервная копия; для журналов предпочтителен отдельный носитель. Чтение тоже является нагрузкой на уже повреждённый HDD. При щелчках, исчезновении диска или важных единственных данных не повторяйте полные сканы ради диагностики.

Без эталонных данных нельзя доказать правильность существующего содержимого только чтением. Новый режим не проверяет запись, целостность файловой системы, холодное удержание данных, скрытые резервные области или все компоненты контроллера. Сравнение хэшей всего работающего тома намеренно не выполняется: содержимое может меняться законно.

### Среда и ограничения

Режим работает через Perl, `diskutil` и существующий супервизор; clang/Xcode для него не нужен. Перед нагрузкой нужны подтверждённый профиль Darwin, работающие Perl-модули, 64-битные целые и метаданные целого физического устройства. Образы дисков, синтезированные APFS-устройства и разделы отклоняются. Неизвестная среда, отсутствие прав на чтение устройства, необходимых полей plist или инструментов дают INCONCLUSIVE. Парсер использует только узкий набор скалярных полей plist; это не универсальный XML-парсер и не гарантия наличия этих полей в каждой версии Recovery.

Новый режим **не добавлен автоматически** в комплекс 16 или SAFE 12. Его нужно запускать отдельно. Пункт 17 по-прежнему создаёт новый тестовый файл для проверки записи/чтения после отдельного согласия. Пункты 1/13 с разрушительным legacy RAW остаются заблокированными. Старые скрипты и соседний VPN-проект не изменяют поведение режима 20.

### Отчёт

В отдельном каталоге этапа сохраняются `read-disk-list.txt`, исходные/повторные метаданные `read-target*.plist`, `read-target.tsv`, `engine.log`, `output.log` и обычный контракт `result.tsv`. В `REPORT_RU_EN.md` добавлен раздел HDD/SSD READ ONLY: цель, режим, плановый/прочитанный объём, последний прогресс и ошибка при наличии. Журналы могут содержать идентификаторы дисков; храните их приватно. Содержимое прочитанных секторов в журнал не выводится и не отправляется. Сохранность хвоста при аварийном выключении не гарантирована.

### Фактическая проверка

**241 test methods in 218.941s, OK, без пропусков:** сохранённый набор 207 и 34 новые проверки, один итоговый прогон с закреплёнными ссылками. Меню 20 проверено дополнительным subtest внутри существующего метода.

Среда: Linux, Bash 5, системный Python, Perl/cc/curl и pexpect. Новый движок реально читал обычные небольшие тестовые файлы (включая выборку из sparse-образа 64 МиБ); их хэши до/после совпали. Проверены частичные чтения, EINTR, EIO, EACCES, EOF, отказ seek, сигнал INT, счётчики, отказ symlink, метаданные диска, смена цели, отсутствие согласия, выборочное покрытие без полного PASS и отчёт. Метаданные Mac и запуск raw-device пути имитируются. Сохранённые регрессии выполняли локальный TLS, PTY и малые native RAM/file операции.

Не выполнялись реальное чтение HDD/SSD через macOS raw-device, настоящая Recovery, Bash 3.2, большие диски, Metal или проверка физического ноутбука. Локальный OK не является CI PASS или аппаратным заключением. Первые прогоны, прерванные медленной вспомогательной Python-средой, не засчитываются как успешные.

```bash
python3 -m unittest discover -s tests/diagnostics_v2 -v
```

Полный лог `qa-rc6-linux.log.gz`; SHA-256 распакованного лога:
`1a072a975bd7bfd0199994dc84ebcde152a434c011a7826298386eafc5180c4a`.
Payload и bootstrap: `c6e14dda36146cf697d89f4b7d8cc93af633005d`.
Manifest SHA-256: `cfaaec4caa4eafde9276d213ae4dfd78448adfb4a446ce7d83a4cf0c2ea0c7ac`.

## English

Option 20 adds separately authorized HDD/SSD read-only testing; it is never added automatically to acceptance. Choose a whole physical disk, select sampling (up to 32 MiB, 15-minute timeout) or full logical-capacity reading (24-hour timeout), and type READ followed by that disk identifier. Metadata is checked again after confirmation. The scanner uses O_RDONLY/O_NOFOLLOW and never writes test data, formats, repairs or unmounts. OS/log writes are independent: this is not a forensic write blocker. Back up valuable data first; scanning can stress a failing drive.

The first read-path error stops the scan. Offsets, read counts, slow observations and partial progress are recorded without logging sector contents. A clean sample remains INCONCLUSIVE. A full PASS establishes only readability of the reported logical capacity, not existing-data correctness, filesystem integrity, write ability, hidden spare areas or whole-device health. No compiler is needed, but supported Darwin profile, working Perl modules, diskutil physical metadata and device-read permission are required. Unknown/missing capabilities fail closed.

241 software test methods passed in 218.941 seconds on Linux; 34 new cases use regular files and controlled faults/metadata, not real Mac disk devices. Actual macOS/Recovery/Bash 3.2 and full hardware scans remain unvalidated. Preserve private logs and report the detected environment before attempting a long scan. This release retains strict RAM locking, limited fallback screening, explicit file-write consent and quarantine of legacy destructive modes.
