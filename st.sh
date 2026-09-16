#!/bin/bash
# Permanent Recovery entry point.
# Keep this file stable; only current.sh changes between diagnostic stages.
set +u

BASE='https://raw.githubusercontent.com/pioner22/MacOS/main'
STAMP=$(date +%s 2>/dev/null || echo 0)
URL="$BASE/current.sh?t=$STAMP"
TMP="/tmp/current-diag-$$.sh"

echo 'RECOVERY_LAUNCHER=st.sh'
echo 'Fetching current diagnostic script...'

rm -f "$TMP"
curl -fL --retry 2 --connect-timeout 20 -H 'Cache-Control: no-cache' "$URL" -o "$TMP"
RC=$?
if [ "$RC" -ne 0 ] || [ ! -s "$TMP" ]; then
  echo "STOP: failed to download current.sh (curl=$RC)" >&2
  rm -f "$TMP"
  exit 1
fi

# st.sh itself may arrive via `curl ... | bash`, so inherited stdin is the exhausted pipe.
# Reconnect the diagnostic's stdin to the terminal when a TTY exists, so confirmations work.
if [ -r /dev/tty ]; then
  /bin/bash "$TMP" </dev/tty
else
  /bin/bash "$TMP"
fi
BRC=$?
rm -f "$TMP"

if [ "$BRC" -ne 0 ]; then
  echo "STOP: current.sh exited with code $BRC" >&2
  exit "$BRC"
fi
exit 0
