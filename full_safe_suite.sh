#!/bin/bash
# Comprehensive non-destructive suite. No destructive internal-SSD write test.
set +u
BASE='https://raw.githubusercontent.com/pioner22/MacOS/main'
TMP="/tmp/full-safe-suite-$$.sh"
TOTAL=0; PASS=0; FAILS=0; INCONCLUSIVE=0
run_one(){
  NAME=$1; FILE=$2
  TOTAL=$((TOTAL+1))
  echo '================================================================'
  echo "SUITE_TEST_START=$NAME script=$FILE"
  rm -f "$TMP"
  curl -fL --retry 2 --connect-timeout 20 -H 'Cache-Control: no-cache' "$BASE/$FILE?t=$(date +%s 2>/dev/null || echo 0)" -o "$TMP" || {
    echo "SUITE_TEST_RESULT=$NAME:INCONCLUSIVE fetch_failed"; INCONCLUSIVE=$((INCONCLUSIVE+1)); return;
  }
  /bin/bash -n "$TMP" || { echo "SUITE_TEST_RESULT=$NAME:INCONCLUSIVE syntax_failed"; INCONCLUSIVE=$((INCONCLUSIVE+1)); return; }
  /bin/bash "$TMP"; RC=$?
  case "$RC" in
    0) PASS=$((PASS+1)); echo "SUITE_TEST_RESULT=$NAME:PASS";;
    2) FAILS=$((FAILS+1)); echo "SUITE_TEST_RESULT=$NAME:FAIL";;
    *) INCONCLUSIVE=$((INCONCLUSIVE+1)); echo "SUITE_TEST_RESULT=$NAME:INCONCLUSIVE rc=$RC";;
  esac
}

echo 'MODE=SAFE_FULL_SUITE_V2'
echo 'RU: Комплексная недеструктивная диагностика. Полная разрушительная проверка SSD сюда не входит.'
echo 'EN: Comprehensive non-destructive diagnostics. Destructive full SSD testing is excluded.'
run_one HARDWARE hardware_probe.sh
run_one RAM_QUICK ram_quick_test.sh
run_one CPU_CACHE cpu_test.sh
run_one GPU_VRAM gpu_test.sh
run_one DISPLAY_VIDEO display_video_test.sh
run_one NETWORK network_test.sh
run_one DOWNLOAD download_test.sh
run_one POWER_THERMAL power_thermal_test.sh
rm -f "$TMP"
echo '================================================================'
echo "SUITE_SUMMARY total=$TOTAL pass=$PASS fail=$FAILS inconclusive=$INCONCLUSIVE"
if [ "$FAILS" -gt 0 ]; then
  echo 'RESULT=FAIL'
  echo 'RU: Комплекс обнаружил минимум одну подтверждённую ошибку. Смотрите первый FAIL и устраняйте его до доверия остальным зависимым тестам.'
  echo 'EN: The suite found at least one confirmed failure. Address the first FAIL before trusting dependent test results.'
  echo 'NEXT_RU: Если FAIL относится к RAM, сначала ремонтируйте/диагностируйте memory subsystem; затем повторите весь комплекс.'
  echo 'NEXT_EN: If RAM failed, diagnose/repair the memory subsystem first, then repeat the whole suite.'
  exit 2
fi
if [ "$INCONCLUSIVE" -gt 0 ]; then
  echo 'RESULT=INCONCLUSIVE'
  echo 'RU: Подтверждённых ошибок нет, но часть тестов недоступна в текущей среде.'
  echo 'EN: No confirmed failure, but some tests are unavailable in the current environment.'
  echo 'NEXT_RU: Повторите недоступные тесты из полной macOS (особенно Metal GPU/VRAM).'
  echo 'NEXT_EN: Repeat unavailable tests from full macOS (especially Metal GPU/VRAM).'
  exit 3
fi
echo 'RESULT=PASS'
echo 'RU: Все доступные недеструктивные тесты завершились без обнаруженной ошибки.'
echo 'EN: All available non-destructive tests completed without a detected failure.'
echo 'NEXT_RU: При необходимости отдельно запустите Полный RAM и destructive SSD/HDD тест.'
echo 'NEXT_EN: If needed, run Full RAM and destructive SSD/HDD tests separately.'
exit 0
