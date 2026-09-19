#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Menu only. No automatic destructive action and no consent-by-countdown.
ROOT=${MACDIAG_ROOT:-}
[ -n "$ROOT" ] && [ -f "$ROOT/diagnostics/run.sh" ] || {
    echo 'RU: Запустите st.sh. EN: Use the validated st.sh launcher.'; exit 3;
}
cat <<'MENU'
Mac diagnostics 0.2.0-audit — EXPERIMENTAL / ЭКСПЕРИМЕНТАЛЬНО
 1  Storage file test / Тест файла на диске (НЕ full-LBA)
 2  RAM quick / Быстрая RAM
 3  RAM full / Полная RAM (нагрузка, отдельное подтверждение)
 4  RAM map / События ошибок (адреса НЕ физические)
 5  CPU hash / Проверка вычислений (НЕ изолированный тест кэша)
 6  GPU data path / Metal fill/readback (полная macOS + compiler)
 7  Display information / Сведения об экране, не аппаратный вердикт
 8  Network / HTTPS-соединение
 9  Downloads / Проверка размера и SHA-256 (по умолчанию до 32 MiB)
10  Power information / Наблюдение питания
11  Hardware information / Конфигурация
12  Safe suite / Неразрушающий комплекс
13  Extended suite / Неразрушающий комплекс + полная RAM
14  Package self-test / Проверка пакета, синтаксиса и SHA-вектора
 0  Exit / Выход
Legacy raw SSD writes are BLOCKED pending qualification.
Прежняя полная перезапись SSD заблокирована до отдельной проверки безопасности.
MENU
choice=''
if ! { exec 3</dev/tty; } 2>/dev/null; then
    echo 'RESULT=CANCELLED no_tty'; exit 130
fi
printf 'Select / Выбор [0-14]: '
IFS= read -r choice <&3; rc=$?; exec 3<&-
[ "$rc" -eq 0 ] || exit 130
case "$choice" in
  0|'') echo 'RESULT=CANCELLED user_exit'; exit 130;;
  1) mode=storage;; 2) mode=ram-quick;; 3) mode=ram-full;; 4) mode=ram-map;;
  5) mode=cpu;; 6) mode=gpu;; 7) mode=display;; 8) mode=network;; 9) mode=download;;
  10) mode=power;; 11) mode=hardware;; 12) mode=safe;; 13) mode=full;; 14) mode=selftest;;
  *) echo 'RESULT=INCONCLUSIVE unknown_choice'; exit 3;;
esac
exec /bin/bash "$ROOT/diagnostics/run.sh" "$mode"
