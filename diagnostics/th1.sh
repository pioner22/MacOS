#!/bin/bash
# Fast single-file downloader for macOS Tahoe 26.6.2 (25G83).
# Downloads InstallAssistant.pkg in one uninterrupted stream.
# Any curl/TLS error discards that attempt and restarts from byte 0 to avoid
# stitching a corrupted package across broken TLS sessions.
set -u

URL='https://swcdn.apple.com/content/downloads/37/33/140-93587-A_GRFFH93NOL/f944yaqo1cjhh2m0kxrl0zhcpg9yb9qphv/InstallAssistant.pkg'
EXPECTED=18384624402
BASE='/Volumes/Apple/Tahoe-26.6.2-25G83'
OUT="$BASE/InstallAssistant.pkg"
TMP="$BASE/InstallAssistant.pkg.single"
VERIFY="$BASE/xar-single-verify"
NEXT='https://raw.githubusercontent.com/pioner22/MacOS/main/thm.sh'

say(){ printf '%s\n' "$*"; }
fail(){ printf 'STOP: %s\n' "$*" >&2; exit 1; }
need(){ command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"; }
size(){ stat -f '%z' "$1" 2>/dev/null || printf '0\n'; }

for c in curl stat mkdir rm mv sleep; do need "$c"; done
[ -x /usr/bin/xar ] || fail 'xar not found'
[ -d /Volumes/Apple ] || fail '/Volumes/Apple is not mounted'
mkdir -p "$BASE" || fail 'cannot create Tahoe download directory'

if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -di -w $$ >/tmp/tahoe-single-caffeinate.log 2>&1 &
  CAFF=$!
  trap 'kill "$CAFF" 2>/dev/null || true' EXIT INT TERM
fi

verify_xar(){
  F=$1
  rm -rf "$VERIFY"
  mkdir -p "$VERIFY" || return 1
  say "VERIFY_XAR=$F"
  /usr/bin/xar -xf "$F" -C "$VERIFY" >/tmp/tahoe-single-xar.log 2>&1
  RC=$?
  rm -rf "$VERIFY"
  if [ "$RC" -eq 0 ]; then
    say 'XAR_VERIFY_OK'
    return 0
  fi
  say 'XAR_VERIFY_FAILED'
  tail -n 8 /tmp/tahoe-single-xar.log 2>/dev/null || true
  return 1
}

say 'MODE=TAHOE_SINGLE_FILE_FAST'
say "EXPECTED_BYTES=$EXPECTED"

# Reuse only a package that passes both exact size and full XAR checksum verification.
if [ -f "$OUT" ]; then
  say "EXISTING_PACKAGE bytes=$(size "$OUT")"
  if [ "$(size "$OUT")" = "$EXPECTED" ] && verify_xar "$OUT"; then
    say 'PACKAGE_ALREADY_GOOD'
    curl -fL -H 'Cache-Control: no-cache' "$NEXT" | /bin/bash
    exit $?
  fi
  say 'REMOVING_INVALID_EXISTING_PACKAGE'
  rm -f "$OUT" || fail 'cannot remove invalid existing package'
fi

# Remove files from the previous failed resume/chunk experiments so they cannot
# be accidentally reused by another helper. Verified OUT above is preserved.
for F in \
  "$BASE/InstallAssistant.pkg.part" \
  "$BASE/InstallAssistant.pkg.fresh" \
  "$BASE/InstallAssistant.pkg.chunked" \
  "$BASE/InstallAssistant.pkg.bad"; do
  [ -f "$F" ] || continue
  say "REMOVING_OLD_FAILED_FILE=$F bytes=$(size "$F")"
  rm -f "$F" || fail "cannot remove $F"
done
if [ -d "$BASE/chunks" ]; then
  say 'REMOVING_OLD_CHUNK_CACHE'
  rm -rf "$BASE/chunks" || fail 'cannot remove old chunk cache'
fi
rm -f "$TMP"

ATT=1
MAX=12
while [ "$ATT" -le "$MAX" ]; do
  rm -f "$TMP"
  say "FULL_DOWNLOAD_ATTEMPT=$ATT/$MAX starting_from_byte=0"
  curl -fL --http1.1 --tlsv1.2 \
    -H 'Cache-Control: no-cache' \
    --connect-timeout 20 \
    -o "$TMP" "$URL"
  RC=$?
  GOT=$(size "$TMP")
  say "CURL_EXIT=$RC bytes=$GOT"

  if [ "$RC" -eq 0 ] && [ "$GOT" = "$EXPECTED" ]; then
    say 'DOWNLOAD_SIZE_OK'
    if verify_xar "$TMP"; then
      mv "$TMP" "$OUT" || fail 'cannot finalize verified InstallAssistant.pkg'
      say "FRESH_PACKAGE_READY=$OUT"
      say 'Launching Tahoe media builder...'
      curl -fL -H 'Cache-Control: no-cache' "$NEXT" | /bin/bash
      exit $?
    fi
    say 'FULL_FILE_CORRUPT_AFTER_DOWNLOAD: restarting from byte 0.'
  else
    if [ "$RC" -eq 0 ]; then
      say "SIZE_MISMATCH got=$GOT expected=$EXPECTED"
    else
      say 'TRANSFER_FAILED: restarting the next attempt from byte 0.'
    fi
  fi

  rm -f "$TMP"
  ATT=$((ATT+1))
  [ "$ATT" -le "$MAX" ] || break
  sleep 3
done

fail 'no intact single-stream download completed; use thc.sh chunk mode if the connection keeps breaking'
