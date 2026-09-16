#!/bin/bash
# A2141 Catalina/Recovery download rescuer.
# Safe mode only: never erases, repartitions, blesses, or rebuilds disks.
# Bash 3.2 compatible and intentionally avoids basename/dirname.
set -u

say(){ printf '%s\n' "$*"; }
fail(){ printf 'STOP: %s\n' "$*" >&2; exit 1; }
size(){ stat -f '%z' "$1" 2>/dev/null || printf '0\n'; }
need(){ command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"; }

for c in curl stat grep awk mkdir rm mv sleep find tail; do need "$c"; done
[ -x /usr/bin/xar ] || fail 'missing command: xar'

RECOVERY_VER='unknown'
if command -v sw_vers >/dev/null 2>&1; then
  RECOVERY_VER=$(sw_vers -productVersion 2>/dev/null || printf 'unknown')
fi
say "RECOVERY_VERSION=$RECOVERY_VER"
say 'MODE=SAFE_DOWNLOAD_RESCUE'

if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -di -w $$ >/tmp/a2141-caffeinate.log 2>&1 &
  CAFF=$!
  trap 'kill "$CAFF" 2>/dev/null || true' EXIT INT TERM
fi

URLS='/tmp/a2141-urls'
PARTS='/tmp/a2141-parts'
: > "$URLS"
: > "$PARTS"

add_urls_from_file(){
  F=$1
  [ -f "$F" ] || return 0
  grep -aoE 'https?://[^[:space:]"<>]+' "$F" 2>/dev/null | while IFS= read -r U; do
    case "$U" in
      https://*.apple.com/*|https://apple.com/*|https://*.icloud.com/*) ;;
      *) continue;;
    esac
    case "$U" in *')'|*','|*';') U=${U%?};; esac
    BASE=${U%%\?*}
    NAME=${BASE##*/}
    case "$NAME" in
      *.pkg|*.dmg|*.ipsw|*.zip) printf '%s\n' "$U";;
    esac
  done >> "$URLS"
}

for F in /var/log/install.log /private/var/log/install.log /var/log/system.log /private/var/log/system.log /tmp/install.log /tmp/*.log; do
  [ -f "$F" ] || continue
  add_urls_from_file "$F"
done

for D in /Volumes/*/'macOS Install Data'; do
  [ -d "$D" ] || continue
  for F in "$D"/* "$D"/*/*; do
    [ -f "$F" ] || continue
    add_urls_from_file "$F"
  done
done

if [ -s "$URLS" ]; then
  awk '!seen[$0]++' "$URLS" > "$URLS.new"
  mv "$URLS.new" "$URLS"
  say 'APPLE_ARCHIVE_URLS_FOUND:'
  tail -n 12 "$URLS"
else
  say 'APPLE_ARCHIVE_URLS_FOUND=0'
fi

find_url_for_name(){
  WANTED=$1
  FOUND_URL=''
  [ -s "$URLS" ] || return 0
  while IFS= read -r U; do
    BASE=${U%%\?*}
    NAME=${BASE##*/}
    [ "$NAME" = "$WANTED" ] && FOUND_URL=$U
  done < "$URLS"
}

verify_pkg(){
  F=$1
  WORK='/tmp/a2141-xar-verify'
  rm -rf "$WORK"
  mkdir -p "$WORK" || return 1
  say "VERIFY_XAR=$F"
  /usr/bin/xar -xf "$F" -C "$WORK" >/tmp/a2141-xar.log 2>&1
  RC=$?
  rm -rf "$WORK"
  if [ "$RC" -eq 0 ]; then
    say 'XAR_VERIFY_OK'
    return 0
  fi
  say 'XAR_VERIFY_FAILED'
  tail -n 6 /tmp/a2141-xar.log 2>/dev/null || true
  return 1
}

verify_asset(){
  F=$1
  NAME=$2
  case "$NAME" in
    *.pkg) verify_pkg "$F"; return $?;;
    *.dmg)
      if [ -x /usr/bin/hdiutil ]; then
        say "VERIFY_DMG=$F"
        /usr/bin/hdiutil verify "$F" >/tmp/a2141-dmg.log 2>&1 && { say 'DMG_VERIFY_OK'; return 0; }
        /usr/bin/hdiutil imageinfo "$F" >/dev/null 2>&1 && { say 'DMG_PARSE_OK'; return 0; }
      fi
      return 1
      ;;
    *.zip|*.ipsw)
      if [ -x /usr/bin/unzip ]; then
        say "VERIFY_ZIP=$F"
        /usr/bin/unzip -tq "$F" >/tmp/a2141-zip.log 2>&1 && { say 'ZIP_VERIFY_OK'; return 0; }
      fi
      return 1
      ;;
  esac
  return 1
}

scan_root(){
  D=$1
  [ -d "$D" ] || return 0
  find "$D" -type f -name '*.partial' -print 2>/dev/null >> "$PARTS"
  find "$D" -type f -name '*.part' -print 2>/dev/null >> "$PARTS"
  find "$D" -type f -name '*.download' -print 2>/dev/null >> "$PARTS"
}

for D in /Volumes/*/'macOS Install Data' /Volumes/*/Library/Updates /Volumes/*/private/var/db/softwareupdate /tmp /var/tmp; do
  scan_root "$D"
done

if [ -s "$PARTS" ]; then
  awk '!seen[$0]++' "$PARTS" > "$PARTS.new"
  mv "$PARTS.new" "$PARTS"
fi

resume_one(){
  P=$1
  [ -f "$P" ] || return 0

  case "$P" in
    *.partial) FINAL=${P%.partial};;
    *.part) FINAL=${P%.part};;
    *.download) FINAL=${P%.download};;
    *) return 0;;
  esac
  NAME=${FINAL##*/}
  case "$NAME" in *.pkg|*.dmg|*.ipsw|*.zip) ;; *) return 0;; esac

  say "PARTIAL_FOUND=$P"
  S1=$(size "$P")
  sleep 6
  S2=$(size "$P")
  if [ "$S1" != "$S2" ]; then
    say "DOWNLOAD_ACTIVE bytes=$S2"
    return 0
  fi
  say "PARTIAL_STALLED bytes=$S2"

  if verify_asset "$P" "$NAME"; then
    [ -f "$FINAL" ] && mv "$FINAL" "$FINAL.old" 2>/dev/null || true
    mv "$P" "$FINAL" || fail "cannot finalize $P"
    say "ASSET_READY=$FINAL"
    return 0
  fi

  find_url_for_name "$NAME"
  [ -n "$FOUND_URL" ] || { say "URL_NOT_FOUND_FOR=$NAME"; return 0; }
  say "RESUME_URL=$FOUND_URL"

  ATT=1
  while [ "$ATT" -le 30 ]; do
    HAVE=$(size "$P")
    say "RESUME_ATTEMPT=$ATT existing_bytes=$HAVE"
    curl -fL -C - -H 'Cache-Control: no-cache' --connect-timeout 20 --speed-time 180 --speed-limit 1024 -o "$P" "$FOUND_URL"
    RC=$?
    say "CURL_EXIT=$RC bytes=$(size "$P")"
    [ "$RC" -eq 0 ] && break
    ATT=$((ATT+1))
    [ "$ATT" -le 30 ] || { say 'RESUME_INCOMPLETE'; return 0; }
    sleep 5
  done

  if verify_asset "$P" "$NAME"; then
    [ -f "$FINAL" ] && mv "$FINAL" "$FINAL.old" 2>/dev/null || true
    mv "$P" "$FINAL" || fail "cannot finalize $P"
    say "ASSET_READY=$FINAL"
  else
    say "VERIFY_FAILED_AFTER_DOWNLOAD=$P"
  fi
}

COUNT=0
if [ -s "$PARTS" ]; then
  while IFS= read -r P; do
    case "$P" in
      *.pkg.partial|*.dmg.partial|*.ipsw.partial|*.zip.partial|*.pkg.part|*.dmg.part|*.ipsw.part|*.zip.part|*.pkg.download|*.dmg.download|*.ipsw.download|*.zip.download)
        COUNT=$((COUNT+1))
        resume_one "$P"
        ;;
    esac
  done < "$PARTS"
fi
say "PARTIAL_ARCHIVES_FOUND=$COUNT"

CAT_DIR=''
CAT_COUNT=0
for D in /Volumes/*/'macOS Install Data'; do
  [ -d "$D" ] || continue
  CAT_DIR=$D
  CAT_COUNT=$((CAT_COUNT+1))
done

if [ "$COUNT" -eq 0 ] && [ "$CAT_COUNT" -eq 1 ]; then
  FINAL="$CAT_DIR/InstallESDDmg.pkg"
  if [ -f "$FINAL" ]; then
    say "CATALINA_FINAL_FOUND=$FINAL"
    verify_pkg "$FINAL" || true
  else
    find_url_for_name 'InstallESDDmg.pkg'
    if [ -n "$FOUND_URL" ]; then
      PART="$FINAL.partial"
      say "CATALINA_DIRECT_DOWNLOAD=$PART"
      curl -fL -C - -H 'Cache-Control: no-cache' --connect-timeout 20 --speed-time 180 --speed-limit 1024 -o "$PART" "$FOUND_URL"
      RC=$?
      say "CURL_EXIT=$RC bytes=$(size "$PART")"
      if [ "$RC" -eq 0 ] && verify_pkg "$PART"; then
        mv "$PART" "$FINAL" || fail 'cannot finalize InstallESDDmg.pkg'
        say "CATALINA_PACKAGE_READY=$FINAL"
      fi
    else
      say 'CATALINA_INSTALL_ESD_URL_NOT_FOUND'
    fi
  fi
fi

say 'SCAN_DONE'
