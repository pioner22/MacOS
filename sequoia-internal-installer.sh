#!/bin/bash
# macOS Sequoia 15.8 (24H23) internal-installer helper for Recovery.
# Bash 3.2 compatible. Does not touch Time Machine disks.
set -u

VERSION='1.1.0'
URL='https://swcdn.apple.com/content/downloads/24/14/142-16660-A_CTI1XX4VYC/dwxnuxoud4401qcf8to49p8iq1ij987j1e/InstallAssistant.pkg'
EXPECTED_SIZE='15664077639'
WORK='/Volumes/Apple/Sequoia-15.8-24H23'
PKG="$WORK/InstallAssistant.pkg"
PART="$PKG.part"
XARWORK="$WORK/xar"
APPROOT='/Volumes/Apple/Applications'
APP="$APPROOT/Install macOS Sequoia.app"
TARGET_DEV='/dev/disk0s3'

say(){ printf '%s\n' "$*"; }
die(){ printf 'STOP: %s\n' "$*" >&2; exit 1; }
need(){ command -v "$1" >/dev/null 2>&1 || die "Required command missing: $1"; }
pkg_size(){ stat -f '%z' "$1" 2>/dev/null || printf '0\n'; }

start_caffeinate(){
  command -v caffeinate >/dev/null 2>&1 || return 0
  caffeinate -di -w $$ >/tmp/sequoia-helper-caffeinate.log 2>&1 &
  CAFF=$!
}
stop_caffeinate(){
  [ -n "${CAFF:-}" ] || return 0
  kill "$CAFF" 2>/dev/null || :
  wait "$CAFF" 2>/dev/null || :
}

check_pkg_size(){
  [ -f "$PKG" ] || die "Missing $PKG"
  local s
  s=$(pkg_size "$PKG")
  say "PKG_SIZE=$s expected=$EXPECTED_SIZE"
  [ "$s" = "$EXPECTED_SIZE" ] || die 'Unexpected InstallAssistant.pkg size.'
}

apple_volume_ok(){
  [ -d /Volumes/Apple ] || die '/Volumes/Apple is not mounted.'
  local info loc fs
  info=$(diskutil info /Volumes/Apple) || die 'Cannot inspect /Volumes/Apple.'
  loc=$(printf '%s\n' "$info" | awk -F: '/Device Location/ {gsub(/^[ \t]+/,"",$2); print $2; exit}')
  fs=$(printf '%s\n' "$info" | awk -F: '/File System Personality/ {gsub(/^[ \t]+/,"",$2); print $2; exit}')
  [ "$loc" = Internal ] || die '/Volumes/Apple is not internal.'
  case "$fs" in APFS*) ;; *) die '/Volumes/Apple is not APFS.';; esac
}

download_pkg(){
  need curl; need stat; need mv; need mkdir; need sleep; apple_volume_ok
  mkdir -p "$WORK" || die "Cannot create $WORK"
  if [ -f "$PKG" ] && [ "$(pkg_size "$PKG")" = "$EXPECTED_SIZE" ]; then
    say 'DOWNLOAD_OK: complete-size package already present.'
    return 0
  fi
  local attempt=1 rc s
  while [ "$attempt" -le 40 ]; do
    s=$(pkg_size "$PART")
    say "DOWNLOAD_ATTEMPT=$attempt existing_bytes=$s"
    if [ "$s" -gt 0 ]; then
      curl -fL -C - --connect-timeout 20 --speed-time 180 --speed-limit 1024 -o "$PART" "$URL"
    else
      curl -fL --connect-timeout 20 --speed-time 180 --speed-limit 1024 -o "$PART" "$URL"
    fi
    rc=$?; s=$(pkg_size "$PART"); say "CURL_EXIT=$rc bytes=$s"
    if [ "$rc" = 0 ]; then
      [ "$s" = "$EXPECTED_SIZE" ] || die 'curl completed but file size is unexpected.'
      mv "$PART" "$PKG" || die 'Cannot finalize package.'
      say "DOWNLOAD_OK: $PKG"
      return 0
    fi
    [ "$rc" != 33 ] || die 'Server rejected resume; partial preserved.'
    attempt=$((attempt+1)); sleep 5
  done
  die 'Download did not complete.'
}

find_payload(){
  need xar; need tar; need find; need grep; need rm; need mkdir
  check_pkg_size
  rm -rf "$XARWORK" || die 'Cannot remove old xar work directory.'
  mkdir -p "$XARWORK" || die 'Cannot create xar work directory.'
  say 'Extracting InstallAssistant.pkg with xar...'
  /usr/bin/xar -xf "$PKG" -C "$XARWORK" || die 'xar extraction failed.'
  PAYLOAD=''
  for p in $(/usr/bin/find "$XARWORK" -type f -name Payload -print); do
    if /usr/bin/tar -tf "$p" 2>/dev/null | /usr/bin/grep -F 'Install macOS Sequoia.app/Contents/Resources/createinstallmedia' >/dev/null 2>&1; then
      PAYLOAD=$p
      break
    fi
  done
  [ -n "$PAYLOAD" ] || die 'No Payload containing Install macOS Sequoia.app/createinstallmedia was found.'
  say "PAYLOAD_OK=$PAYLOAD"
}

inspect(){
  apple_volume_ok
  find_payload
  say 'INSPECT_OK: Sequoia installer payload is readable and contains createinstallmedia.'
}

extract_app(){
  apple_volume_ok
  find_payload
  mkdir -p "$APPROOT" || die 'Cannot create /Volumes/Apple/Applications.'
  rm -rf "$APP" || die 'Cannot remove previous extracted installer app.'
  say "Extracting installer app to $APPROOT ..."
  /usr/bin/tar -xf "$PAYLOAD" -C "$APPROOT" || die 'Payload extraction failed.'
  CIM="$APP/Contents/Resources/createinstallmedia"
  [ -x "$CIM" ] || die 'createinstallmedia is missing after extraction.'
  if [ -x /usr/bin/codesign ]; then
    /usr/bin/codesign -v "$CIM" >/dev/null 2>&1 || die 'createinstallmedia code signature verification failed.'
  fi
  say "APP_OK=$APP"
  say "CREATEINSTALLMEDIA_OK=$CIM"
}

check_target(){
  local info loc whole fs size
  info=$(diskutil info "$TARGET_DEV") || die "$TARGET_DEV is not present."
  loc=$(printf '%s\n' "$info" | awk -F: '/Device Location/ {gsub(/^[ \t]+/,"",$2); print $2; exit}')
  whole=$(printf '%s\n' "$info" | awk -F: '/Part of Whole/ {gsub(/^[ \t]+/,"",$2); print $2; exit}')
  fs=$(printf '%s\n' "$info" | awk -F: '/File System Personality/ {gsub(/^[ \t]+/,"",$2); print $2; exit}')
  size=$(printf '%s\n' "$info" | awk -F: '/Disk Size/ {gsub(/^[ \t]+/,"",$2); print $2; exit}')
  [ "$loc" = Internal ] || die "$TARGET_DEV is not internal."
  [ "$whole" = disk0 ] || die "$TARGET_DEV is not part of disk0."
  case "$fs" in 'Journaled HFS+'|'Mac OS Extended'*) ;; *) die "$TARGET_DEV is not HFS+.";; esac
  say "TARGET_OK=$TARGET_DEV size=$size"
}

build(){
  need diskutil; need bless; apple_volume_ok; check_target
  [ -x "$APP/Contents/Resources/createinstallmedia" ] || extract_app
  say ''
  say "WARNING: this will ERASE ONLY $TARGET_DEV (~70 GB installer partition)."
  say 'It will NOT erase disk0s2 /Volumes/Apple.'
  printf 'Type SEQUOIA to continue: '
  IFS= read -r answer
  [ "$answer" = SEQUOIA ] || die 'Cancelled.'
  diskutil mount "$TARGET_DEV" >/dev/null 2>&1 || :
  MOUNT=$(diskutil info "$TARGET_DEV" | awk -F: '/Mount Point/ {sub(/^[ \t]+/,"",$2); print $2; exit}')
  [ -n "$MOUNT" ] && [ "$MOUNT" != 'Not mounted' ] || die 'Target is not mounted.'
  "$APP/Contents/Resources/createinstallmedia" --volume "$MOUNT" --nointeraction || die 'createinstallmedia failed.'
  NEWMOUNT=$(diskutil info "$TARGET_DEV" | awk -F: '/Mount Point/ {sub(/^[ \t]+/,"",$2); print $2; exit}')
  bless --info "$NEWMOUNT" || die 'bless did not recognize rebuilt installer.'
  say 'BUILD_OK: fresh internal Sequoia installer created on disk0s3.'
}

status(){
  say "VERSION=$VERSION"
  if [ -f "$PKG" ]; then say "PKG=$PKG size=$(pkg_size "$PKG")"; else say 'PKG=missing'; fi
  diskutil info "$TARGET_DEV" 2>/dev/null || :
}

main(){
  start_caffeinate
  trap stop_caffeinate EXIT INT TERM
  case "${1:-status}" in
    download) download_pkg ;;
    inspect) inspect ;;
    extract) extract_app ;;
    build) build ;;
    status) status ;;
    *) die 'Usage: script [download|inspect|extract|build|status]' ;;
  esac
}
main "$@"
