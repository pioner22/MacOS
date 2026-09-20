# Mac Hardware Diagnostics — 2.0.0-rc6 / Bootstrap 1.3

```bash
curl -fL https://raw.githubusercontent.com/pioner22/MacOS/main/st.sh | bash
```

Сначала определяются фактические система/оборудование/возможности; затем профиль и меню. Начните с **14 SELFTEST** — проверка комплекта, не железа.

**Новый пункт 20 — HDD/SSD READ-ONLY: полный проход чтения без записи движком на выбранный физический диск.** Выберите целый `diskN`, проверьте размер и модель, подтвердите `READ diskN`. Рабочий буфер 4 МиБ; компилятор не нужен. Нужны работающие 64-битный Perl, diskutil, права и подходящий профиль. При первой ошибке чтения — остановка и журнал. Файлы/разделы не стираются и не ремонтируются. ОС/журналы могут отдельно писать на тот же носитель: это не forensic write blocker. При признаках механической неисправности и ценных данных сначала восстановление/копия, а не скан.

PASS означает только чтение объявленного логического объёма, не правильность содержимого или проверку записи. Частичный проход не даёт PASS. Пункт **17** отдельно пишет и сверяет новый временный файл. **RAW 1/13 остаётся заблокирован**; 18 — отдельно подтверждаемый 40-ГиБ RAM→RESCUE; 19 — локальный просмотренный пакет поддержки. Новый режим не добавлен автоматически в комплекс.

[Инструкция, ограничения и 238 программных проверок RU/EN](docs/diagnostics/RC6_READONLY_RU_EN.md) · [Полный журнал](docs/diagnostics/qa-rc6-linux.log.gz) · [Архитектура Recovery](docs/diagnostics/RECOVERY_PRODUCT_RU.md) · [Исправления rc5](docs/diagnostics/RC5_SECOND_AUDIT.md)

## English

Option 20 adds a whole physical HDD/SSD read-only scan with explicit `READ diskN` consent. No target writes, repair, erasure or automatic mount changes; OS/log writes are not blocked. Core 64-bit Perl, diskutil, access and a compatible profile are required, not a compiler. It stops on the first read failure. PASS covers readability only; partial scans are incomplete. Keep failing-drive data recovery ahead of diagnostic scanning. Existing file-write test 17 and quarantined destructive modes remain separate. The 238 Linux software regressions do not establish real macOS/Recovery/physical-drive validation. Offline: `bash st.sh --offline selftest`.
