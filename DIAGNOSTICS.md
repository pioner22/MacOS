# MacBook Hardware Diagnostics Toolkit

Набор диагностических скриптов для Intel Mac / macOS Internet Recovery и полноценной macOS.

> **Важно:** тест `SSD/HDD TEST` может выполнять разрушительную запись по всему внутреннему накопителю. Перед его использованием данные должны быть сохранены. Остальные тесты по умолчанию не выполняют разрушительную запись на внутренний SSD.

## Быстрый запуск

В Terminal:

```bash
curl -L https://raw.githubusercontent.com/pioner22/MacOS/main/st.sh|bash
```

`st.sh` включает `caffeinate` на время длительной диагностики и открывает меню.

## Меню

### 1. SSD/HDD TEST

MHDD-подобный тест полного логического пространства внутреннего Apple SSD.

Проверяет:

- идентификацию physical/internal Apple SSD;
- полный sequential RAW read;
- случайные 4 KiB чтения;
- два различных LBA-зависимых шаблона записи A/B;
- SHA-256 каждого 64 MiB диапазона после записи;
- локализацию ошибки до 4 KiB LBA;
- сохранность данных после reboot (cold verification);
- повторное исследование обнаруженных latency-outlier областей;
- восстановление GPT/APFS после полного успешного цикла.

Критические признаки:

```text
READ_IO_ERROR
WRITE_ERROR
VERIFY_READ_ERROR
VERIFY_HASH_MISMATCH
BAD_LBA4K
```

`HASH_MISMATCH` после детерминированной RAW-записи — серьёзный признак неисправности storage path (SSD / T2 / RAM / I/O path). Поэтому RAM желательно проверять отдельно.

### 2. RAM TEST

Максимальный userspace RAM torture test.

Проверяет большие объёмы памяти шаблонами:

- `ONES` (`FF`);
- `ZERO` (`00`);
- `AA55` / `55AA`;
- walking ones / walking zeros;
- адресозависимые `ADDRA` / `ADDRB`;
- повторные reread повреждённых страниц;
- удержание данных в RAM;
- большие аллокации вплоть до ~75% установленной RAM (с резервом для Recovery);
- опциональный 40 GiB RAM -> внешний `RESCUE` -> readback SHA-256 round-trip.

Критические признаки:

```text
RAM_CHUNK_MISMATCH
RAM_BAD_PAGE
RAM_HARD_FAIL
```

Повторяемый `expected != actual` после холодной загрузки значительно сильнее обычного зависания или reboot и указывает на неисправность memory subsystem. Причиной может быть DRAM, BGA, питание памяти, линии данных/адреса или IMC CPU.

### 3. RAM MAP

Картирующий тест RAM. В отличие от RAM TEST не прекращает работу после первой ошибки.

Собирает:

- pattern/cycle;
- chunk/page;
- allocation-relative test page;
- byte offset внутри страницы;
- expected/actual byte;
- XOR mask;
- число изменённых битов;
- hot chunks;
- статистику по битам.

Важно: macOS не предоставляет этим userspace-скриптам физический адрес DRAM, поэтому `logical_test_page` нельзя напрямую считать номером конкретного чипа памяти.

### 4. CPU/CACHE TEST

Параллельный deterministic CPU/hash stress.

Несколько workers одновременно вычисляют SHA-256 известного 256 MiB zero-stream с заранее известной контрольной суммой. Расхождение означает ошибку CPU/cache/RAM execution path, но само по себе не локализует компонент.

### 5. GPU/VRAM TEST

Два режима:

- в Internet Recovery: инвентаризация GPU/framebuffer/display path;
- в полной macOS при наличии `clang` / Command Line Tools: нативный Metal-тестер.

Metal-тестер:

- перечисляет все Metal GPU;
- выделяет private Metal buffers;
- GPU compute kernel записывает детерминированный pattern;
- выполняется retention pause;
- private VRAM копируется обратно в shared readback buffer;
- CPU проверяет каждое 32-bit слово;
- выполняется несколько проходов.

Критические признаки:

```text
GPU_VRAM_MISMATCH
GPU_COMMAND_ERROR
GPU_READBACK_ERROR
```

Для дискретной AMD private buffers преимущественно тестируют её VRAM. Для Intel iGPU память разделяется с системной RAM, поэтому mismatch может происходить из общей memory subsystem.

### 6. NETWORK TEST

Тестирует сетевой путь без записи на внутренний SSD:

- repeated HTTPS/TLS probes к Apple `swcdn.apple.com`;
- TCP/connect/start-transfer timing;
- несколько полных GitHub streams с опубликованным SHA-256;
- проверку целостности полученных байтов.

Используется для разделения проблем Internet Recovery/CDN/Wi-Fi и повреждения данных в локальной памяти.

### 7. POWER/THERMAL

Собирает доступные сведения:

- battery/AC state;
- `pmset`;
- `AppleSmartBattery`;
- `SPPowerDataType`;
- `powermetrics`, если доступен.

Это observation test, а не абсолютный PASS/FAIL аппаратуры питания.

### 8. HARDWARE SNAPSHOT

Сохраняет инвентаризацию CPU/RAM/T2/GPU/storage/power и основные `ioreg` сведения. При наличии `/Volumes/RESCUE` лог копируется на внешний диск.

### 9. SAFE FULL SUITE

Последовательно запускает:

- Hardware Snapshot;
- CPU/Cache;
- Network;
- GPU/VRAM;
- Power/Thermal.

Не включает разрушительную RAW-запись SSD. Тяжёлый RAM TEST запускается отдельно, чтобы его ошибки или OOM не мешали сбору остальных данных.

## Результаты

Скрипты используют три класса результата:

- `PASS` — проверенные условия выполнены без обнаруженной ошибки;
- `FAIL` — обнаружено фактическое расхождение данных / I/O error / вычислительная ошибка;
- `INCONCLUSIVE` — среда не позволяет выполнить тест полностью (например, Metal test в Internet Recovery без compiler toolchain).

`PASS` не является математической гарантией отсутствия скрытого аппаратного дефекта. Особенно для SSD за T2/FTL недоступны напрямую spare NAND cells, а userspace RAM test не может закрепить каждую виртуальную страницу за конкретной физической DRAM-ячейкой.

## Internet Recovery

Recovery сильно урезана. В конкретных версиях могут отсутствовать:

- `openssl`;
- `cmp`;
- Perl modules вроде `Digest::SHA` / `Time::HiRes`;
- compiler/Metal toolchain.

Скрипты специально используют минимальный набор встроенных утилит и явно отмечают недоступные стадии как `INCONCLUSIVE`, а не как аппаратный `FAIL`.

## Логи

Если подключён writable том `/Volumes/RESCUE`, ряд тестов автоматически сохраняет туда логи. Для ремонта платы полезно хранить логи нескольких **холодных загрузок**, особенно RAM MAP: повторяемость XOR/bit pattern даёт больше информации, чем одиночный crash.

## Безопасность

- Не запускать SSD/HDD TEST на машине с несохранёнными данными.
- Не трактовать OOM/kill при экстремальной аллокации RAM как доказательство дефекта DRAM без `expected != actual`.
- Не трактовать единичный slow I/O block как bad NAND без повторной проверки и hash mismatch.
- Для GPU/VRAM настоящий data-integrity тест выполнять из полноценной macOS; Recovery-проверка GPU является только probe.
