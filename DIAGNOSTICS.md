# MacBook Hardware Diagnostics Toolkit

Автономный набор аппаратной диагностики для Intel Mac, macOS Internet Recovery и полноценной macOS.  
Standalone hardware-diagnostic toolkit for Intel Macs, macOS Internet Recovery and full macOS.

## Быстрый запуск / Quick start

```bash
curl -L https://raw.githubusercontent.com/pioner22/MacOS/main/st.sh|bash
```

`st.sh` включает `caffeinate` на время теста и открывает двуязычное меню.  
`st.sh` keeps the Mac awake with `caffeinate` and opens the bilingual menu.

> **ВНИМАНИЕ / WARNING:** `SSD/HDD TEST` может полностью перезаписать внутренний накопитель. / `SSD/HDD TEST` may overwrite the entire internal drive.

## Меню / Menu

### 1. SSD/HDD TEST / Накопитель

Чистый MHDD-подобный full-LBA тест внутреннего Apple SSD без встроенного RAM-preflight. Проверяет RAW read, случайные 4 KiB чтения, LBA-зависимые шаблоны A/B, SHA-256 каждого 64 MiB диапазона, локализацию до 4 KiB LBA и cold verification после reboot.  
Pure MHDD-like full-LBA storage test with RAW reads, deterministic A/B writes, per-chunk SHA-256, 4 KiB localization and post-reboot persistence verification.

Критические признаки / Critical markers:

```text
READ_IO_ERROR
WRITE_ERROR
VERIFY_READ_ERROR
VERIFY_HASH_MISMATCH
BAD_LBA4K
```

### 2. RAM QUICK / Быстрая RAM

Короткий скрининг ~4 GiB простыми и адресозависимыми шаблонами. При первом подтверждённом `expected != actual` возвращает FAIL.  
Fast ~4 GiB screening with simple and address-dependent patterns. A confirmed data mismatch returns FAIL.

### 3. RAM FULL HARDCORE / Полная RAM

Тяжёлый userspace torture: большие аллокации до ~75% RAM, `00/FF`, `AA55/55AA`, walking 1/0, `ADDRA/ADDRB`, retention и повторные reread. При наличии `/Volumes/RESCUE` может выполнить 40 GiB RAM → disk → readback SHA-256 round-trip.  
Heavy userspace torture with large allocations, stuck-bit/checkerboard/walking/address patterns, retention and repeated rereads; optionally a 40 GiB RAM→RESCUE→readback SHA-256 bridge.

Критические признаки / Critical markers:

```text
RAM_CHUNK_MISMATCH
RAM_BAD_PAGE
RAM_HARD_FAIL
```

### 4. RAM MAP / Карта RAM

Не останавливается на первой ошибке. Сохраняет pattern/cycle, chunk/page, offset, expected/actual, XOR mask, bit count и hot chunks.  
Continues after mismatches and records pattern/cycle, chunk/page, offsets, expected/actual values, XOR masks, changed-bit counts and hot chunks.

`logical_test_page` — виртуальная/аллокаторная позиция теста, а не гарантированный физический адрес конкретного DRAM-чипа.  
`logical_test_page` is an allocation-relative test position, not a guaranteed physical DRAM address.

### 5. CPU/CACHE

Параллельные детерминированные вычисления и hash-stress. Ошибка означает сбой CPU/cache/RAM execution path, но сама по себе не локализует компонент.  
Parallel deterministic compute/hash stress. Failure implicates the CPU/cache/RAM execution path but does not localize the component by itself.

### 6. GPU/VRAM

В Recovery выполняется GPU/framebuffer probe. В полноценной macOS при наличии compiler/Metal toolchain запускается Metal readback verifier: GPU записывает deterministic pattern в Metal buffers, выдерживает retention и копирует данные назад для CPU compare.  
Recovery provides a GPU/framebuffer probe; full macOS can run a Metal data-integrity verifier with GPU-written patterns and CPU readback comparison.

```text
GPU_VRAM_MISMATCH
GPU_COMMAND_ERROR
GPU_READBACK_ERROR
```

Для Intel iGPU память общая с системной RAM; для дискретной AMD private Metal buffers преимущественно нагружают её VRAM.  
Intel iGPU shares system RAM; discrete AMD private Metal buffers primarily exercise dedicated VRAM.

### 7. VIDEO/DISPLAY / Видео и экран

Проверяет доступный display/framebuffer path и объясняет диагностическое разделение: если артефакт присутствует и на screenshot — подозрение на GPU/framebuffer/VRAM; если глазами виден, а screenshot чистый — panel/eDP/TCON становится вероятнее.  
Checks the available display/framebuffer path and documents the key split: artifact also present in screenshots points toward GPU/framebuffer/VRAM; visually present but absent from screenshots points toward panel/eDP/TCON.

### 8. NETWORK / Сеть

Отдельный тест connectivity: интерфейсы, маршрут, ICMP (если разрешён), DNS/TCP/TLS/HTTP и repeated probes к GitHub и Apple CDN. Большие файлы здесь не скачиваются.  
Connectivity-only test: interfaces, route, optional ICMP, DNS/TCP/TLS/HTTP and repeated GitHub/Apple CDN probes. No large transfer matrix here.

### 9. DOWNLOAD / Скачивание и целостность

Потоки идут напрямую в SHA-256 без записи на внутренний SSD. Основной режим использует собственный GitHub Release `diagnostic-fixtures-v1` с файлами:

| File | Size | SHA-256 |
|---|---:|---|
| `nettest-001MiB.bin` | 1 MiB | `85c3ea1f26f1a18ba9c7b1adb12ca91a157ad1330c5d1fe3d542cfee13b4e7a8` |
| `nettest-008MiB.bin` | 8 MiB | `9bedc7cb90624f439e2baffd0ce25d69682da41aa2b521e26c879059cfc85949` |
| `nettest-032MiB.bin` | 32 MiB | `5aa0f6b39ed47a7a648b17d92daa61bc7ec25a1c46ecabd2f2c757f820cd7a38` |
| `nettest-128MiB.bin` | 128 MiB | `a18494ea78d4e7a610cc165ff66b4d7caf8db32aebb6b7b289e89d9207409e7c` |
| `nettest-512MiB.bin` | 512 MiB | `924d46bc2b284f264d08ac11ed2385723c1b094df2ea8652583b807711083110` |

Файлы детерминированно генерируются `tools/generate_network_fixtures.py`; эталоны лежат в `network-fixtures.sha256` и `network-fixtures.tsv`. Workflow `.github/workflows/network-fixtures.yml` публикует их в Release. Если собственный Release недоступен, тест автоматически использует публичные GitHub release assets PowerShell/LLVM с опубликованными SHA-256.  
Fixtures are generated deterministically, versioned by manifest, and published as release assets. If the dedicated release is unavailable, the test falls back to public PowerShell/LLVM release assets with published SHA-256.

### 10. POWER/THERMAL / Питание и температуры

Собирает battery/AC state, `pmset`, `AppleSmartBattery`, `SPPowerDataType`, `powermetrics` (если доступен). Это observation test: сам по себе отсутствие ошибки не гарантирует исправность VRM.  
Collects battery/AC, pmset, SmartBattery and available thermal/power metrics. This is observational rather than an absolute VRM pass/fail.

### 11. HARDWARE SNAPSHOT / Снимок железа

Инвентаризация CPU/RAM/T2/GPU/storage/power и доступных `ioreg` данных. Полезно сохранять до ремонта и после ремонта.  
Inventory snapshot of CPU/RAM/T2/GPU/storage/power and available ioreg data; useful before and after board repair.

### 12. SAFE FULL SUITE / Безопасный комплекс

Последовательно запускает Hardware Snapshot, RAM Quick, CPU/Cache, GPU/VRAM, Video/Display, Network, Download и Power/Thermal. Не запускает разрушительную full-LBA запись SSD.  
Runs the non-destructive suite and excludes destructive full-LBA storage writes.

### 13. FULL COMPLEX / Полный комплекс

Сначала выполняет безопасные тесты, RAM Quick/Full/Map, CPU/GPU/video/network/download/power. Разрушительный SSD/HDD тест запускается последним **только если RAM gate прошёл**. При RAM FAIL/INCONCLUSIVE destructive storage stage блокируется, потому что нестабильная память делает storage-hash результаты недостоверными.  
Runs the complete suite and gates destructive storage testing behind stable RAM results.

## Результаты / Result states

### PASS

**RU:** В проверенной области фактическая ошибка не обнаружена. PASS не является математической гарантией абсолютной исправности.  
**EN:** No actual failure was detected within the tested scope. PASS is not an absolute mathematical guarantee.

### FAIL

**RU:** Обнаружено фактическое расхождение данных, вычисления или I/O. Сохраняйте лог и сначала устраняйте этот домен.  
**EN:** An actual data/computation/I/O mismatch was detected. Preserve logs and isolate/repair the failing domain first.

### INCONCLUSIVE

**RU:** Текущая среда не позволяет получить достоверный PASS/FAIL: отсутствует toolchain, произошёл OOM/kill, stage требует reboot и т.п. Это не аппаратный FAIL само по себе.  
**EN:** The environment could not produce a reliable PASS/FAIL (missing toolchain, OOM/kill, reboot-required stage, etc.). This is not automatically a hardware failure.

### STATE_REBOOT_REQUIRED

**RU:** Этап успешно завершён и специально требует настоящую перезагрузку для cold/persistence verification.  
**EN:** A stage completed successfully and requires a real reboot for cold/persistence verification.

## Правила интерпретации / Interpretation rules

- `expected != actual` в RAM после холодной загрузки значительно сильнее обычного hang/reboot. / A reproducible RAM data mismatch after cold boot is much stronger evidence than a hang/reboot alone.
- OOM/kill при экстремальной аллокации RAM = `INCONCLUSIVE`, если не было data mismatch. / OOM/kill during extreme allocation is inconclusive without a data mismatch.
- Один slow SSD block без hash mismatch не равен bad NAND. / A single slow storage block without hash mismatch is not proof of bad NAND.
- SSD за T2/FTL скрывает spare NAND, поэтому тест охватывает логические LBA, а не каждую физическую NAND-cell. / T2/FTL hides spare NAND; testing covers exposed logical LBA space, not every physical cell.
- Для VRAM настоящий data-integrity тест предпочтительно выполнять из полной macOS с Metal. / True VRAM data-integrity testing is best performed from full macOS with Metal.
- Hash mismatch в DOWNLOAD при уже неисправной RAM нельзя автоматически считать сетевой ошибкой. / A download hash mismatch while RAM is known-bad cannot automatically be blamed on the network.

## Internet Recovery

Recovery урезана и может не иметь `openssl`, `cmp`, `Digest::SHA`, `Time::HiRes`, compiler/Metal toolchain. Скрипты стараются использовать минимальный встроенный набор и возвращать `INCONCLUSIVE`, когда проверка технически невозможна.  
Recovery is restricted; scripts avoid optional dependencies and report INCONCLUSIVE when a stage cannot be performed reliably.

## Логи / Logs

Если подключён writable `/Volumes/RESCUE`, тесты по возможности сохраняют логи туда. Для ремонта платы особенно полезны несколько логов **разных холодных загрузок** — сравнивайте повторяемость RAM XOR/bit patterns, GPU errors и временную корреляцию с power/thermal events.  
When writable `/Volumes/RESCUE` is present, diagnostics preserve logs there when possible. Multiple cold-boot logs are especially useful for board-level repair.
