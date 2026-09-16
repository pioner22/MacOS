#!/bin/bash
# Dynamic diagnostic dispatcher: assemble the current MHDD-like SSD test.
set +u
BASE='https://raw.githubusercontent.com/pioner22/MacOS/main'
TMP="/tmp/mhdd-current-$$.sh"
rm -f "$TMP"

echo 'CURRENT_DIAGNOSTIC=SSD_MHDD_V2'
echo 'Assembling destructive full-LBA diagnostic...'

for P in 01 02 03 04 05 06; do
  URL="$BASE/mhdd_v2.part${P}?t=$(date +%s 2>/dev/null || echo 0)-$P"
  PART="/tmp/mhdd-part-${P}-$$"
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
  echo 'STOP: assembled diagnostic failed syntax validation' >&2
  rm -f "$TMP"
  exit 1
}

echo 'ASSEMBLY=PASS'
/bin/bash "$TMP"
RC=$?
rm -f "$TMP"
exit "$RC"
