#!/bin/bash
# Standalone destructive internal-Apple-SSD diagnostic. No embedded RAM test.
set +u
BASE='https://raw.githubusercontent.com/pioner22/MacOS/main'
TMP="/tmp/ssd-test-$$.sh"; OUT="/tmp/ssd-test-out-$$.log"
rm -f "$TMP" "$OUT"

# Re-detect the actual hardware even when called without current.sh.
# An inherited manual selection can restrict this policy, never elevate it.
PROFILE_REF='0066767965fd72891aa986ade505be95b186f8fe'
PROFILE=$(mktemp /tmp/macdiag-ssd-profile.XXXXXX) || exit 3
if ! curl -q -fL --retry 2 --connect-timeout 20 --max-time 120 \
  "https://raw.githubusercontent.com/pioner22/MacOS/$PROFILE_REF/diagnostic_profile.sh" -o "$PROFILE"; then
  rm -f "$PROFILE"; echo 'RESULT=INCONCLUSIVE profile_fetch_failed'; exit 3
fi
/bin/bash -n "$PROFILE" || { rm -f "$PROFILE"; echo 'RESULT=INCONCLUSIVE profile_syntax_failed'; exit 3; }
. "$PROFILE"
rm -f "$PROFILE"
dp_detect
dp_apply "${MACDIAG_MODEL_REQUEST:-auto}" "${MACDIAG_OS_REQUEST:-auto}" "${MACDIAG_ENV_REQUEST:-auto}" || exit 3
dp_show
dp_allow ssd_test.sh || exit 3
printf 'RU: Этот тест может стереть ВЕСЬ внутренний SSD. Нужна сохранённая резервная копия.\n'
printf 'EN: This test can erase the ENTIRE internal SSD. A verified backup is required.\n'
printf 'RU: Для согласия введите ERASE-INTERNAL-SSD. Иначе тест НЕ запустится.\n'
printf 'EN: Type ERASE-INTERNAL-SSD to consent. Any other input cancels.\n> '
if ! dp_read_reply || [ "$DP_REPLY" != ERASE-INTERNAL-SSD ]; then
  echo 'RESULT=CANCELLED no_erase_consent'; exit 3
fi

echo 'DIAGNOSTIC=SSD_HDD_MHDD_LIKE_PURE'
echo 'RU: После подтверждения профиля движок отдельно проверит накопитель. Только внутренний Apple SSD около 1 ТБ.'
echo 'EN: The engine separately validates the actual drive: internal Apple SSD around 1 TB only.'
echo 'Assembling storage diagnostic...'

for P in 01 02 03 04; do
  URL="$BASE/mhdd_v2.part${P}?t=$(date +%s 2>/dev/null || echo 0)-$P"
  PART="/tmp/ssd-test-part-${P}-$$"
  rm -f "$PART"
  curl -fL --retry 2 --connect-timeout 20 -H 'Cache-Control: no-cache' "$URL" -o "$PART" || {
    echo "RESULT=INCONCLUSIVE fetch_failed=mhdd_v2.part${P}"; rm -f "$PART" "$TMP"; exit 3;
  }
  cat "$PART" >> "$TMP"; rm -f "$PART"
done
for FILE in mhdd_v2.part05_storage mhdd_v2.part06_storage; do
  PART="/tmp/ssd-test-part-$$-${FILE##*.}"; rm -f "$PART"
  curl -fL --retry 2 --connect-timeout 20 -H 'Cache-Control: no-cache' "$BASE/$FILE?t=$(date +%s 2>/dev/null || echo 0)" -o "$PART" || {
    echo "RESULT=INCONCLUSIVE fetch_failed=$FILE"; rm -f "$PART" "$TMP"; exit 3;
  }
  cat "$PART" >> "$TMP"; rm -f "$PART"
done

/bin/bash -n "$TMP" || { echo 'RESULT=INCONCLUSIVE syntax_validation_failed'; rm -f "$TMP"; exit 3; }
echo 'ASSEMBLY=PASS'
/bin/bash "$TMP" 2>&1 | tee "$OUT"
RC=${PIPESTATUS[0]:-99}

# Actual I/O/data failures always override a later checkpoint marker.
if grep -Eq 'VERIFY_HASH_MISMATCH|VERIFY_READ_ERROR|READ_IO_ERROR|WRITE_ERROR|BAD_LBA4K|PATTERN_[AB]_.*FAILED|PROBE_HASH_MISMATCH|PROBE_IO_ERROR|targeted anomaly probe found data/I-O errors|final GPT/APFS verification failed|raw media tests passed but final GPT/APFS verification failed' "$OUT"; then
  echo 'RESULT=FAIL'
  echo 'RU: Обнаружена ошибка чтения/записи, несовпадение данных или ошибка финальной проверки storage path.'
  echo 'EN: A storage read/write error, data mismatch, or final storage-path verification failure was detected.'
  echo 'NEXT_RU: Сохраните лог. Перед заменой SSD исключите RAM/T2/I/O path отдельными тестами.'
  echo 'NEXT_EN: Preserve the log. Before replacing storage, isolate RAM/T2/I/O path with separate tests.'
  rm -f "$TMP" "$OUT"; exit 2
fi

if grep -Eq 'REBOOT_REQUIRED|STAGE=COMPLETE_A|STAGE=COMPLETE_B' "$OUT"; then
  echo 'RESULT=REBOOT_REQUIRED'
  echo 'RU: Этап завершён; весь SSD-тест ещё НЕ ЗАКОНЧЕН. Нужна перезагрузка для проверки сохранности данных.'
  echo 'EN: Stage completed; the full SSD test is NOT FINISHED. Reboot for persistence verification.'
  echo 'NEXT_RU: Перезагрузитесь в Recovery и снова выберите SSD/HDD TEST.'
  echo 'NEXT_EN: Reboot into Recovery and select SSD/HDD TEST again.'
  rm -f "$TMP" "$OUT"; exit 4
fi

if grep -q 'FINAL=PASS_FULL_DEVICE_LBA_WRITE_READ_PERSISTENCE' "$OUT"; then
  echo 'RESULT=PASS'
  echo 'RU: Движок сообщил об успешном завершении полного логического write/read/hash цикла и финальной GPT/APFS проверки.'
  echo 'EN: The engine reported complete logical write/read/hash and final GPT/APFS verification.'
  echo 'NEXT_RU: Сохраните результат вместе с данными независимых тестов RAM.'
  echo 'NEXT_EN: Preserve this result with independent RAM-test evidence.'
  rm -f "$TMP" "$OUT"; exit 0
fi
if [ "$RC" -eq 0 ]; then
  echo 'RESULT=INCONCLUSIVE stage_returned_zero_without_final_marker'
else
  echo "RESULT=INCONCLUSIVE rc=$RC"
fi
echo 'RU: Тест не дал полного результата; аппаратный вывод не делаем.'
echo 'EN: No complete result; no hardware conclusion is made.'
rm -f "$TMP" "$OUT"; exit 3
