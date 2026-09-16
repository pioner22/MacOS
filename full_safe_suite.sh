#!/bin/bash
# Comprehensive non-destructive suite. No destructive internal-SSD write test.
# Dependency rule: do not interpret CPU/GPU/hash/download results after a RAM failure.
set +u
BASE='https://raw.githubusercontent.com/pioner22/MacOS/main'
TMP="/tmp/full-safe-suite-$$.sh"
TOTAL=0; PASS=0; FAILS=0; INCONCLUSIVE=0; LAST_RC=99
run_one(){
  NAME=$1; FILE=$2
  TOTAL=$((TOTAL+1)); LAST_RC=99
  echo '================================================================'
  echo "SUITE_TEST_START=$NAME script=$FILE"
  rm -f "$TMP"
  curl -fL --retry 2 --connect-timeout 20 -H 'Cache-Control: no-cache' "$BASE/$FILE?t=$(date +%s 2>/dev/null || echo 0)" -o "$TMP" || {
    LAST_RC=3; INCONCLUSIVE=$((INCONCLUSIVE+1)); echo "SUITE_TEST_RESULT=$NAME:INCONCLUSIVE fetch_failed"; return 0;
  }
  /bin/bash -n "$TMP" || { LAST_RC=3; INCONCLUSIVE=$((INCONCLUSIVE+1)); echo "SUITE_TEST_RESULT=$NAME:INCONCLUSIVE syntax_failed"; return 0; }
  /bin/bash "$TMP"; LAST_RC=$?
  case "$LAST_RC" in
    0) PASS=$((PASS+1)); echo "SUITE_TEST_RESULT=$NAME:PASS";;
    2) FAILS=$((FAILS+1)); echo "SUITE_TEST_RESULT=$NAME:FAIL";;
    3) INCONCLUSIVE=$((INCONCLUSIVE+1)); echo "SUITE_TEST_RESULT=$NAME:INCONCLUSIVE rc=3";;
    4) INCONCLUSIVE=$((INCONCLUSIVE+1)); echo "SUITE_TEST_RESULT=$NAME:REBOOT_REQUIRED";;
    *) INCONCLUSIVE=$((INCONCLUSIVE+1)); echo "SUITE_TEST_RESULT=$NAME:INCONCLUSIVE rc=$LAST_RC";;
  esac
  return 0
}

finish(){
  rm -f "$TMP"
  echo '================================================================'
  echo "SUITE_SUMMARY total=$TOTAL pass=$PASS fail=$FAILS inconclusive=$INCONCLUSIVE"
}

echo 'MODE=SAFE_FULL_SUITE_V3'
echo 'RU: Комплексная недеструктивная диагностика. Сначала проверяется сам toolkit, затем базовое железо и RAM. При RAM FAIL зависимые тесты блокируются.'
echo 'EN: Comprehensive non-destructive diagnostics. Toolkit, baseline hardware and RAM run first; RAM failure gates dependent tests.'

run_one TOOLKIT_SELFTEST toolkit_selftest.sh
SELF_RC=$LAST_RC
if [ "$SELF_RC" -ne 0 ]; then
  finish
  echo 'RESULT=INCONCLUSIVE_TOOLKIT'
  echo 'RU: Сам диагностический комплект не прошёл self-test; аппаратные выводы дальше ненадёжны.'
  echo 'EN: The diagnostic toolkit failed self-test; further hardware conclusions would be unreliable.'
  exit 3
fi

run_one HARDWARE hardware_probe.sh
run_one POWER_THERMAL power_thermal_test.sh
run_one RAM_QUICK ram_quick_test.sh
RAM_RC=$LAST_RC
if [ "$RAM_RC" -eq 2 ]; then
  echo 'SUITE_DEPENDENT_TESTS=SKIPPED_BY_RAM_FAIL'
  echo 'RU: CPU/cache, GPU/VRAM, DOWNLOAD и другие integrity-sensitive тесты не запускаются: плохая RAM может создавать ложные результаты.'
  echo 'EN: CPU/cache, GPU/VRAM, DOWNLOAD and other integrity-sensitive tests are skipped because bad RAM can create false results.'
  finish
  echo 'RESULT=FAIL'
  echo 'NEXT_RU: Холодная загрузка -> RAM MAP -> RAM FULL. После ремонта/стабильного PASS повторите SAFE FULL SUITE.'
  echo 'NEXT_EN: Cold boot -> RAM MAP -> RAM FULL. After repair/stable PASS, rerun SAFE FULL SUITE.'
  exit 2
elif [ "$RAM_RC" -ne 0 ]; then
  echo 'SUITE_DEPENDENT_TESTS=SKIPPED_BY_RAM_INCONCLUSIVE'
  finish
  echo 'RESULT=INCONCLUSIVE'
  echo 'RU: RAM не дала достоверный PASS, поэтому зависимые тесты намеренно не запускаются.'
  echo 'EN: RAM did not produce a reliable PASS, so dependent tests are intentionally skipped.'
  exit 3
fi

run_one CPU_CACHE cpu_test.sh
run_one GPU_VRAM gpu_test.sh
run_one DISPLAY_VIDEO display_video_test.sh
run_one NETWORK network_test.sh
run_one DOWNLOAD download_test.sh
finish

if [ "$FAILS" -gt 0 ]; then
  echo 'RESULT=FAIL'
  echo 'RU: После чистого RAM gate минимум один независимый тест дал подтверждённый FAIL.'
  echo 'EN: After a clean RAM gate, at least one independent test returned confirmed FAIL.'
  exit 2
fi
if [ "$INCONCLUSIVE" -gt 0 ]; then
  echo 'RESULT=INCONCLUSIVE'
  echo 'RU: Подтверждённых ошибок после RAM gate нет, но часть тестов недоступна в текущей среде (в Recovery это ожидаемо для Metal/display).' 
  echo 'EN: No confirmed failures after the RAM gate, but some tests are unavailable in this environment (expected for Metal/display in Recovery).'
  echo 'NEXT_RU: Повторите недоступные тесты из полной macOS.'
  echo 'NEXT_EN: Repeat unavailable tests from full macOS.'
  exit 3
fi
echo 'RESULT=PASS'
echo 'RU: Все доступные недеструктивные тесты завершились без обнаруженной ошибки.'
echo 'EN: All available non-destructive tests completed without a detected failure.'
echo 'NEXT_RU: При необходимости отдельно запустите RAM FULL и destructive SSD/HDD.'
echo 'NEXT_EN: If needed, run RAM FULL and destructive SSD/HDD separately.'
exit 0
