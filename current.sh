#!/bin/bash
# Bilingual menu with observed model/OS profiles. Bash 3.2 compatible.
set +u
umask 077
BASE='https://raw.githubusercontent.com/pioner22/MacOS/main'
# Pin the profile dependency; user-selected profiles cannot replace its code.
PROFILE_REF='0066767965fd72891aa986ade505be95b186f8fe'
WORK=$(mktemp -d /tmp/macdiag-menu.XXXXXX) || exit 3
TMP="$WORK/selected.sh"
PROFILE="$WORK/profile.sh"
LOG="$WORK/session.log"
cleanup(){ rm -f "$TMP" "$PROFILE"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
if ! curl -q -fL --retry 2 --connect-timeout 20 --max-time 120 \
  "https://raw.githubusercontent.com/pioner22/MacOS/$PROFILE_REF/diagnostic_profile.sh" -o "$PROFILE"; then
  echo 'RESULT=INCONCLUSIVE profile_fetch_failed'
  echo 'RU: Не загружен профиль; аппаратные тесты не запущены.'
  echo 'EN: Profile download failed; hardware tests were not started.'
  exit 3
fi
/bin/bash -n "$PROFILE" || { echo 'RESULT=INCONCLUSIVE profile_syntax_failed'; exit 3; }
. "$PROFILE"
dp_detect
dp_apply auto auto auto || exit 3

while :; do
  dp_show
  cat <<'MENU'
=======================================================================
 MacBook Hardware Diagnostics / Аппаратная диагностика Mac
=======================================================================
 1) SSD/HDD / Накопитель: РАЗРУШИТЕЛЬНЫЙ тест / DESTRUCTIVE test
    Legacy engine: internal Apple SSD ~1 TB, A2141 Recovery only.
    Старый движок: внутренний Apple SSD около 1 ТБ, только A2141 Recovery.
 2) RAM QUICK / Быстрая RAM
 3) RAM FULL HARDCORE / Полная RAM
 4) RAM MAP / Карта событий RAM (не физических микросхем)
 5) CPU/CACHE / Вычислительный тест CPU/кэша
 6) GPU/VRAM / Графика и видеопамять (Recovery: только сбор сведений)
 7) VIDEO/DISPLAY / Видео и экран (визуальная проверка)
 8) NETWORK / Сеть, DNS, TCP, TLS
 9) DOWNLOAD / Скачивание и контрольные суммы
10) POWER/THERMAL / Наблюдение за питанием и нагревом
11) HARDWARE SNAPSHOT / Сведения об оборудовании
12) SAFE FULL SUITE / Комплекс без разрушительного SSD-теста
13) FULL COMPLEX / Комплекс с разрушительным SSD-тестом последним
14) TOOLKIT SELFTEST / Проверка файлов и сборки комплекта
15) MODEL / OS PROFILE / Выбор модели, ОС и среды
 0) EXIT / Выход
=======================================================================
RU: По умолчанию автоопределение. Пункт 15 меняет профиль, НЕ устанавливает ОС.
EN: Automatic detection is the default. Option 15 selects a profile, NOT an OS installation.
MENU
  printf 'Select / Выбор [0-15]: '
  if ! dp_read_reply; then
    echo 'RESULT=INCONCLUSIVE no_interactive_input'; exit 3
  fi
  CHOICE=$DP_REPLY
  case "$CHOICE" in
    0|q|Q|quit|exit|'') echo 'EXIT=USER_REQUEST'; exit 0;;
    15|profile|PROFILE)
      dp_detect
      dp_choose || exit 3
      continue;;
    1|ssd|SSD|hdd|HDD) SCRIPT=ssd_test.sh; LABEL=SSD_HDD;;
    2) SCRIPT=ram_quick_test.sh; LABEL=RAM_QUICK;;
    3|ram|RAM) SCRIPT=ram_full_test.sh; LABEL=RAM_FULL;;
    4|map|MAP) SCRIPT=ram_map.sh; LABEL=RAM_MAP;;
    5|cpu|CPU) SCRIPT=cpu_test.sh; LABEL=CPU_CACHE;;
    6|gpu|GPU|vram|VRAM) SCRIPT=gpu_test.sh; LABEL=GPU_VRAM;;
    7|video|VIDEO|display|DISPLAY) SCRIPT=display_video_test.sh; LABEL=DISPLAY;;
    8|net|NET|network|NETWORK) SCRIPT=network_test.sh; LABEL=NETWORK;;
    9|download|DOWNLOAD) SCRIPT=download_test.sh; LABEL=DOWNLOAD;;
    10|power|POWER|thermal|THERMAL) SCRIPT=power_thermal_test.sh; LABEL=POWER;;
    11|hw|HW|hardware|HARDWARE) SCRIPT=hardware_probe.sh; LABEL=HARDWARE;;
    12|safe|SAFE) SCRIPT=full_safe_suite.sh; LABEL=SAFE_SUITE;;
    13|suite|SUITE|full|FULL|all|ALL) SCRIPT=full_all_suite.sh; LABEL=FULL_SUITE;;
    14|selftest|SELFTEST) SCRIPT=toolkit_selftest.sh; LABEL=TOOLKIT;;
    *) echo 'RU: Неизвестный пункт. EN: Unknown selection.'; continue;;
  esac
  break
done

# Re-observe rather than trusting a stored/manual hardware assertion.
dp_detect
dp_apply "$MACDIAG_MODEL_REQUEST" "$MACDIAG_OS_REQUEST" "$MACDIAG_ENV_REQUEST" || exit 3
dp_allow "$SCRIPT" || exit 3
dp_show > "$LOG"
echo "SELECTED=$LABEL PROFILE_REF=$PROFILE_REF"
if ! curl -q -fL --retry 2 --connect-timeout 20 --max-time 120 \
  -H 'Cache-Control: no-cache' "$BASE/$SCRIPT?t=$(date +%s)" -o "$TMP"; then
  echo 'RESULT=INCONCLUSIVE script_fetch_failed'
  echo 'RU: Скрипт не загружен. EN: Diagnostic script could not be downloaded.'
  exit 3
fi
/bin/bash -n "$TMP" || { echo 'RESULT=INCONCLUSIVE script_syntax_failed'; exit 3; }
/bin/bash "$TMP" 2>&1 | tee -a "$LOG"
P=("${PIPESTATUS[@]}")
RC=${P[0]:-3}
if [ "${P[1]:-1}" -ne 0 ] && [ "$RC" -eq 0 ]; then RC=3; fi
printf '\nTEST_FINISHED=%s EXIT_CODE=%s\nLOG_PATH=%s\n' "$LABEL" "$RC" "$LOG"
case "$RC" in
  0) echo 'RU: Команда завершена; итог и охват — в отчёте теста. Это не гарантия исправности всего Mac.'
     echo 'EN: Command completed; see the test report for result and scope, not whole-Mac certification.';;
  2) echo 'RU: Тест сообщил FAIL. По одному коду нельзя определить сломанную микросхему; проверьте лог и независимое воспроизведение.'
     echo 'EN: The test reported FAIL. An exit code cannot identify a failed chip; inspect the log and independently reproduce.';;
  3) echo 'RU: Недостаточно данных или ограничения среды; это не аппаратный диагноз.'
     echo 'EN: Incomplete result or environment limitation; this is not a hardware diagnosis.';;
  4) echo 'RU: Нужна перезагрузка для продолжения; весь тест ещё не завершён.'
     echo 'EN: A reboot is required to continue; the full test has not finished.';;
  *) echo 'RU: Нештатное завершение. Сначала разберите лог.'
     echo 'EN: Unexpected termination. Inspect the log first.';;
esac
if [ "$RC" -eq 4 ]; then
  echo 'NEXT_RU: Перезагрузитесь в Recovery; той же командой откройте меню и продолжите SSD-тест.'
  echo 'NEXT_EN: Reboot into Recovery; open the same menu command and continue the SSD test.'
else
  echo 'NEXT_RU: Сохраните лог. При ограничении профиля проверьте пункт 15; при ошибке теста не начинайте разрушительные проверки.'
  echo 'NEXT_EN: Preserve the log. For a profile restriction check option 15; do not start destructive tests after a failure.'
fi
exit "$RC"
