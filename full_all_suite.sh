#!/bin/bash
# Full comprehensive diagnostic suite.
# Dependency-aware: toolkit -> baseline -> RAM -> dependent tests -> destructive storage.
set +u
BASE='https://raw.githubusercontent.com/pioner22/MacOS/main'
TMP="/tmp/full-all-suite-$$.sh"
TOTAL=0; PASS=0; FAILS=0; INCONCLUSIVE=0; PENDING=0; LAST_RC=99

run_one(){
  NAME=$1; FILE=$2; DOMAIN=$3
  TOTAL=$((TOTAL+1)); LAST_RC=99
  echo '================================================================'
  echo "FULL_SUITE_TEST_START=$NAME script=$FILE domain=$DOMAIN"
  rm -f "$TMP"
  curl -fL --retry 2 --connect-timeout 20 -H 'Cache-Control: no-cache' "$BASE/$FILE?t=$(date +%s 2>/dev/null || echo 0)" -o "$TMP" || {
    LAST_RC=3; INCONCLUSIVE=$((INCONCLUSIVE+1)); echo "FULL_SUITE_TEST_RESULT=$NAME:INCONCLUSIVE fetch_failed"; return 0;
  }
  /bin/bash -n "$TMP" || {
    LAST_RC=3; INCONCLUSIVE=$((INCONCLUSIVE+1)); echo "FULL_SUITE_TEST_RESULT=$NAME:INCONCLUSIVE syntax_failed"; return 0;
  }
  /bin/bash "$TMP"; LAST_RC=$?
  case "$LAST_RC" in
    0) PASS=$((PASS+1)); echo "FULL_SUITE_TEST_RESULT=$NAME:PASS";;
    2) FAILS=$((FAILS+1)); echo "FULL_SUITE_TEST_RESULT=$NAME:FAIL";;
    3) INCONCLUSIVE=$((INCONCLUSIVE+1)); echo "FULL_SUITE_TEST_RESULT=$NAME:INCONCLUSIVE";;
    4) PENDING=$((PENDING+1)); echo "FULL_SUITE_TEST_RESULT=$NAME:REBOOT_REQUIRED";;
    *) INCONCLUSIVE=$((INCONCLUSIVE+1)); echo "FULL_SUITE_TEST_RESULT=$NAME:INCONCLUSIVE rc=$LAST_RC";;
  esac
  return 0
}

summary(){
  rm -f "$TMP"
  echo '================================================================'
  echo "FULL_SUITE_SUMMARY total=$TOTAL pass=$PASS fail=$FAILS inconclusive=$INCONCLUSIVE pending=$PENDING"
}

ram_gate_stop(){
  WHY=$1; CODE=$2
  echo 'DEPENDENT_TESTS=BLOCKED_BY_RAM_GATE'
  echo "RAM_GATE_REASON=$WHY"
  echo 'RU: CPU/GPU/hash/download/SSD integrity-тесты намеренно не продолжаются: нестабильная RAM может дать ложные ошибки и ложные PASS.'
  echo 'EN: CPU/GPU/hash/download/SSD integrity tests are intentionally stopped because unstable RAM can cause both false failures and false passes.'
  summary
  echo 'NEXT_RU: Сначала RAM MAP/ремонт/повтор после холодной загрузки. После стабильного RAM PASS запустите комплекс снова.'
  echo 'NEXT_EN: Run RAM MAP/repair/retest after a cold boot. Rerun the suite only after stable RAM PASS.'
  exit "$CODE"
}

echo 'MODE=FULL_COMPLEX_DIAGNOSTIC_V2'
echo 'RU: Полный комплекс с зависимостями. Destructive SSD запускается последним, только после чистой RAM и CPU execution-path проверки.'
echo 'EN: Dependency-aware full suite. Destructive SSD runs last, only after clean RAM and CPU execution-path validation.'

# 0. Verify the diagnostic toolkit itself before trusting its output.
run_one TOOLKIT_SELFTEST toolkit_selftest.sh TOOLKIT
SELF_RC=$LAST_RC
if [ "$SELF_RC" -ne 0 ]; then
  summary
  echo 'RESULT=INCONCLUSIVE_TOOLKIT'
  echo 'RU: Self-test самого комплекта не прошёл; аппаратные выводы не делаем.'
  echo 'EN: Toolkit self-test did not pass; no hardware conclusion is made.'
  exit 3
fi

# 1. Observation-only baseline; safe even before memory validation.
run_one HARDWARE hardware_probe.sh OBSERVATION
run_one POWER_THERMAL power_thermal_test.sh OBSERVATION

# 2. RAM dependency gate.
run_one RAM_QUICK ram_quick_test.sh RAM
RAMQ=$LAST_RC
if [ "$RAMQ" -eq 2 ]; then
  # Map the fault while memory is demonstrably failing; skip the much larger torture workload.
  run_one RAM_MAP ram_map.sh RAM_EVIDENCE
  ram_gate_stop QUICK_FAIL 2
elif [ "$RAMQ" -ne 0 ]; then
  ram_gate_stop QUICK_INCONCLUSIVE 3
fi

run_one RAM_FULL ram_full_test.sh RAM
RAMF=$LAST_RC
if [ "$RAMF" -eq 2 ]; then
  run_one RAM_MAP ram_map.sh RAM_EVIDENCE
  ram_gate_stop FULL_FAIL 2
elif [ "$RAMF" -ne 0 ]; then
  run_one RAM_MAP ram_map.sh RAM_EVIDENCE
  ram_gate_stop FULL_INCONCLUSIVE 3
fi

run_one RAM_MAP ram_map.sh RAM
RAMM=$LAST_RC
if [ "$RAMM" -eq 2 ]; then ram_gate_stop MAP_FAIL 2; fi
if [ "$RAMM" -ne 0 ]; then ram_gate_stop MAP_INCONCLUSIVE 3; fi

echo 'RAM_GATE=PASS'

# 3. Integrity-dependent non-storage diagnostics now have a trustworthy RAM baseline.
run_one CPU_CACHE cpu_test.sh CPU
CPU_RC=$LAST_RC
run_one GPU_VRAM gpu_test.sh GPU
run_one DISPLAY_VIDEO display_video_test.sh DISPLAY
run_one NETWORK network_test.sh NETWORK
run_one DOWNLOAD download_test.sh NETWORK

# 4. SSD uses generated patterns and SHA-256; do not run it after CPU execution-path failure.
if [ "$CPU_RC" -eq 0 ]; then
  run_one SSD_HDD_DESTRUCTIVE ssd_test.sh STORAGE
  SSD_RC=$LAST_RC
  if [ "$SSD_RC" -eq 4 ]; then
    summary
    echo 'RESULT=REBOOT_REQUIRED'
    echo 'RU: Storage-тест дошёл до штатного cold-verify checkpoint. Полный SSD PASS ещё НЕ получен.'
    echo 'EN: Storage test reached a normal cold-verification checkpoint. Full SSD PASS has NOT been reached yet.'
    echo 'NEXT_RU: Перезагрузитесь в Internet Recovery и выберите пункт 1 SSD/HDD TEST для продолжения сохранённого storage-state.'
    echo 'NEXT_EN: Reboot into Internet Recovery and select 1 SSD/HDD TEST to continue the persisted storage state.'
    exit 4
  fi
else
  echo 'SSD_DESTRUCTIVE_STAGE=BLOCKED_BY_CPU_GATE'
  echo 'RU: SSD SHA/pattern test пропущен, потому что CPU/cache execution path не дал PASS.'
  echo 'EN: SSD SHA/pattern testing is skipped because the CPU/cache execution path did not pass.'
  INCONCLUSIVE=$((INCONCLUSIVE+1))
fi

summary
if [ "$FAILS" -gt 0 ]; then
  echo 'RESULT=FAIL'
  echo 'RU: Полный комплекс обнаружил минимум одну аппаратно значимую ошибку после прохождения RAM gate.'
  echo 'EN: Full suite detected at least one hardware-significant failure after the RAM gate.'
  exit 2
fi
if [ "$INCONCLUSIVE" -gt 0 ]; then
  echo 'RESULT=INCONCLUSIVE'
  echo 'RU: Подтверждённых FAIL нет, но часть тестов недоступна/неполна в этой среде. В Recovery это ожидаемо для Metal/display.'
  echo 'EN: No confirmed FAIL remains, but some tests are unavailable/incomplete in this environment. This is expected for Metal/display in Recovery.'
  exit 3
fi
echo 'RESULT=PASS'
echo 'RU: Все стадии полного комплекса, включая завершённый multi-boot SSD цикл, прошли без обнаруженной ошибки.'
echo 'EN: Every stage of the full suite, including the completed multi-boot SSD cycle, passed without a detected failure.'
exit 0
