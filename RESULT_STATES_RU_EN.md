# Diagnostic result states / Состояния диагностики

Этот файл описывает единый смысл состояний, которые выводят диагностические скрипты.

## PASS / ПРОЙДЕНО

**RU:** В рамках конкретного теста и проверенной области ошибки не обнаружены.

**EN:** No error was detected within the scope actually tested.

`PASS` не означает абсолютную гарантию исправности всего устройства. Например, userspace RAM-тест не может напрямую адресовать каждую физическую DRAM-ячейку, а SSD за T2/FTL скрывает spare NAND.

**Что делать дальше / Next:** при интермиттирующей проблеме повторить тест после холодной загрузки и/или под другой нагрузкой.

---

## FAIL / ПОДТВЕРЖДЁННАЯ ОШИБКА

**RU:** Обнаружено фактическое несовпадение данных, I/O error, вычислительная ошибка или другой проверяемый отказ.

**EN:** An actual data mismatch, I/O error, computation error, or another verifiable failure was detected.

Примеры / Examples:

```text
RAM_BAD_PAGE
RAM_CHUNK_MISMATCH
VERIFY_HASH_MISMATCH
BAD_LBA4K
WRITE_ERROR
READ_IO_ERROR
GPU_VRAM_MISMATCH
GPU_COMMAND_ERROR
DOWNLOAD_FAIL
```

**Что делать дальше / Next:** сохранять лог; сначала устранять наиболее базовый FAIL-домен. RAM FAIL имеет высокий приоритет, потому что нестабильная память может искажать результаты CPU/GPU/storage/download тестов.

---

## INCONCLUSIVE / НЕДОСТАТОЧНО ДАННЫХ

**RU:** Среда или ограничение теста не позволяют получить надёжный PASS/FAIL. Это не аппаратный FAIL.

**EN:** The environment or test limitation prevented a reliable PASS/FAIL. This is not a hardware failure by itself.

Примеры / Examples:

- Metal/clang недоступны в Internet Recovery;
- OOM/kill без `expected != actual`;
- нужная утилита отсутствует;
- визуальный display test требует оценки человеком;
- тест был прерван.

**Что делать дальше / Next:** повторить в подходящей среде, чаще всего в полной macOS.

---

## REBOOT_REQUIRED / НУЖНА ПЕРЕЗАГРУЗКА

Код выхода / exit code: `4` в многоэтапном SSD/HDD test.

**RU:** Текущий этап успешно завершён, но следующая проверка должна выполняться после реальной перезагрузки, чтобы сбросить кэши/контроллерное состояние.

**EN:** The current stage completed, but the next persistence check requires a real reboot to reset caches/controller state.

**Что делать дальше / Next:** перезагрузиться в Internet Recovery и снова выбрать `SSD/HDD TEST`.

---

## ERROR / ТЕСТ ПРЕРВАН

**RU:** Скрипт завершился нестандартным кодом или не смог стартовать. Нельзя автоматически считать это аппаратным FAIL.

**EN:** The script exited abnormally or could not start. Do not automatically treat this as hardware failure.

Примеры / Examples:

```text
missing command
syntax validation failed
fetch failed
Segmentation fault
Abort trap
Killed
```

Последние четыре события важны сами по себе, особенно если повторяются, но сначала надо понять, являются ли они следствием RAM corruption, OOM или ограниченной Recovery-среды.

---

# Основные ошибки / Key errors

## RAM_BAD_PAGE

**RU:** Конкретная 4 KiB тестовая страница после записи содержит данные, отличающиеся от ожидаемых.

**EN:** A tested 4 KiB memory page read back with data different from what was written.

**Дальше / Next:** холодная загрузка -> `RAM MAP` -> `RAM FULL HARDCORE`. При повторяемости — board-level диагностика DRAM/BGA/power/IMC.

## RAM_HARD_FAIL

**RU:** RAM-тест получил достоверное `expected != actual` и намеренно остановлен.

**EN:** The RAM test detected a confirmed `expected != actual` and intentionally stopped.

## RAM_MAP_EVENT

Показывает / reports:

```text
pattern
chunk/page
byte
expected
actual
xor
bit_errors
```

Адреса allocation-relative и не являются физическими адресами DRAM.

## VERIFY_HASH_MISMATCH

**RU:** Данные, считанные с накопителя, не совпали по SHA-256 с детерминированным ожидаемым блоком.

**EN:** Storage readback SHA-256 did not match the deterministic expected block.

**Дальше / Next:** сначала убедиться, что RAM стабильна. Затем рассматривать SSD/T2/storage path.

## BAD_LBA4K

**RU:** Ошибка локализована до конкретного 4 KiB логического блока накопителя.

**EN:** A storage mismatch was localized to a specific 4 KiB logical block.

## GPU_VRAM_MISMATCH

**RU:** Данные из Metal private buffer после GPU write/readback не совпали с ожидаемыми.

**EN:** Data read back from a Metal private buffer did not match the expected GPU-written pattern.

На Intel iGPU shared memory означает, что причиной всё ещё может быть системная RAM. На дискретной AMD подозрение сильнее смещается к dGPU/VRAM/path.

## GPU_COMMAND_ERROR / GPU_READBACK_ERROR

**RU:** Metal command buffer или копирование GPU->CPU завершились ошибкой.

**EN:** Metal command execution or GPU->CPU readback failed.

## NETWORK FAIL

**RU:** Повторяемые HTTPS/TCP/TLS probe не проходят. Ping сам по себе не считается FAIL, потому что ICMP может быть заблокирован.

**EN:** Repeated HTTPS/TCP/TLS probes fail. Ping loss alone is not a FAIL because ICMP may be blocked.

## DOWNLOAD_FAIL

**RU:** Большой поток оборвался либо его SHA-256 не совпал с опубликованным эталоном.

**EN:** A large transfer failed or its SHA-256 did not match published ground truth.

Сначала исключить RAM, затем сеть/TLS/CDN.

---

# Приоритет диагностики / Diagnostic priority

Если несколько тестов дают FAIL, порядок интерпретации:

1. **RAM** — сначала память, поскольку она влияет почти на все остальные вычисления и буферы.
2. **CPU/cache/IMC** — после RAM.
3. **GPU/VRAM** — особенно при артефактах.
4. **Storage** — после стабильной RAM, чтобы hash-результатам можно было доверять.
5. **Network/Download** — отдельно различать транспорт и целостность полученных байтов.
6. **Power/Thermal** — использовать для корреляции с нагрузкой/температурой.

If multiple domains fail, validate RAM first because corrupted memory can contaminate CPU, GPU, storage, and download results.
