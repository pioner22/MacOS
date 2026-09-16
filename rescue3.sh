#!/bin/bash
set -u

say(){ printf '%s\n' "$*"; }
fail(){ printf 'STOP: %s\n' "$*" >&2; exit 1; }
size(){ stat -f '%z' "$1" 2>/dev/null || printf '0\n'; }
need(){ command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"; }

for c in curl stat grep awk mkdir rm mv sleep; do need "$c"; done

VER='unknown'
if command -v sw_vers >/dev/null 2>&1; then
  VER=$(sw_vers -productVersion 2>/dev/null || printf 'unknown')
fi
say "RECOVERY_VERSION=$VER"
say 'MODE=CATALINA_MULTI_ASSET_RESCUE_V3'
say 'IMPORTANT: run this only after the Catalina installer has stopped/failed, not while it is actively downloading.'

CAT_DIR=''
for D in /Volumes/*/'macOS Install Data'; do
  if [ -d "$D" ]; then CAT_DIR=$D; break; fi
done
[ -n "$CAT_DIR" ] || { say 'CATALINA_INSTALL_DATA_NOT_FOUND'; exit 0; }
say "CATALINA_CACHE=$CAT_DIR"

if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -di -w $$ >/tmp/catalina-rescue3-caffeinate.log 2>&1 &
  CAFF=$!
  trap 'kill "$CAFF" 2>/dev/null || true' EXIT INT TERM
fi

URLS='/tmp/catalina-rescue3-urls'
: > "$URLS"

scan_log(){
  L=$1
  [ -f "$L" ] || return 0
  grep -aoE 'https?://[^[:space:]"<>)]+' "$L" 2>/dev/null | while IFS= read -r U; do
    case "$U" in
      http://swcdn.apple.com/*|https://swcdn.apple.com/*|http://*.apple.com/*|https://*.apple.com/*)
        B=${U%%\?*}; B=${B##*/}
        case "$B" in
          BaseSystem.dmg|BaseSystem.chunklist|InstallESDDmg.pkg|InstallInfo.plist|AppleDiagnostics.dmg|AppleDiagnostics.chunklist)
            printf '%s\n' "$U"
            ;;
        esac
        ;;
    esac
  done >> "$URLS"
}

for L in /var/log/install.log /private/var/log/install.log /tmp/install.log /var/log/system.log /private/var/log/system.log; do
  scan_log "$L"
done

if [ -s "$URLS" ]; then
  awk '!seen[$0]++' "$URLS" > "$URLS.new"
  mv "$URLS.new" "$URLS"
  say 'KNOWN_ASSET_URLS_FOUND:'
  cat "$URLS"
else
  say 'KNOWN_ASSET_URLS_FOUND=0'
  say 'Let the Catalina installer attempt the download once, then rerun this script after it stops/fails.'
  exit 0
fi

find_url(){
  WANT=$1
  FOUND=''
  while IFS= read -r U; do
    B=${U%%\?*}; B=${B##*/}
    [ "$B" = "$WANT" ] && FOUND=$U
  done < "$URLS"
}

verify_dmg(){
  F=$1
  [ -x /usr/bin/hdiutil ] || return 2
  say "VERIFY_DMG=$F"
  /usr/bin/hdiutil verify "$F" >/tmp/rescue3-dmg.log 2>&1 && { say 'DMG_VERIFY_OK'; return 0; }
  /usr/bin/hdiutil imageinfo "$F" >/dev/null 2>&1 && { say 'DMG_PARSE_OK'; return 0; }
  say 'DMG_VERIFY_FAILED'
  return 1
}

verify_pkg(){
  F=$1
  [ -x /usr/bin/xar ] || return 2
  W='/tmp/rescue3-xar'
  if [ -d /Volumes/Apple ]; then W='/Volumes/Apple/.rescue3-xar'; fi
  rm -rf "$W"; mkdir -p "$W" || return 2
  say "VERIFY_XAR=$F"
  /usr/bin/xar -xf "$F" -C "$W" >/tmp/rescue3-xar.log 2>&1
  RC=$?
  rm -rf "$W"
  if [ "$RC" -eq 0 ]; then say 'XAR_VERIFY_OK'; return 0; fi
  say 'XAR_VERIFY_FAILED'
  return 1
}

verify_small(){
  F=$1
  S=$(size "$F")
  [ "$S" -gt 0 ] || return 1
  case "$F" in
    *.plist)
      if [ -x /usr/bin/plutil ]; then
        /usr/bin/plutil -lint "$F" >/dev/null 2>&1 || return 1
      fi
      ;;
  esac
  say "SMALL_ASSET_OK bytes=$S"
  return 0
}

verify_asset(){
  F=$1; N=$2
  case "$N" in
    *.dmg) verify_dmg "$F"; return $?;;
    *.pkg) verify_pkg "$F"; return $?;;
    *.plist|*.chunklist) verify_small "$F"; return $?;;
  esac
  return 1
}

download_asset(){
  N=$1
  find_url "$N"
  [ -n "$FOUND" ] || { say "URL_NOT_SEEN_YET=$N"; return 0; }
  FINAL="$CAT_DIR/$N"
  PART="$FINAL.partial"

  if [ -f "$FINAL" ]; then
    say "FINAL_FOUND=$FINAL bytes=$(size "$FINAL")"
    if verify_asset "$FINAL" "$N"; then
      say "ASSET_READY=$FINAL"
      return 0
    fi
    say "FINAL_INVALID=$FINAL"
  fi

  say "ASSET_URL=$FOUND"
  ATT=1
  while [ "$ATT" -le 20 ]; do
    HAVE=$(size "$PART")
    say "DOWNLOAD_ATTEMPT=$ATT asset=$N existing_bytes=$HAVE"
    if [ "$HAVE" -gt 0 ]; then
      curl -fL -C - -H 'Cache-Control: no-cache' --connect-timeout 20 --speed-time 180 --speed-limit 1024 -o "$PART" "$FOUND"
    else
      curl -fL -H 'Cache-Control: no-cache' --connect-timeout 20 --speed-time 180 --speed-limit 1024 -o "$PART" "$FOUND"
    fi
    RC=$?
    say "CURL_EXIT=$RC bytes=$(size "$PART")"
    [ "$RC" -eq 0 ] && break
    ATT=$((ATT+1))
    [ "$ATT" -le 20 ] || { say "DOWNLOAD_INCOMPLETE=$N"; return 0; }
    sleep 5
  done

  if verify_asset "$PART" "$N"; then
    if [ -f "$FINAL" ]; then mv "$FINAL" "$FINAL.old" 2>/dev/null || true; fi
    mv "$PART" "$FINAL" || fail "cannot finalize $N"
    say "ASSET_READY=$FINAL"
  else
    say "VERIFY_FAILED=$PART"
  fi
}

for N in BaseSystem.dmg BaseSystem.chunklist InstallESDDmg.pkg InstallInfo.plist AppleDiagnostics.dmg AppleDiagnostics.chunklist; do
  download_asset "$N"
done

say 'RESCUE_V3_DONE'
say 'Restart the Catalina installer on CatalinaTemp. Existing verified assets in macOS Install Data should be reused by OSInstaller.'
