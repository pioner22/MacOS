#!/bin/bash
set -u

say() { printf '%s\n' "$*"; }
fail() { printf 'STOP: %s\n' "$*" >&2; exit 1; }
size() { stat -f '%z' "$1" 2>/dev/null || printf '0\n'; }
need() { command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"; }

for c in curl stat grep awk mkdir rm mv sleep; do
  need "$c"
done
[ -x /usr/bin/xar ] || fail 'missing command: xar'

VER='unknown'
if command -v sw_vers >/dev/null 2>&1; then
  VER=$(sw_vers -productVersion 2>/dev/null || printf 'unknown')
fi
say "RECOVERY_VERSION=$VER"
say 'MODE=CATALINA_INSTALL_ESD_RESCUE_V2'

if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -di -w $$ >/tmp/catalina-rescue-caffeinate.log 2>&1 &
  CAFF=$!
  trap 'kill "$CAFF" 2>/dev/null || true' EXIT INT TERM
fi

CAT_DIR=''
for D in /Volumes/*/'macOS Install Data'; do
  if [ -d "$D" ]; then
    CAT_DIR=$D
    break
  fi
done

if [ -z "$CAT_DIR" ]; then
  say 'CATALINA_INSTALL_DATA_NOT_FOUND'
  say 'Start the Catalina installation once so macOS Install Data is created, then run this command again.'
  exit 0
fi

say "CATALINA_CACHE=$CAT_DIR"
PART="$CAT_DIR/InstallESDDmg.pkg.partial"
FINAL="$CAT_DIR/InstallESDDmg.pkg"

WORK='/tmp/catalina-xar-check'
if [ -d /Volumes/Apple ]; then
  WORK='/Volumes/Apple/.catalina-xar-check'
fi

verify_pkg() {
  F=$1
  rm -rf "$WORK"
  mkdir -p "$WORK" || return 1
  say "VERIFY_XAR=$F"
  /usr/bin/xar -xf "$F" -C "$WORK" >/tmp/catalina-xar.log 2>&1
  RC=$?
  rm -rf "$WORK"
  if [ "$RC" -eq 0 ]; then
    say 'XAR_VERIFY_OK'
    return 0
  fi
  say 'XAR_VERIFY_FAILED'
  tail -n 6 /tmp/catalina-xar.log 2>/dev/null || true
  return 1
}

if [ -f "$FINAL" ]; then
  say "FINAL_FOUND=$FINAL bytes=$(size "$FINAL")"
  if verify_pkg "$FINAL"; then
    say "CATALINA_PACKAGE_READY=$FINAL"
    exit 0
  fi
  say 'Existing final package is incomplete/corrupt; it will not be overwritten until a replacement verifies.'
fi

URL=''
find_url_in_file() {
  F=$1
  [ -f "$F" ] || return 0
  FS=$(size "$F")
  # Never grep multi-GB installer payloads. Metadata/log files only.
  [ "$FS" -gt 0 ] 2>/dev/null || return 0
  [ "$FS" -le 16777216 ] 2>/dev/null || return 0
  U=$(grep -aoE 'https?://[^[:space:]"<>]*InstallESDDmg\.pkg' "$F" 2>/dev/null | awk 'END { print }')
  [ -n "$U" ] && URL=$U
}

say 'SEARCH_URL_IN_RECOVERY_LOGS'
for L in /var/log/install.log /private/var/log/install.log /tmp/install.log /var/log/system.log /private/var/log/system.log; do
  find_url_in_file "$L"
done

if [ -z "$URL" ]; then
  say 'SEARCH_URL_IN_INSTALL_DATA_METADATA'
  for F in "$CAT_DIR"/*.log "$CAT_DIR"/*.txt "$CAT_DIR"/*.plist "$CAT_DIR"/*.xml "$CAT_DIR"/*.json; do
    find_url_in_file "$F"
  done
  for SD in "$CAT_DIR"/*; do
    [ -d "$SD" ] || continue
    for F in "$SD"/*.log "$SD"/*.txt "$SD"/*.plist "$SD"/*.xml "$SD"/*.json; do
      find_url_in_file "$F"
    done
  done
fi

if [ -z "$URL" ]; then
  say 'INSTALL_ESD_URL_NOT_FOUND'
  say 'CACHE_CONTENTS:'
  for F in "$CAT_DIR"/*; do
    [ -e "$F" ] || continue
    say "$(size "$F") $F"
  done
  say 'The large cache files were deliberately NOT scanned. Start/retry Catalina once so the URL is logged, then rerun this same command.'
  exit 0
fi

say "INSTALL_ESD_URL=$URL"

if [ -f "$PART" ]; then
  S1=$(size "$PART")
  say "PARTIAL_FOUND bytes=$S1"
  sleep 8
  S2=$(size "$PART")
  say "PARTIAL_BYTES_AFTER_8S=$S2"
  if [ "$S1" != "$S2" ]; then
    say 'APPLE_DOWNLOADER_IS_ACTIVE; not touching the partial file.'
    exit 0
  fi
else
  say "PARTIAL_NOT_FOUND; will create $PART"
fi

ATT=1
while [ "$ATT" -le 30 ]; do
  HAVE=$(size "$PART")
  say "DOWNLOAD_ATTEMPT=$ATT existing_bytes=$HAVE"
  if [ "$HAVE" -gt 0 ]; then
    curl -fL -C - -H 'Cache-Control: no-cache' --connect-timeout 20 --speed-time 180 --speed-limit 1024 -o "$PART" "$URL"
  else
    curl -fL -H 'Cache-Control: no-cache' --connect-timeout 20 --speed-time 180 --speed-limit 1024 -o "$PART" "$URL"
  fi
  RC=$?
  say "CURL_EXIT=$RC bytes=$(size "$PART")"
  if [ "$RC" -eq 0 ]; then
    break
  fi
  ATT=$((ATT+1))
  if [ "$ATT" -gt 30 ]; then
    say 'DOWNLOAD_INCOMPLETE; partial file preserved.'
    exit 0
  fi
  sleep 5
done

if verify_pkg "$PART"; then
  if [ -f "$FINAL" ]; then
    mv "$FINAL" "$FINAL.old" 2>/dev/null || true
  fi
  mv "$PART" "$FINAL" || fail 'cannot finalize InstallESDDmg.pkg'
  say "CATALINA_PACKAGE_READY=$FINAL"
  say 'Restart the Catalina installation. Do not delete macOS Install Data.'
else
  say 'DOWNLOAD_FINISHED_BUT_XAR_VERIFY_FAILED'
  say 'The partial file was preserved for another attempt.'
fi
