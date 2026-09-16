#!/bin/bash
# Pure standalone storage diagnostic launcher for the internal Apple SSD.
# No RAM preflight is embedded; RAM has separate quick/full/map tests.
set +u
BASE='https://raw.githubusercontent.com/pioner22/MacOS/main'
TMP="/tmp/ssd-test-$$.sh"; OUT="/tmp/ssd-test-out-$$.log"
rm -f "$TMP" "$OUT"

echo 'DIAGNOSTIC=SSD_HDD_MHDD_LIKE_PURE'
echo 'RU: Чистый тест накопителя. ВНИМАНИЕ: возможна полная разрушительная запись по внутреннему SSD.'
echo 'EN: Pure storage test. WARNING: full destructive writes to the internal SSD may occur.'
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
for FILE in mhdd_v2.part05_storage mhdd_v2.part06; do
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

if grep -Eq 'VERIFY_HASH_MISMATCH|VERIFY_READ_ERROR|READ_IO_ERROR|WRITE_ERROR|BAD_LBA4K|PATTERN_[AB]_.*FAILED|STORAGE_PATH_SUSPECT' "$OUT"; then
  echo 'RESULT=FAIL'
  echo 'RU: Обнаружена ошибка чтения/записи или несовпадение данных накопителя/storage path.'
  echo 'EN: A storage read/write error or data mismatch was detected.'
  echo 'NEXT_RU: Сохраните лог, не доверяйте накопителю. Перед заменой SSD исключите RAM/T2/I/O path отдельными тестами.'
  echo 'NEXT_EN: Preserve the log and do not trust the drive. Before replacing storage, isolate RAM/T2/I/O path with separate tests.'
  rm -f "$TMP" "$OUT"; exit 2
fi
if grep -q 'FINAL=PASS_FULL_DEVICE_LBA_WRITE_READ_PERSISTENCE' "$OUT"; then
  echo 'RESULT=PASS'
  echo 'RU: Накопитель прошёл полный логический write/read/hash/cold-verify цикл.'
  echo 'EN: Storage passed the complete logical write/read/hash/cold-verify cycle.'
  echo 'NEXT_RU: После ремонта других узлов повторите тест перед эксплуатацией важных данных.'
  echo 'NEXT_EN: After repairing other components, repeat before trusting important data.'
  rm -f "$TMP" "$OUT"; exit 0
fi
if grep -Eq 'REBOOT_REQUIRED|STAGE=COMPLETE_A|STAGE=COMPLETE_B' "$OUT"; then
  echo 'RESULT=STATE_REBOOT_REQUIRED'
  echo 'RU: Текущий этап завершён; нужна холодная/реальная перезагрузка для продолжения проверки сохранности данных.'
  echo 'EN: Current stage completed; a real reboot is required to continue persistence verification.'
  echo 'NEXT_RU: Перезагрузитесь в Internet Recovery и снова выберите SSD/HDD TEST.'
  echo 'NEXT_EN: Reboot into Internet Recovery and select SSD/HDD TEST again.'
  rm -f "$TMP" "$OUT"; exit 4
fi
if [ "$RC" -eq 0 ]; then
  echo 'RESULT=PASS_OR_STAGE_COMPLETE'
  echo 'RU: Этап завершён без зарегистрированной ошибки, но полный цикл ещё может быть не закончен.'
  echo 'EN: Stage completed without a recorded error, but the full cycle may not be finished.'
  rm -f "$TMP" "$OUT"; exit 0
fi
echo "RESULT=INCONCLUSIVE rc=$RC"
echo 'RU: Тест накопителя прерван/ограничен средой, аппаратный вывод не делаем.'
echo 'EN: Storage test was interrupted or environment-limited; no hardware conclusion is made.'
rm -f "$TMP" "$OUT"; exit 3
