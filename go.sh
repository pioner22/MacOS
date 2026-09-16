#!/bin/bash
set -u
# Cache-busting launcher for Recovery environments where raw.githubusercontent.com may serve a stale s.sh.
TS=$(date +%s 2>/dev/null || echo fresh)
exec /bin/bash -c "curl -fL -H 'Cache-Control: no-cache' 'https://raw.githubusercontent.com/pioner22/MacOS/main/s.sh?v=$TS' | /bin/bash"
