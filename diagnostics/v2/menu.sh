#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
D_ROOT=$(cd "$(dirname "$0")/../.." && pwd -P) || exit 3
. "$D_ROOT/diagnostics/v2/profile.sh"
. "$D_ROOT/diagnostics/v2/core.sh"
p_detect;p_apply auto auto auto || exit 3
if [ "${1:-}" = --run ];then shift;exec /bin/bash "$D_ROOT/diagnostics/v2/run.sh" "$@";fi
while :;do
 p_show
 cat <<'MENU'
=====================================================================
 MacDiag 0.3.0-rc1 — RU / EN
 1) SSD/HDD: новый тестовый файл / New test file (NO RAW WRITE)
 2) RAM QUICK / Быстрая проверка
 3) RAM FULL / Полная нативная проверка
 4) RAM MAP / Карта виртуальных событий (не DRAM-чипов)
 5) CPU / SHA execution stress
 6) GPU/VRAM / Metal data-path test
 7) DISPLAY / Сведения и ручная проверка экрана
 8) NETWORK / Малые HTTPS, DNS/TCP/TLS
 9) DOWNLOAD / Размер + SHA-256 + HTTP Range
10) POWER / Наблюдение за питанием
11) HARDWARE / Сведения об оборудовании
12) SAFE SUITE / Короткий комплекс без файлового I/O-теста
13) FULL SUITE / Неразрушительный полный комплекс
14) SELFTEST / Проверка самого пакета
15) MODEL/OS / Профиль модели и загруженной ОС
16) POST-REPAIR / Приёмка после ремонта (не стирает SSD)
 0) EXIT / Выход
RU: Разрушительный старый SSD-движок исключён из активного пакета.
EN: Legacy destructive SSD backend is not part of the active package.
MENU
 printf 'Select / Выбор: '
 IFS= read -r choice </dev/tty || exit 3
 case "$choice" in
  0|'') exit 0;;15) if ! p_choose;then echo 'PROFILE_MISMATCH / Несовпадение профиля';p_apply auto auto auto;fi;continue;;
  1) mode=storage;;2) mode=ram-quick;;3) mode=ram-full;;4) mode=ram-map;;
  5) mode=cpu;;6) mode=gpu;;7) mode=display;;8) mode=network;;9) mode=download;;
  10) mode=power;;11) mode=hardware;;12) mode=safe;;13|16) mode=acceptance;;14) mode=selftest;;
  *) echo 'UNKNOWN_SELECTION / Неизвестный пункт';continue;;
 esac
 if [ "$mode" = storage ] || [ "$mode" = acceptance ];then
  printf 'RU: Каталог для НОВОГО тестового файла (полный путь; пусто = пропустить).\nEN: Directory for a NEW test file (absolute path; empty = skip).\n> '
  IFS= read -r MACDIAG_STORAGE_DIR </dev/tty || exit 3
  export MACDIAG_STORAGE_DIR
 fi
 exec /bin/bash "$D_ROOT/diagnostics/v2/run.sh" "$mode"
done
