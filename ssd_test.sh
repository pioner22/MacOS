#!/bin/bash
# Standalone storage diagnostic launcher for the internal Apple SSD.
# Assembles the Recovery-safe MHDD-like full-LBA test.
set +u
BASE='https://raw.githubusercontent.com/pioner22/MacOS/main'
TMP="/tmp/ssd-test-$$.sh"
rm -f "$TMP"

echo 'DIAGNOSTIC=SSD_HDD_MHDD_LIKE'
echo 'WARNING=This mode may perform destructive full-LBA writes depending on saved stage.'
echo 'Assembling storage diagnostic...'

for P in 01 02 03 04 04b 05 06; do
  URL="$BASE/mhdd_v2.part${P}?t=$(date +%s 2>/dev/null || echo 0)-$P"
  PART="/tmp/ssd-test-part-${P}-$$"
  rm -f "$PART"
  curl -fL --retry 2 --connect-timeout 20 -H 'Cache-Control: no-cache' "$URL" -o "$PART" || {
    echo "STOP: failed to fetch mhdd_v2.part${P}" >&2
    rm -f "$PART" "$TMP"
    exit 1
  }
  cat "$PART" >> "$TMP"
  rm -f "$PART"
done

/bin/bash -n "$TMP" || {
  echo 'STOP: assembled SSD diagnostic failed syntax validation' >&2
  rm -f "$TMP"
  exit 1
}

echo 'ASSEMBLY=PASS'
/bin/bash "$TMP"
RC=$?
rm -f "$TMP"
exit "$RC"
