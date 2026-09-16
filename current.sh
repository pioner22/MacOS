#!/bin/bash
# Interactive bilingual hardware diagnostic menu for macOS Internet Recovery / full macOS.
# Permanent entry: curl -L https://raw.githubusercontent.com/pioner22/MacOS/main/st.sh|bash
set +u
BASE='https://raw.githubusercontent.com/pioner22/MacOS/main'
TMP="/tmp/diag-menu-run-$$.sh"
rm -f "$TMP"

printf '\n'
printf '=======================================================================\n'
printf ' MacBook Hardware Diagnostic Menu / Меню аппаратной диагностики\n'
printf '=======================================================================\n'
printf ' 1) SSD/HDD TEST / НАКОПИТЕЛЬ\n'
printf '    Full-LBA MHDD-like test. WARNING: destructive writes may occur.\n'
printf '    Полный LBA-тест. ВНИМАНИЕ: возможна полная перезапись SSD/HDD.\n'
printf '\n'
printf ' 2) RAM QUICK / БЫСТРАЯ RAM\n'
printf '    Fast 8 GiB pattern screening / Быстрый скрининг 8 GiB памяти.\n'
printf '\n'
printf ' 3) RAM FULL HARDCORE / ПОЛНАЯ RAM\n'
printf '    Large allocations, retention, walking/address patterns, 40 GiB bridge.\n'
printf '    Большие объёмы, удержание, walking/address, RAM->RESCUE 40 GiB.\n'
printf '\n'
printf ' 4) RAM MAP / КАРТА RAM\n'
printf '    Continue after errors and map byte/bit/XOR patterns.\n'
printf '    Не останавливаться на первой ошибке; карта байтов/битов/XOR.\n'
printf '\n'
printf ' 5) CPU/CACHE / CPU И КЭШ\n'
printf ' 6) GPU/VRAM / GPU И ВИДЕОПАМЯТЬ\n'
printf ' 7) VIDEO/DISPLAY / ВИДЕО И ЭКРАН\n'
printf ' 8) NETWORK / СЕТЬ, DNS, TLS\n'
printf ' 9) DOWNLOAD / СКАЧИВАНИЕ И ЦЕЛОСТНОСТЬ\n'
printf '10) POWER/THERMAL / ПИТАНИЕ И ТЕМПЕРАТУРЫ\n'
printf '11) HARDWARE SNAPSHOT / СНИМОК ЖЕЛЕЗА\n'
printf '12) SAFE FULL SUITE / БЕЗОПАСНЫЙ КОМПЛЕКС\n'
printf '    No destructive SSD write / Без разрушительной записи SSD.\n'
printf '13) FULL COMPLEX / ПОЛНЫЙ КОМПЛЕКС\n'
printf '    All tests; destructive SSD is last and RAM-gated.\n'
printf '    Все тесты; destructive SSD последним и только после RAM gate.\n'
printf '14) TOOLKIT SELFTEST / ПРОВЕРКА САМИХ СКРИПТОВ\n'
printf '    Syntax, file wiring, SSD assembly, known hashes. No hardware test.\n'
printf '    Синтаксис, связи файлов, сборка SSD, эталонные hash. Железо не тестирует.\n'
printf '\n'
printf ' 0) EXIT / ВЫХОД\n'
printf '=======================================================================\n'
printf 'Select / Выбор [0-14]: '

CHOICE=''
if [ -r /dev/tty ]; then IFS= read CHOICE </dev/tty; else IFS= read CHOICE; fi

case "$CHOICE" in
  1|ssd|SSD|hdd|HDD) SCRIPT='ssd_test.sh'; LABEL='SSD/HDD TEST'; NEXT_RU='При FAIL сначала отдельно проверьте RAM/T2/I/O path; при PASS повторите после ремонта остальных узлов.'; NEXT_EN='On FAIL, isolate RAM/T2/I/O path; on PASS, repeat after other repairs.';;
  2) SCRIPT='ram_quick_test.sh'; LABEL='RAM QUICK'; NEXT_RU='При FAIL: холодная загрузка -> RAM MAP -> RAM FULL.'; NEXT_EN='On FAIL: cold boot -> RAM MAP -> RAM FULL.';;
  3|ram|RAM) SCRIPT='ram_full_test.sh'; LABEL='RAM FULL HARDCORE'; NEXT_RU='При повторяемом mismatch диагностируйте DRAM/BGA/питание/IMC.'; NEXT_EN='For reproducible mismatch, diagnose DRAM/BGA/power/IMC.';;
  4|map|MAP) SCRIPT='ram_map.sh'; LABEL='RAM MAP'; NEXT_RU='Сохраните несколько логов холодных загрузок и сравните XOR/битовые маски.'; NEXT_EN='Keep several cold-boot logs and compare XOR/bit patterns.';;
  5|cpu|CPU) SCRIPT='cpu_test.sh'; LABEL='CPU/CACHE'; NEXT_RU='При FAIL сначала исключите RAM, затем CPU/cache/IMC/питание.'; NEXT_EN='On FAIL, exclude RAM first, then CPU/cache/IMC/power.';;
  6|gpu|GPU|vram|VRAM) SCRIPT='gpu_test.sh'; LABEL='GPU/VRAM'; NEXT_RU='Настоящий Metal VRAM readback выполняйте из полной macOS; Recovery может дать INCONCLUSIVE.'; NEXT_EN='Run true Metal VRAM readback from full macOS; Recovery may be INCONCLUSIVE.';;
  7|video|VIDEO|display|DISPLAY) SCRIPT='display_video_test.sh'; LABEL='VIDEO/DISPLAY'; NEXT_RU='Если артефакт виден, сравните с screenshot: есть в screenshot = GPU/framebuffer; нет = panel/eDP/TCON.'; NEXT_EN='If an artifact is visible, compare with a screenshot: present in screenshot = GPU/framebuffer; absent = panel/eDP/TCON.';;
  8|net|NET|network|NETWORK) SCRIPT='network_test.sh'; LABEL='NETWORK'; NEXT_RU='При FAIL повторите через Ethernet/другую сеть и затем DOWNLOAD TEST.'; NEXT_EN='On FAIL retry over Ethernet/another network, then run DOWNLOAD TEST.';;
  9|download|DOWNLOAD) SCRIPT='download_test.sh'; LABEL='DOWNLOAD'; NEXT_RU='При hash mismatch сначала исключите RAM, затем сеть/TLS/CDN.'; NEXT_EN='On hash mismatch, exclude RAM first, then network/TLS/CDN.';;
  10|power|POWER|thermal|THERMAL) SCRIPT='power_thermal_test.sh'; LABEL='POWER/THERMAL'; NEXT_RU='Сопоставляйте ошибки RAM/GPU/SSD со временем, питанием и нагревом.'; NEXT_EN='Correlate RAM/GPU/SSD faults with time, power state and temperature.';;
  11|hw|HW|hardware|HARDWARE) SCRIPT='hardware_probe.sh'; LABEL='HARDWARE SNAPSHOT'; NEXT_RU='Сохраните лог как исходную конфигурацию для ремонта.'; NEXT_EN='Keep the log as the repair baseline.';;
  12|safe|SAFE) SCRIPT='full_safe_suite.sh'; LABEL='SAFE FULL SUITE'; NEXT_RU='После безопасного комплекса отдельно запускайте RAM FULL и при необходимости SSD/HDD.'; NEXT_EN='After the safe suite, run RAM FULL and SSD/HDD separately if needed.';;
  13|suite|SUITE|full|FULL|all|ALL) SCRIPT='full_all_suite.sh'; LABEL='FULL COMPLEX'; NEXT_RU='Комплекс сам блокирует dependent/destructive тесты, если RAM не прошла.'; NEXT_EN='The suite automatically blocks dependent/destructive tests if RAM does not pass.';;
  14|selftest|SELFTEST) SCRIPT='toolkit_selftest.sh'; LABEL='TOOLKIT SELFTEST'; NEXT_RU='При FAIL сначала исправьте диагностический комплект; это не аппаратный FAIL Mac.'; NEXT_EN='On FAIL, fix the diagnostic toolkit first; this is not a Mac hardware FAIL.';;
  0|q|Q|quit|exit|'') echo 'EXIT=USER_REQUEST'; exit 0;;
  *) echo "STOP: unknown selection / неизвестный пункт: $CHOICE" >&2; exit 1;;
esac

echo "SELECTED=$LABEL"
URL="$BASE/$SCRIPT?t=$(date +%s 2>/dev/null || echo 0)"
curl -fL --retry 2 --connect-timeout 20 -H 'Cache-Control: no-cache' "$URL" -o "$TMP" || {
  echo "RESULT=INCONCLUSIVE fetch_failed=$SCRIPT"
  echo 'RU: Не удалось загрузить диагностический скрипт.'
  echo 'EN: Failed to download the diagnostic script.'
  rm -f "$TMP"; exit 3;
}
/bin/bash -n "$TMP" || {
  echo "RESULT=INCONCLUSIVE syntax_failed=$SCRIPT"
  echo 'RU: Скрипт не прошёл проверку синтаксиса; аппаратный вывод не делаем.'
  echo 'EN: Script syntax validation failed; no hardware conclusion is made.'
  rm -f "$TMP"; exit 3;
}
/bin/bash "$TMP"
RC=$?
rm -f "$TMP"

echo '======================================================================='
echo "TEST_FINISHED=$LABEL EXIT_CODE=$RC"
case "$RC" in
  0)
    echo 'STATE_RU=PASS/ЭТАП_ЗАВЕРШЁН'
    echo 'STATE_EN=PASS/STAGE_COMPLETE'
    echo 'RU: В рамках выполненного этапа подтверждённая ошибка не зарегистрирована.'
    echo 'EN: No confirmed failure was recorded within the completed stage.';;
  2)
    if [ "$LABEL" = 'TOOLKIT SELFTEST' ]; then
      echo 'STATE_RU=TOOLKIT_FAIL/ОШИБКА_ДИАГНОСТИЧЕСКОГО_КОМПЛЕКТА'
      echo 'STATE_EN=TOOLKIT_FAIL'
      echo 'RU: Ошибка относится к файлам/логике диагностического комплекта, а не является доказательством поломки Mac.'
      echo 'EN: The failure is in the diagnostic toolkit/files and is not evidence of Mac hardware failure.'
    else
      echo 'STATE_RU=FAIL/ПОДТВЕРЖДЁННАЯ_ОШИБКА'
      echo 'STATE_EN=FAIL/CONFIRMED_FAILURE'
      echo 'RU: Тест обнаружил фактическую ошибку данных, вычисления или I/O.'
      echo 'EN: The test detected an actual data, computation, or I/O failure.'
    fi;;
  3)
    echo 'STATE_RU=INCONCLUSIVE/НЕДОСТАТОЧНО_ДАННЫХ'
    echo 'STATE_EN=INCONCLUSIVE'
    echo 'RU: Текущая среда не позволила получить достоверный PASS/FAIL.'
    echo 'EN: The current environment could not produce a reliable PASS/FAIL.';;
  4)
    echo 'STATE_RU=REBOOT_REQUIRED/НУЖНА_ПЕРЕЗАГРУЗКА'
    echo 'STATE_EN=REBOOT_REQUIRED'
    echo 'RU: Этап успешно завершён, но продолжение требует реальной перезагрузки для холодной проверки.'
    echo 'EN: Stage completed successfully, but continuation requires a real reboot for cold verification.';;
  *)
    echo 'STATE_RU=ERROR/ТЕСТ_ПРЕРВАН'
    echo 'STATE_EN=ERROR/TEST_INTERRUPTED'
    echo 'RU: Скрипт завершился нестандартным кодом; сначала разберите лог, не считайте это автоматически аппаратным FAIL.'
    echo 'EN: The script exited with a nonstandard code; inspect the log before treating it as hardware failure.';;
esac
echo "NEXT_RU=$NEXT_RU"
echo "NEXT_EN=$NEXT_EN"
echo '======================================================================='
exit "$RC"
