#!/bin/bash
# A2141 Tahoe Recovery helper.
# Builds a verified full macOS Tahoe 26.6.2 installer app on /Volumes/Apple.
# Default action: prepare only. Optional action "install" runs startosinstall
# against /Volumes/CatalinaTemp after an explicit confirmation.
# Optional action "media" uses Apple's createinstallmedia on ONLY /dev/disk0s3.
# Bash 3.2 compatible. No Python required.
set -u

VERSION='26.6.2'
BUILD='25G83'
URL='https://swcdn.apple.com/content/downloads/37/33/140-93587-A_GRFFH93NOL/f944yaqo1cjhh2m0kxrl0zhcpg9yb9qphv/InstallAssistant.pkg'
BASE="/Volumes/Apple/Tahoe-${VERSION}-${BUILD}"
PKG="$BASE/InstallAssistant.pkg"
PART="$BASE/InstallAssistant.pkg.part"
FRESH="$BASE/InstallAssistant.pkg.fresh"
XARWORK="$BASE/xar-verify"
STAGE="$BASE/app-stage"
APPROOT='/Volumes/Apple/Applications'
APP="$APPROOT/Install macOS Tahoe.app"
TARGET_VOL='/Volumes/CatalinaTemp'
MEDIA_DEV='/dev/disk0s3'
ACTION=${1:-prepare}

say(){ printf '%s\n' "$*"; }
fail(){ printf 'STOP: %s\n' "$*" >&2; exit 1; }
need(){ command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"; }
size(){ stat -f '%z' "$1" 2>/dev/null || printf '0\n'; }
stamp(){ date +%Y%m%d-%H%M%S 2>/dev/null || printf 'now\n'; }

for c in curl diskutil stat awk grep find mkdir rm mv sleep df date; do need "$c"; done
[ -x /usr/bin/xar ] || fail 'xar not found'
[ -x /usr/bin/hdiutil ] || fail 'hdiutil not found'
[ -x /usr/bin/ditto ] || fail 'ditto not found'
[ -d /Volumes/Apple ] || fail '/Volumes/Apple is not mounted'

AA=''
if [ -x /usr/bin/aa ]; then
  AA='/usr/bin/aa'
elif [ -x /usr/bin/yaa ]; then
  AA='/usr/bin/yaa'
else
  fail 'Apple Archive extractor aa/yaa not found'
fi

RECOVERY_VER='unknown'
if command -v sw_vers >/dev/null 2>&1; then
  RECOVERY_VER=$(sw_vers -productVersion 2>/dev/null || printf 'unknown')
fi
say "RECOVERY_VERSION=$RECOVERY_VER"
say "MODE=TAHOE_${VERSION}_${BUILD} action=$ACTION"
say "APPLE_ARCHIVE_TOOL=$AA"

if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -di -w $$ >/tmp/tahoe-helper-caffeinate.log 2>&1 &
  CAFF=$!
  trap 'kill "$CAFF" 2>/dev/null || true' EXIT INT TERM
fi

AINFO=$(diskutil info /Volumes/Apple) || fail 'cannot inspect /Volumes/Apple'
printf '%s\n' "$AINFO" | grep -q 'Device Location:.*Internal' || fail '/Volumes/Apple is not internal'
printf '%s\n' "$AINFO" | grep -q 'File System Personality:.*APFS' || fail '/Volumes/Apple is not APFS'
FREE=$(df -k /Volumes/Apple | awk 'NR==2 {print $4}')
[ -n "$FREE" ] || fail 'cannot determine free space on Apple'
[ "$FREE" -gt 41943040 ] || fail 'need at least 40 GiB free on /Volumes/Apple'
mkdir -p "$BASE" "$APPROOT" || fail 'cannot create working directories'

verify_xar(){
  F=$1
  rm -rf "$XARWORK"
  mkdir -p "$XARWORK" || return 1
  say "VERIFY_XAR=$F"
  /usr/bin/xar -xf "$F" -C "$XARWORK" >/tmp/tahoe-xar.log 2>&1
  RC=$?
  if [ "$RC" -eq 0 ]; then
    say 'XAR_VERIFY_OK'
    return 0
  fi
  say 'XAR_VERIFY_FAILED'
  tail -n 10 /tmp/tahoe-xar.log 2>/dev/null || true
  rm -rf "$XARWORK"
  return 1
}

download_pkg(){
  ATT=1
  while [ "$ATT" -le 50 ]; do
    HAVE=$(size "$PART")
    say "DOWNLOAD_ATTEMPT=$ATT existing_bytes=$HAVE"
    if [ "$HAVE" -gt 0 ]; then
      curl -fL -C - -H 'Cache-Control: no-cache' --connect-timeout 20 --speed-time 180 --speed-limit 1024 -o "$PART" "$URL"
    else
      curl -fL -H 'Cache-Control: no-cache' --connect-timeout 20 --speed-time 180 --speed-limit 1024 -o "$PART" "$URL"
    fi
    RC=$?
    HAVE=$(size "$PART")
    say "CURL_EXIT=$RC bytes=$HAVE"
    if [ "$RC" -eq 0 ]; then
      break
    fi
    if [ "$RC" -eq 33 ]; then
      say 'RANGE_RESUME_REJECTED: downloading a fresh copy alongside the partial.'
      rm -f "$FRESH"
      curl -fL -H 'Cache-Control: no-cache' --connect-timeout 20 --speed-time 180 --speed-limit 1024 -o "$FRESH" "$URL"
      RC=$?
      say "FRESH_CURL_EXIT=$RC bytes=$(size "$FRESH")"
      [ "$RC" -eq 0 ] || fail 'fresh download failed; original partial preserved'
      verify_xar "$FRESH" || fail 'fresh download failed XAR verification; original partial preserved'
      [ -f "$PART" ] && mv "$PART" "$PART.bad-$(stamp)" 2>/dev/null || true
      mv "$FRESH" "$PKG" || fail 'cannot finalize fresh InstallAssistant.pkg'
      return 0
    fi
    ATT=$((ATT+1))
    [ "$ATT" -le 50 ] || fail 'download incomplete; partial preserved for next run'
    sleep 5
  done
  verify_xar "$PART" || fail 'download completed but XAR verification failed; partial preserved'
  mv "$PART" "$PKG" || fail 'cannot finalize InstallAssistant.pkg'
}

if [ -f "$PKG" ]; then
  say "EXISTING_PACKAGE=$PKG bytes=$(size "$PKG")"
  if verify_xar "$PKG"; then
    say 'USING_EXISTING_VERIFIED_PACKAGE'
  else
    mv "$PKG" "$PKG.bad-$(stamp)" || fail 'cannot quarantine invalid package'
    download_pkg
  fi
else
  download_pkg
fi

if [ ! -d "$XARWORK" ]; then
  verify_xar "$PKG" || fail 'package verification failed before extraction'
fi
PAYLOAD=$(find "$XARWORK" -type f -name Payload -print | head -n 1)
[ -n "$PAYLOAD" ] || fail 'Payload not found after XAR extraction'
say "PAYLOAD=$PAYLOAD"

rm -rf "$STAGE"
mkdir -p "$STAGE" || fail 'cannot create app staging directory'
"$AA" list -i "$PAYLOAD" >/dev/null 2>&1 || fail 'aa/yaa cannot read Payload'
say 'EXTRACTING_INSTALLER_APP'
"$AA" extract -i "$PAYLOAD" -d "$STAGE" -ignore-eperm || fail 'Apple Archive Payload extraction failed'

FOUND=$(find "$STAGE" -type d -name 'Install macOS Tahoe.app' -print | head -n 1)
if [ -z "$FOUND" ]; then
  FOUND=$(find "$STAGE" -type d -name 'Install macOS*.app' -print | head -n 1)
fi
[ -n "$FOUND" ] && [ -d "$FOUND" ] || fail 'Install macOS Tahoe.app not found in Payload'
SOI="$FOUND/Contents/Resources/startosinstall"
CIM="$FOUND/Contents/Resources/createinstallmedia"
[ -x "$SOI" ] || fail 'startosinstall missing from extracted app'
[ -x "$CIM" ] || fail 'createinstallmedia missing from extracted app'
say "APP_EXTRACT_OK=$FOUND"

SSDIR="$FOUND/Contents/SharedSupport"
SS="$SSDIR/SharedSupport.dmg"
mkdir -p "$SSDIR" || fail 'cannot create SharedSupport directory'
rm -f "$SS"
if /bin/cp -c "$PKG" "$SS" 2>/dev/null; then
  say 'SHARED_SUPPORT_CLONE_OK'
else
  say 'SHARED_SUPPORT_COPY_FALLBACK'
  /bin/cp "$PKG" "$SS" || fail 'cannot create SharedSupport.dmg'
fi
/bin/chmod 0644 "$SS" 2>/dev/null || true
/usr/bin/hdiutil imageinfo "$SS" >/dev/null 2>&1 || fail 'SharedSupport.dmg is not recognized as a disk image'
say 'SHARED_SUPPORT_OK'

if [ -x /usr/bin/codesign ]; then
  /usr/bin/codesign -v "$SOI" >/dev/null 2>&1 || fail 'startosinstall code signature check failed'
  /usr/bin/codesign -v "$CIM" >/dev/null 2>&1 || fail 'createinstallmedia code signature check failed'
  say 'CODESIGN_OK'
fi

rm -rf "$APP"
/bin/mv "$FOUND" "$APP" || fail 'cannot move installer app to /Volumes/Apple/Applications'
SOI="$APP/Contents/Resources/startosinstall"
CIM="$APP/Contents/Resources/createinstallmedia"
rm -rf "$XARWORK" "$STAGE"
say "APP_READY=$APP"

USAGE=$($SOI --usage 2>&1 || true)
printf '%s\n' "$USAGE" > /tmp/tahoe-startosinstall-usage.txt
if printf '%s\n' "$USAGE" | grep -q -- '--volume'; then
  say 'STARTOSINSTALL_VOLUME_SUPPORTED=YES'
else
  say 'STARTOSINSTALL_VOLUME_SUPPORTED=NO'
fi

case "$ACTION" in
  prepare)
    say 'PREPARE_OK'
    say 'NEXT: run this script with action install for direct install to CatalinaTemp, or media to replace disk0s3 with a Tahoe boot installer.'
    exit 0
    ;;
  install)
    [ -d "$TARGET_VOL" ] || fail "$TARGET_VOL is not mounted"
    TINFO=$(diskutil info "$TARGET_VOL") || fail 'cannot inspect CatalinaTemp'
    printf '%s\n' "$TINFO" | grep -q 'Device Location:.*Internal' || fail 'CatalinaTemp is not internal'
    printf '%s\n' "$TINFO" | grep -q 'File System Personality:.*APFS' || fail 'CatalinaTemp is not APFS'
    TFRE=$(df -k "$TARGET_VOL" | awk 'NR==2 {print $4}')
    [ -n "$TFRE" ] || fail 'cannot determine CatalinaTemp free space'
    [ "$TFRE" -gt 31457280 ] || fail 'CatalinaTemp needs at least 30 GiB free'
    ROOTDEV=$(df / | awk 'NR==2 {print $1}')
    TARGETDEV=$(df "$TARGET_VOL" | awk 'NR==2 {print $1}')
    [ "$ROOTDEV" != "$TARGETDEV" ] || fail 'refusing to install onto current Recovery root'
    printf '%s\n' "$USAGE" | grep -q -- '--volume' || fail 'this startosinstall does not expose --volume in Recovery'
    say "DIRECT_INSTALL_TARGET=$TARGET_VOL device=$TARGETDEV"
    say 'WARNING: stale Catalina installer data on CatalinaTemp will be removed.'
    say 'Type YES and press Return to start Tahoe installation to CatalinaTemp.'
    ANSWER=''
    if [ -r /dev/tty ]; then IFS= read -r ANSWER </dev/tty || true; fi
    [ "$ANSWER" = 'YES' ] || fail 'installation cancelled; installer app remains ready on Apple'
    rm -rf "$TARGET_VOL/macOS Install Data" "$TARGET_VOL/.OSInstallerMessages" 2>/dev/null || true
    command -v sync >/dev/null 2>&1 && sync
    say 'STARTING_STARTOSINSTALL'
    "$SOI" --volume "$TARGET_VOL" --agreetolicense --nointeraction
    RC=$?
    say "STARTOSINSTALL_EXIT=$RC"
    [ "$RC" -eq 0 ] || fail 'startosinstall returned an error; installer app and package were preserved'
    exit 0
    ;;
  media)
    TINFO=$(diskutil info "$MEDIA_DEV") || fail "$MEDIA_DEV not found"
    printf '%s\n' "$TINFO" | grep -q 'Device Location:.*Internal' || fail 'disk0s3 is not internal'
    printf '%s\n' "$TINFO" | grep -q 'Part of Whole:.*disk0' || fail 'disk0s3 is not part of disk0'
    TBYTES=$(printf '%s\n' "$TINFO" | awk -F'[()]' '/Disk Size:/ {x=$2; gsub(/[^0-9]/,"",x); print x; exit}')
    [ -n "$TBYTES" ] || fail 'cannot read disk0s3 size'
    [ "$TBYTES" -gt 60000000000 ] && [ "$TBYTES" -lt 80000000000 ] || fail "unexpected disk0s3 size: $TBYTES"
    ROOTDEV=$(df / | awk 'NR==2 {print $1}')
    case "$ROOTDEV" in /dev/disk0s3|/dev/rdisk0s3) fail 'current system is running from disk0s3';; esac
    say 'WARNING: media mode ERASES ONLY /dev/disk0s3 and replaces the Sequoia boot installer with Tahoe.'
    say 'Type ERASE and press Return to continue.'
    ANSWER=''
    if [ -r /dev/tty ]; then IFS= read -r ANSWER </dev/tty || true; fi
    [ "$ANSWER" = 'ERASE' ] || fail 'media creation cancelled'
    diskutil mount "$MEDIA_DEV" >/dev/null 2>&1 || true
    MOUNT=$(diskutil info "$MEDIA_DEV" | awk -F: '/Mount Point/ {sub(/^[ \t]+/,"",$2); print $2; exit}')
    [ -n "$MOUNT" ] && [ "$MOUNT" != 'Not mounted' ] && [ -d "$MOUNT" ] || fail 'disk0s3 is not mounted'
    "$CIM" --volume "$MOUNT" --nointeraction || fail 'createinstallmedia failed'
    NEWMOUNT=$(diskutil info "$MEDIA_DEV" | awk -F: '/Mount Point/ {sub(/^[ \t]+/,"",$2); print $2; exit}')
    [ -n "$NEWMOUNT" ] && [ "$NEWMOUNT" != 'Not mounted' ] || fail 'Tahoe installer not mounted after createinstallmedia'
    if command -v bless >/dev/null 2>&1; then bless --info "$NEWMOUNT" || fail 'bless does not recognize Tahoe installer'; fi
    say "MEDIA_OK=$NEWMOUNT"
    exit 0
    ;;
  *)
    fail 'unknown action; use prepare, install, or media'
    ;;
esac
