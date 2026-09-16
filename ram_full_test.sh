#!/bin/bash
# Full/hardcore RAM torture wrapper. Internal SSD is not intentionally written.
set +u
BASE='https://raw.githubusercontent.com/pioner22/MacOS/main'
TMP="/tmp/ram-full-$$.sh"; OUT="/tmp/ram-full-out-$$.log"
rm -f "$TMP" "$OUT"
echo 'MODE=RAM_FULL_HARDCORE'
echo 'RU: Полный жёсткий тест RAM: большие аллокации, шаблоны, удержание и RAM->RESCUE round-trip.'
echo 'EN: Full hardcore RAM test: large allocations, patterns, retention and RAM->RESCUE round-trip.'
curl -fL --retry 2 --connect-timeout 20 -H 'Cache-Control: no-cache' "$BASE/ram_triage.sh?t=$(date +%s 2>/dev/null || echo 0)" -o "$TMP" || {
  echo 'RESULT=INCONCLUSIVE'; echo 'RU: Не удалось загрузить движок RAM-теста.'; echo 'EN: Failed to download the RAM test engine.'; exit 3;
}
/bin/bash -n "$TMP" || { echo 'RESULT=INCONCLUSIVE'; echo 'RU: Ошибка синтаксиса теста.'; echo 'EN: RAM test syntax validation failed.'; exit 3; }
/bin/bash "$TMP" 2>&1 | tee "$OUT"
RC=${PIPESTATUS[0]:-99}
if grep -Eq 'RAM_HARD_FAIL|RAM_BAD_PAGE|RAM_CHUNK_MISMATCH|RAM_.*MISMATCH' "$OUT"; then
  echo 'RESULT=FAIL'
  echo 'RU: Полный тест обнаружил повреждение данных RAM. Это аппаратно значимый результат.'
  echo 'EN: Full RAM test detected RAM data corruption. This is hardware-significant evidence.'
  echo 'NEXT_RU: Сделайте холодную перезагрузку, запустите RAM MAP и повторите Полный RAM тест. При воспроизводимости диагностируйте DRAM/BGA/питание/IMC.'
  echo 'NEXT_EN: Cold boot, run RAM MAP, then repeat Full RAM. If reproducible, diagnose DRAM/BGA/power/IMC.'
  rm -f "$TMP" "$OUT"; exit 2
fi
if [ "$RC" -eq 0 ]; then
  echo 'RESULT=PASS'
  echo 'RU: Полный RAM-тест завершён без обнаруженного несовпадения данных.'
  echo 'EN: Full RAM torture completed without detected data mismatch.'
  echo 'NEXT_RU: Для интермиттирующего дефекта повторите после холодной загрузки и используйте RAM MAP.'
  echo 'NEXT_EN: For intermittent faults, repeat after a cold boot and use RAM MAP.'
  rm -f "$TMP" "$OUT"; exit 0
fi
echo 'RESULT=INCONCLUSIVE'
echo "RU: Полный RAM-тест прерван или среда ограничила его (код $RC)."
echo "EN: Full RAM test was interrupted or limited by the environment (code $RC)."
echo 'NEXT_RU: OOM/kill/hang без несовпадения данных не считать доказательством плохой RAM.'
echo 'NEXT_EN: Do not treat OOM/kill/hang without a data mismatch as proof of bad RAM.'
rm -f "$TMP" "$OUT"; exit 3
