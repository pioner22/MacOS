#!/bin/bash
# Permanent Recovery entry point.
# Keep this file stable; only current.sh changes between diagnostic stages.
set +u

BASE='https://raw.githubusercontent.com/pioner22/MacOS/main'
STAMP=$(date +%s 2>/dev/null || echo 0)
URL="$BASE/current.sh?t=$STAMP"
TMP="/tmp/current-diag-$$.sh"
CAFF_PID=''

# Long raw SSD/RAM tests must not be distorted by idle sleep. Internet Recovery
# has caffeinate on this Mac; run it for the whole lifetime of this launcher.
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
echo 'Fetching current diagnostic script...'

rm -f "$TMP"
curl -fL --retry 2 --connect-timeout 20 -H 'Cache-Control: no-cache' "$URL" -o "$TMP"
RC=$?
if [ "$RC" -ne 0 ] || [ ! -s "$TMP" ]; then
  echo "STOP: failed to download current.sh (curl=$RC)" >&2
  exit 1
fi

# st.sh itself may arrive via `curl ... | bash`, so inherited stdin is the exhausted pipe.
if [ -r /dev/tty ]; then
  /bin/bash "$TMP" </dev/tty
else
  /bin/bash "$TMP"
fi
BRC=$?

if [ "$BRC" -ne 0 ]; then
  echo "STOP: current.sh exited with code $BRC" >&2
  exit "$BRC"
fi
exit 0
