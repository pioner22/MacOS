#!/bin/bash
# Full comprehensive diagnostic suite.
# Runs non-destructive diagnostics first, then destructive storage only if RAM tests do not fail.
set +u
BASE='https://raw.githubusercontent.com/pioner22/MacOS/main'
TMP="/tmp/full-all-suite-$$.sh"
TOTAL=0; PASS=0; FAILS=0; INCONCLUSIVE=0; RAM_FAIL=0; RAM_INCONCLUSIVE=0
run_one(){
  NAME=$1; FILE=$2; DOMAIN=$3
  TOTAL=$((TOTAL+1))
  echo '================================================================'
  echo "FULL_SUITE_TEST_START=$NAME script=$FILE domain=$DOMAIN"
  rm -f "$TMP"
  curl -fL --retry 2 --connect-timeout 20 -H 'Cache-Control: no-cache' "$BASE/$FILE?t=$(date +%s 2>/dev/null || echo 0)" -o "$TMP" || {
    echo "FULL_SUITE_TEST_RESULT=$NAME:INCONCLUSIVE fetch_failed"; INCONCLUSIVE=$((INCONCLUSIVE+1)); [ "$DOMAIN" = RAM ] && RAM_INCONCLUSIVE=1; return 3;
  }
  /bin/bash -n "$TMP" || { echo "FULL_SUITE_TEST_RESULT=$NAME:INCONCLUSIVE syntax_failed"; INCONCLUSIVE=$((INCONCLUSIVE+1)); [ "$DOMAIN" = RAM ] && RAM_INCONCLUSIVE=1; return 3; }
  /bin/bash "$TMP"; RC=$?
  case "$RC" in
    0) PASS=$((PASS+1)); echo "FULL_SUITE_TEST_RESULT=$NAME:PASS";;
    2) FAILS=$((FAILS+1)); echo "FULL_SUITE_TEST_RESULT=$NAME:FAIL"; [ "$DOMAIN" = RAM ] && RAM_FAIL=1;;
    *) INCONCLUSIVE=$((INCONCLUSIVE+1)); echo "FULL_SUITE_TEST_RESULT=$NAME:INCONCLUSIVE rc=$RC"; [ "$DOMAIN" = RAM ] && RAM_INCONCLUSIVE=1;;
  esac
  return "$RC"
}

echo 'MODE=FULL_COMPLEX_DIAGNOSTIC_V1'
echo 'RU: Полный комплекс. Сначала безопасные тесты и RAM. Destructive SSD запускается последним и только если RAM не дала FAIL/INCONCLUSIVE.'
echo 'EN: Full suite. Safe tests and RAM run first. Destructive SSD runs last only if RAM has no FAIL/INCONCLUSIVE.'

run_one HARDWARE hardware_probe.sh OTHER || true
run_one RAM_QUICK ram_quick_test.sh RAM || true
run_one RAM_FULL ram_full_test.sh RAM || true
run_one RAM_MAP ram_map.sh RAM || true
run_one CPU_CACHE cpu_test.sh OTHER || true
run_one GPU_VRAM gpu_test.sh OTHER || true
run_one DISPLAY_VIDEO display_video_test.sh OTHER || true
run_one NETWORK network_test.sh OTHER || true
run_one DOWNLOAD download_test.sh OTHER || true
run_one POWER_THERMAL power_thermal_test.sh OTHER || true

if [ "$RAM_FAIL" -ne 0 ] || [ "$RAM_INCONCLUSIVE" -ne 0 ]; then
  echo '================================================================'
  echo 'SSD_DESTRUCTIVE_STAGE=BLOCKED_BY_RAM_GATE'
  echo 'RU: Разрушительный SSD-тест не запускается, потому что RAM дала FAIL или INCONCLUSIVE. При нестабильной памяти storage-hash результаты могут быть ложными.'
  echo 'EN: Destructive SSD testing is blocked because RAM returned FAIL or INCONCLUSIVE. Unstable memory can invalidate storage-hash results.'
  echo "FULL_SUITE_SUMMARY total=$TOTAL pass=$PASS fail=$FAILS inconclusive=$INCONCLUSIVE"
  echo 'RESULT=FAIL_OR_INCONCLUSIVE_RAM_GATE'
  echo 'NEXT_RU: Сначала устраните/подтвердите память. После стабильного RAM PASS запустите полный комплекс снова.'
  echo 'NEXT_EN: Resolve/confirm memory first. After stable RAM PASS, run the full suite again.'
  rm -f "$TMP"; [ "$RAM_FAIL" -ne 0 ] && exit 2 || exit 3
fi

run_one SSD_HDD_DESTRUCTIVE ssd_test.sh STORAGE || true
rm -f "$TMP"
echo '================================================================'
echo "FULL_SUITE_SUMMARY total=$TOTAL pass=$PASS fail=$FAILS inconclusive=$INCONCLUSIVE"
if [ "$FAILS" -gt 0 ]; then
  echo 'RESULT=FAIL'
  echo 'RU: Полный комплекс обнаружил аппаратно значимую ошибку.'
  echo 'EN: Full suite detected a hardware-significant failure.'
  echo 'NEXT_RU: Устраните FAIL-домен и повторите комплекс после холодной загрузки.'
  echo 'NEXT_EN: Repair/isolate the failing domain and repeat after a cold boot.'
  exit 2
fi
if [ "$INCONCLUSIVE" -gt 0 ]; then
  echo 'RESULT=INCONCLUSIVE'
  echo 'RU: Часть тестов недоступна или потребовала перезагрузки/полной macOS.'
  echo 'EN: Some tests were unavailable or require reboot/full macOS.'
  exit 3
fi
echo 'RESULT=PASS'
echo 'RU: Все тесты полного комплекса завершились без обнаруженной ошибки.'
echo 'EN: All full-suite tests completed without a detected failure.'
exit 0
