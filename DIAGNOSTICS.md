# MacBook Hardware Diagnostics Toolkit

Автономный набор аппаратной диагностики для Intel Mac, macOS Internet Recovery и полноценной macOS.  
Standalone hardware-diagnostic toolkit for Intel Macs, macOS Internet Recovery and full macOS.

## Быстрый запуск / Quick start

```bash
curl -L https://raw.githubusercontent.com/pioner22/MacOS/main/st.sh|bash
```

`st.sh` включает `caffeinate`, загружает актуальное меню и передаёт терминал выбранному тесту.  
`st.sh` enables `caffeinate`, fetches the current menu and hands the terminal to the selected test.

> **ВНИМАНИЕ / WARNING:** пункт `SSD/HDD TEST` разрушительный и может полностью перезаписать внутренний накопитель. / `SSD/HDD TEST` is destructive and may overwrite the entire internal drive.

## Состояния / Result states

| Код | Состояние | Значение |
|---|---|---|
| `0` | `PASS` / stage complete | Выполненный этап не обнаружил подтверждённой ошибки. Для многоэтапного теста смотрите его собственный final marker. |
| `2` | `FAIL` | Зафиксировано фактическое data/I-O/computation mismatch. |
| `3` | `INCONCLUSIVE` | Среда/инструменты/прерывание не позволяют получить достоверный аппаратный вывод. |
| `4` | `REBOOT_REQUIRED` | Нормальный checkpoint многоэтапного SSD-теста; полный PASS ещё не получен. |

`OOM`, kill, зависание или reboot **без** `expected != actual` сами по себе не считаются доказательством плохой RAM.  
OOM/kill/hang/reboot **without** a data mismatch is not by itself proof of faulty RAM.

## Меню / Menu

### 1. SSD/HDD TEST / Накопитель

Чистый MHDD-подобный full-LBA тест внутреннего Apple SSD, без встроенного RAM-preflight.

Проверяет:

- physical/internal Apple SSD safety gates;
- последовательное RAW-чтение всего logical LBA space;
- random 4 KiB reads;
- два LBA-зависимых destructive pattern A/B;
- SHA-256 каждого 64 MiB диапазона;
- локализацию mismatch до 4 KiB LBA;
- cold persistence verify после реальной перезагрузки;
- повторную проверку latency-outlier участка;
- финальное восстановление GPT/APFS и `diskutil verify`.

Критические маркеры:

```text
READ_IO_ERROR
WRITE_ERROR
VERIFY_READ_ERROR
VERIFY_HASH_MISMATCH
BAD_LBA4K
PROBE_HASH_MISMATCH
```

После Pattern A/B тест возвращает `4 / REBOOT_REQUIRED`; это **не PASS**. Полный PASS появляется только после `FINAL=PASS_FULL_DEVICE_LBA_WRITE_READ_PERSISTENCE`.

### 2. RAM QUICK / Быстрая RAM

На системах с достаточным объёмом проверяет **8 GiB** RAM простыми и адресозависимыми шаблонами. 8 GiB выбраны намеренно: ранее наблюдаемая ошибка находилась глубже первых 4 GiB allocation-relative диапазона.

Шаблоны: `ONES`, `ZERO`, `AA55`, `ADDR`. При mismatch выводится первый плохой byte: expected/actual/XOR.

### 3. RAM FULL HARDCORE / Полная RAM

Большие allocation phases до примерно 75% установленной памяти (на 64 GiB — до ~48 GiB), шаблоны:

- `ONES`, `ZERO`;
- `AA55`, `55AA`;
- walking ones / walking zeros;
- `ADDRA`, `ADDRB`;
- retention holds;
- многократные reread повреждённых страниц.

Опционально выполняется 40 GiB `RAM -> /Volumes/RESCUE -> sync/remount -> SHA-256 reread` bridge. Ошибка этого **внешнего bridge при чистых RAM-only фазах не маркируется как DRAM FAIL** — тогда подозреваются RESCUE/кабель/порт/I-O path.

### 4. RAM MAP / Карта RAM

8 GiB mapping-test продолжает работу после ошибок и собирает:

- pattern/cycle;
- chunk/page;
- byte offset;
- expected/actual;
- XOR mask;
- число ошибочных битов;
- hot chunks и bit statistics.

`logical_test_page` является allocation-relative, а не физическим адресом DRAM. Нельзя напрямую объявлять конкретный BGA-чип только по этому номеру.

### 5. CPU/CACHE

До 16 логических CPU одновременно считают известный SHA-256 256 MiB zero-stream в нескольких раундах. Проверяет execution/cache/memory path, но при плохой RAM не локализует неисправность на CPU.

### 6. GPU/VRAM

В Recovery выполняется inventory/probe. В полной macOS при наличии `clang` выполняется Metal verifier:

- перечисление Metal devices;
- private Metal buffers;
- GPU compute fill;
- retention pause;
- blit readback;
- word-by-word expected/actual/XOR compare.

Для дискретной AMD это преимущественно VRAM/device-local path; Intel iGPU использует shared system memory, поэтому его mismatch может быть следствием системной RAM.

### 7. VIDEO/DISPLAY

Собирает framebuffer/GPU/display logs и генерирует детерминированный визуальный pattern. Физическую матрицу нельзя полностью проверить программно без внешнего эталона.

Практическое разделение:

- артефакт присутствует и в screenshot -> GPU/framebuffer/VRAM/RAM path;
- глазами артефакт есть, screenshot чистый -> panel/eDP/TCON/display path.

### 8. NETWORK

Отдельный connectivity test без крупных загрузок:

- interface/route state;
- DNS/TCP/TLS/HTTP;
- GitHub endpoint;
- Apple `swcdn.apple.com` endpoint;
- HTTP 4xx/5xx считаются probe failure;
- отсутствие ICMP ping само по себе FAIL не создаёт.

### 9. DOWNLOAD / Integrity

Поток идёт напрямую `HTTPS -> SHA-256`; внутренний SSD не участвует.

Предпочтительный собственный GitHub Release `diagnostic-fixtures-v1` содержит детерминированные объекты:

- 1 MiB × 5;
- 8 MiB × 4;
- 32 MiB × 3;
- 128 MiB × 2;
- 512 MiB × 2.

Итого около 1.4 GiB проверенного трафика. Для каждого файла SHA-256 versioned в `network-fixtures.sha256`. Если dedicated Release недоступен, тест использует публичные GitHub Release assets PowerShell/LLVM с опубликованными ground-truth SHA-256.

Генератор: `tools/generate_network_fixtures.py`.  
Ручная публикация release assets:

```bash
curl -fsSL https://raw.githubusercontent.com/pioner22/MacOS/main/publish_network_fixtures.sh | bash
```

На stock macOS publisher использует `shasum -a 256`, на Linux — `sha256sum`.

### 10. POWER/THERMAL

Observation-test: `pmset`, battery/AC, `AppleSmartBattery`, `SPPowerDataType`, `powermetrics` если доступен. Отсутствие telemetry не превращается автоматически в hardware FAIL.

### 11. HARDWARE SNAPSHOT

Сохраняет baseline CPU/RAM/T2/GPU/storage/power/ioreg. При наличии writable `/Volumes/RESCUE` копирует лог туда.

### 12. SAFE FULL SUITE

Недеструктивный dependency-aware комплекс:

```text
TOOLKIT SELFTEST
 -> HARDWARE + POWER snapshot
 -> RAM QUICK
 -> если RAM PASS: CPU/GPU/DISPLAY/NETWORK/DOWNLOAD
 -> если RAM FAIL/INCONCLUSIVE: dependent tests SKIPPED
```

Это важно: неисправная RAM способна испортить SHA, GPU readback, curl/TLS buffers и создать ложную вторичную диагностику.

### 13. FULL COMPLEX

Полная dependency-aware последовательность:

```text
TOOLKIT SELFTEST
 -> HARDWARE / POWER
 -> RAM QUICK
 -> RAM FULL
 -> RAM MAP
 -> CPU/CACHE
 -> GPU/VRAM
 -> DISPLAY
 -> NETWORK
 -> DOWNLOAD
 -> SSD/HDD destructive, только после RAM PASS и CPU PASS
```

При RAM FAIL выполняется RAM MAP для доказательств, после чего integrity-dependent стадии блокируются. Если SSD достигает cold-verify checkpoint, комплекс возвращает `4 / REBOOT_REQUIRED`; после reboot продолжайте пунктом `1) SSD/HDD TEST`.

### 14. TOOLKIT SELFTEST

Проверяет **сами диагностические файлы**, а не железо Mac:

- все menu scripts доступны;
- `bash -n` каждого shell script;
- сборка частей SSD engine и `bash -n` assembled script;
- fixture manifest hashes;
- локальный SHA-256 sanity check.

`TOOLKIT SELFTEST PASS` означает только то, что комплект собран согласованно.

## Логи / Logs

Тесты по возможности сохраняют логи на writable `/Volumes/RESCUE`. Для интермиттирующего дефекта полезны несколько логов после независимых cold boots.

## Ограничения / Limitations

- Userspace RAM test не видит стабильный physical DRAM address и не определяет конкретный BGA-чип автоматически.
- T2/FTL скрывает spare NAND; SSD-test покрывает весь **экспонированный logical LBA space**, а не скрытый резерв NAND.
- Metal test требует полноценную macOS/compiler toolchain; в Internet Recovery GPU test может быть `INCONCLUSIVE`.
- Network FAIL на одном конкретном Apple endpoint может означать устаревший/недоступный endpoint, поэтому его нужно сравнивать с GitHub и другой сетью.
- `PASS` уменьшает вероятность дефекта, но не является математической гарантией отсутствия редкой интермиттирующей неисправности.
