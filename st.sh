#!/bin/bash
# Permanent Recovery entry point.
# Keep this file stable; only current.sh changes between diagnostic stages.
set -u

BASE='https://raw.githubusercontent.com/pioner22/MacOS/main'
STAMP=$(date +%s 2>/dev/null || echo 0)
URL="$BASE/current.sh?t=$STAMP"

echo 'RECOVERY_LAUNCHER=st.sh'
echo 'Fetching current diagnostic script...'

curl -fL --retry 2 --connect-timeout 20 -H 'Cache-Control: no-cache' "$URL" | /bin/bash
RC=${PIPESTATUS[0]}
BRC=${PIPESTATUS[1]}

if [ "$RC" -ne 0 ]; then
  echo "STOP: failed to download current.sh (curl=$RC)" >&2
  exit "$RC"
fi
if [ "$BRC" -ne 0 ]; then
  echo "STOP: current.sh exited with code $BRC" >&2
  exit "$BRC"
fi
