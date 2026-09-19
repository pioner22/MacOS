# Приёмка после ремонта — RU

Версия: 0.3.0-rc1. Это инструмент сбора проверяемых свидетельств, не сертификат сервиса.

## Подготовка

Сохранить акт ремонта: что действительно заменено/восстановлено, итоговая конфигурация и результаты сервиса. Не считать старые Perl-mismatch независимым доказательством дефекта конкретного DRAM-чипа. Сначала получить результат диагностики платы и независимого теста.

Запускать на устойчиво загружающейся полной macOS Intel с питанием и установленными Command Line Tools. Оригинальная целевая машина — A2141, 64 ГиБ; это не заявление о проверке всех Mac и ОС. Не отключать тепловые защиты и не намеренно доводить ноутбук до отключения. Остановиться при авариях, сохранить журналы.

Выбрать 16. Подтвердить автоматически обнаруженную модель/ОС. Для файловой проверки указать каталог на желаемом томе; перед записью нужно отдельно ввести WRITE-TEST-FILE. Пустой ввод не даёт разрешения.

## Последовательность

Самопроверка пакета → сведения/питание → RAM Quick → RAM Full → CPU → GPU → сеть → скачивание → файловый SSD-тест → ручной экран/эксплуатационные проверки.

Ошибка или незавершённость RAM/CPU блокирует зависимые проверки. Отдельная неисправность передачи не доказывает неисправность RAM/Wi-Fi/SSD. Повторяемые несовпадения требуют независимого подтверждения и сопоставления с выполненным ремонтом.

RAM Quick обычно 2 ГиБ. Full: 134 паттерна (6 простых/адресных + 64 walking-one + 64 walking-zero), фиксированная аллокация, прямые чтения volatile, попытка mlock. Размер определяется доступной памятью и ограничен 75% установленной, максимум 48 ГиБ; фактически может быть меньше. Пользовательский объём сверх бюджета отклоняется, а не молча уменьшается. Проверка не охватывает всю физическую RAM, firmware/T2 или все состояния CPU-кэша; mlock может быть недоступен.

GPU по умолчанию запрашивает 512 МиБ, может ограничить объём по возможностям устройства. Это Metal data-path, а не физическое картирование VRAM. Общая RAM, CPU, драйвер и readback тоже участвуют. Сборка и runtime Metal требуют отдельной проверки на Mac.

Файловый SSD-тест по умолчанию 4 ГиБ; запись → flush → закрытие → два отдельных открытия/сверки. Система не стирается. Это не MHDD, не весь SSD и не power-loss test. Общий 40-ГиБ RAM→диск bridge не включён. Совместный длительный CPU+GPU burn-in и автоматическое испытание сна/батареи в эту версию также не включены.

Скачивание: независимые попытки, HTTP, фактическая длина, SHA-256, точный Range. При недоступном собственном Release резервные результаты не означают полного покрытия. Malые HTTPS HEAD к Apple не подтверждают загрузку/подпись/установку macOS.

## После автоматических этапов

Проверить ручной список в каталоге отчёта: Apple Diagnostics, независимый RAM-тест, повтор после полного выключения и новой загрузки, сон/пробуждение, AC/батарея, дисплеи, порты, звук, камера, Wi-Fi, новые panic/watchdog. Самопроизвольное отключение — причина остановить приёмку и разбирать источник, а не автоматически назначить виновную память.

Сравнивать запуск после холодной загрузки и после обычной работы. Критерий наших проверенных условий — ноль несовпадений, ноль необъяснённых I/O-ошибок и отсутствие необъяснённых аварий. Это не статистическая гарантия отсутствия всех скрытых дефектов и не норматив Apple/ГОСТ. Успешный быстрый тест не отменяет прошлые воспроизводимые ошибки.

Автоматический итог AUTO_PASSED_MANUAL_REVIEW_REQUIRED имеет код 3: автоматические этапы пройдены, но ручная приёмка ещё не закрыта. Не заменять этот статус словом «всё исправно».

# Post-repair acceptance — EN

Version 0.3.0-rc1 collects test evidence; it does not certify a repair. Record the repair scope and configuration. Earlier interpreter mismatches are not independent identification of a faulty DRAM chip.

Use stable full Intel macOS, AC power and installed Command Line Tools. Select option 16. Choose a directory for the file test and explicitly confirm WRITE-TEST-FILE. No RAW writes, reformatting, automatic remount or overwrite of user files is part of the active suite.

Order: package self-check, hardware/power observations, quick/full native RAM, CPU, GPU, HTTPS probes, download integrity, allocated-file storage, manual review. RAM/CPU prerequisite failures stop dependent integrity tests. Failures describe observations, not automatic component attribution.

Quick RAM normally requests 2 GiB. Full uses 134 patterns, adaptive allocation capped at 75% installed RAM and 48 GiB, with actual coverage and mlock result logged. Not all physical memory, reserved firmware/T2 memory or CPU cache states are covered. GPU defaults to 512 MiB with device caps; Metal readback also depends on system RAM and drivers. Storage creates a new 4-GiB file by default, flushes, closes and reopens twice for verification; it does not test the whole disk or power-loss durability.

Download retries use independent hash processes. Actual byte counts, HTTP status, encoding, SHA-256 and Content-Range are checked. Range is a separate request, not full file-resume reassembly. If dedicated Release fixtures are unavailable, fallback evidence is retained but planned coverage remains incomplete.

Not included: the previous 40-GiB RAM-to-disk bridge, concurrent extended CPU/GPU burn-in, automatic battery/sleep cycling, offline native Recovery binaries, physical-chip mapping, formal hardware certification.

Even all automatic stages passing produces INCONCLUSIVE / AUTO_PASSED_MANUAL_REVIEW_REQUIRED. Finish the supplied manual checklist, independent RAM/Apple Diagnostics and a fresh-boot repeat. Review unexplained panics, shutdowns or I/O errors before accepting the repair. Logs are live but not guaranteed to survive abrupt power loss. Review serial numbers and personal data before sharing reports.
