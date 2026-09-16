#!/bin/bash
# Standalone maximum RAM diagnostic launcher.
# Does not intentionally write to the internal SSD.
set +u
BASE='https://raw.githubusercontent.com/pioner22/MacOS/main'
TMP="/tmp/ram-test-$$.sh"
URL="$BASE/ram_triage.sh?t=$(date +%s 2>/dev/null || echo 0)"
rm -f "$TMP"

echo 'DIAGNOSTIC=RAM_MAX_TORTURE'
echo 'INTERNAL_SSD_WRITE=NONE'
echo 'Fetching RAM diagnostic...'

curl -fL --retry 2 --connect-timeout 20 -H 'Cache-Control: no-cache' "$URL" -o "$TMP" || {
  echo 'STOP: failed to fetch ram_triage.sh' >&2
  rm -f "$TMP"
  exit 1
}
/bin/bash -n "$TMP" || {
  echo 'STOP: RAM diagnostic failed syntax validation' >&2
  rm -f "$TMP"
  exit 1
}

echo 'ASSEMBLY=PASS'
/bin/bash "$TMP"
RC=$?
rm -f "$TMP"
exit "$RC"
