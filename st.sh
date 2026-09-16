#!/bin/bash
# Permanent Recovery entry point.
# Keep this file stable; current.sh provides the menu and result semantics.
set +u

BASE='https://raw.githubusercontent.com/pioner22/MacOS/main'
STAMP=$(date +%s 2>/dev/null || echo 0)
URL="$BASE/current.sh?t=$STAMP"
TMP="/tmp/current-diag-$$.sh"
CAFF_PID=''

# Long raw SSD/RAM tests must not be distorted by idle sleep.
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -dim >/tmp/recovery-caffeinate.log 2>&1 &
  CAFF_PID=$!
  echo "KEEP_AWAKE=caffeinate pid=$CAFF_PID"
else
  echo 'KEEP_AWAKE=UNAVAILABLE (manual caffeinate recommended)'
fi

cleanup(){
  rm -f "$TMP" 2>/dev/null || true
  if [ -n "$CAFF_PID" ]; then kill "$CAFF_PID" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT INT TERM HUP

echo 'RECOVERY_LAUNCHER=st.sh'
echo 'Fetching current diagnostic menu...'

rm -f "$TMP"
curl -fL --retry 2 --connect-timeout 20 -H 'Cache-Control: no-cache' "$URL" -o "$TMP"
RC=$?
if [ "$RC" -ne 0 ] || [ ! -s "$TMP" ]; then
  echo "LAUNCHER_ERROR: failed to download current.sh (curl=$RC)" >&2
  exit 1
fi

# st.sh itself may arrive via `curl ... | bash`, so inherited stdin is the exhausted pipe.
if [ -r /dev/tty ]; then
  /bin/bash "$TMP" </dev/tty
else
  /bin/bash "$TMP"
fi
BRC=$?

case "$BRC" in
  0) echo 'DIAGNOSTIC_EXIT=PASS_OR_STAGE_COMPLETE';;
  2) echo 'DIAGNOSTIC_EXIT=CONFIRMED_FAIL';;
  3) echo 'DIAGNOSTIC_EXIT=INCONCLUSIVE';;
  4) echo 'DIAGNOSTIC_EXIT=REBOOT_REQUIRED';;
  *) echo "LAUNCHER_NOTICE: diagnostic script exited with unexpected code $BRC" >&2;;
esac
exit "$BRC"
