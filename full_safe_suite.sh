#!/bin/bash
# Non-destructive diagnostic suite. Does not run destructive storage writes.
set +u
BASE='https://raw.githubusercontent.com/pioner22/MacOS/main'
TMP='/tmp/full-suite-script-$$.sh'
TOTAL=0; PASS=0; FAILS=0; INCONCLUSIVE=0
run_one(){
  NAME=$1; FILE=$2
  TOTAL=$((TOTAL+1))
  echo '============================================================'
  echo "SUITE_TEST_START=$NAME"
  rm -f "$TMP"
  curl -fL --retry 2 --connect-timeout 20 -H 'Cache-Control: no-cache' "$BASE/$FILE?t=$(date +%s 2>/dev/null || echo 0)" -o "$TMP" || {
    echo "SUITE_TEST_FETCH_FAIL=$NAME"; FAILS=$((FAILS+1)); return;
  }
  /bin/bash -n "$TMP" || { echo "SUITE_TEST_SYNTAX_FAIL=$NAME"; FAILS=$((FAILS+1)); return; }
  /bin/bash "$TMP"
  RC=$?
  case "$RC" in
    0) PASS=$((PASS+1)); echo "SUITE_TEST_RESULT=$NAME:PASS";;
    2) FAILS=$((FAILS+1)); echo "SUITE_TEST_RESULT=$NAME:FAIL";;
    *) INCONCLUSIVE=$((INCONCLUSIVE+1)); echo "SUITE_TEST_RESULT=$NAME:INCONCLUSIVE rc=$RC";;
  esac
}

run_one HARDWARE hardware_probe.sh
run_one CPU_CACHE cpu_test.sh
run_one NETWORK network_test.sh
run_one GPU_VRAM gpu_test.sh
run_one POWER_THERMAL power_thermal_test.sh
rm -f "$TMP"
echo '============================================================'
echo "SUITE_SUMMARY total=$TOTAL pass=$PASS fail=$FAILS inconclusive=$INCONCLUSIVE"
if [ "$FAILS" -gt 0 ]; then echo 'FINAL=FAIL_HARDWARE_SUITE'; exit 2; fi
if [ "$INCONCLUSIVE" -gt 0 ]; then echo 'FINAL=INCONCLUSIVE_HARDWARE_SUITE'; exit 3; fi
echo 'FINAL=PASS_HARDWARE_SUITE'; exit 0
