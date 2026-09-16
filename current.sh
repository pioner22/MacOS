#!/bin/bash
# Temporary RAM-only triage after an observed one-byte mismatch.
# The internal SSD is not written by this stage; COMPLETE_A remains on raw disk.
set +u
BASE='https://raw.githubusercontent.com/pioner22/MacOS/main'
TMP="/tmp/ram-triage-$$.sh"
URL="$BASE/ram_triage.sh?t=$(date +%s 2>/dev/null || echo 0)"
rm -f "$TMP"

echo 'CURRENT_DIAGNOSTIC=RAM_ONLY_TRIAGE_V2'
echo 'SSD_WRITE_MODE=NONE'
echo 'Fetching Recovery-compatible RAM triage...'

curl -fL --retry 2 --connect-timeout 20 -H 'Cache-Control: no-cache' "$URL" -o "$TMP" || {
  echo 'STOP: failed to fetch ram_triage.sh' >&2
  rm -f "$TMP"
  exit 1
}
/bin/bash -n "$TMP" || {
  echo 'STOP: RAM triage failed syntax validation' >&2
  rm -f "$TMP"
  exit 1
}
echo 'ASSEMBLY=PASS'
/bin/bash "$TMP"
RC=$?
rm -f "$TMP"
exit "$RC"
