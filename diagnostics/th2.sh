#!/bin/bash
# Tahoe 26.6.2 single-file verified builder for A2141 Recovery.
# Downloads one complete InstallAssistant.pkg, validates exact size + published MD5,
# extracts ONLY the small Payload from the hybrid XAR (avoids full SharedSupport.dmg
# extraction in Recovery xar), reconstructs the installer app, then builds ONLY
# /dev/disk0s3 with Apple's createinstallmedia.
set -u

URL='https://swcdn.apple.com/content/downloads/37/33/140-93587-A_GRFFH93NOL/f944yaqo1cjhh2m0kxrl0zhcpg9yb9qphv/InstallAssistant.pkg'
EXPECTED=18384624402
EXPECTED_MD5='6e2b6b58535a7d2f9db8ab51911fd05c'
BASE='/Volumes/Apple/Tahoe-26.6.2-25G83'
PKG="$BASE/InstallAssistant.pkg"
TMP="$BASE/InstallAssistant.pkg.single"
XARWORK="$BASE/xar-payload"
STAGE="$BASE/app-stage"
APPROOT='/Volumes/Apple/Applications'
APP="$APPROOT/Install macOS Tahoe.app"
TARGET='/dev/disk0s3'

say(){ printf '%s\n' "$*"; }
fail(){ printf 'STOP: %s\n' "$*" >&2; exit 1; }
need(){ command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"; }
size(){ stat -f '%z' "$1" 2>/dev/null || printf '0\n'; }

for c in curl diskutil stat awk grep find mkdir rm mv df; do need "$c"; done
[ -x /usr/bin/xar ] || fail 'xar not found'
[ -x /usr/bin/hdiutil ] || fail 'hdiutil not found'
[ -d /Volumes/Apple ] || fail '/Volumes/Apple is not mounted'

AA=''
if [ -x /usr/bin/aa ]; then AA='/usr/bin/aa'; elif [ -x /usr/bin/yaa ]; then AA='/usr/bin/yaa'; else fail 'aa/yaa not found'; fi

MD5BIN=''
if command -v md5 >/dev/null 2>&1; then MD5BIN=$(command -v md5); elif [ -x /sbin/md5 ]; then MD5BIN='/sbin/md5'; elif [ -x /usr/bin/md5 ]; then MD5BIN='/usr/bin/md5'; else fail 'md5 tool not found'; fi

VER=$(sw_vers -productVersion 2>/dev/null || printf unknown)
say "RECOVERY_VERSION=$VER"
say 'MODE=TAHOE_SINGLE_FILE_HASH_VERIFIED_MEDIA'
say "EXPECTED_BYTES=$EXPECTED"
say "EXPECTED_MD5=$EXPECTED_MD5"
say "APPLE_ARCHIVE_TOOL=$AA"

if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -di -w $$ >/tmp/th2-caffeinate.log 2>&1 &
  CAFF=$!
  trap 'kill "$CAFF" 2>/dev/null || true' EXIT INT TERM
fi

AINFO=$(diskutil info /Volumes/Apple) || fail 'cannot inspect /Volumes/Apple'
printf '%s\n' "$AINFO" | grep -q 'Device Location:.*Internal' || fail '/Volumes/Apple is not internal'
printf '%s\n' "$AINFO" | grep -q 'File System Personality:.*APFS' || fail '/Volumes/Apple is not APFS'
FREE=$(df -k /Volumes/Apple | awk 'NR==2 {print $4}')
[ -n "$FREE" ] || fail 'cannot determine free space on Apple'
[ "$FREE" -gt 41943040 ] || fail 'need at least 40 GiB free on Apple'
mkdir -p "$BASE" "$APPROOT" || fail 'cannot create working directories'

md5_of(){
  F=$1
  "$MD5BIN" -q "$F" 2>/dev/null || "$MD5BIN" "$F" 2>/dev/null | awk '{print $NF}'
}

verify_hash(){
  F=$1
  [ -f "$F" ] || return 1
  SZ=$(size "$F")
  say "FILE_SIZE=$SZ"
  [ "$SZ" = "$EXPECTED" ] || { say 'SIZE_VERIFY_FAILED'; return 1; }
  say "CALCULATING_MD5=$F"
  GOT=$(md5_of "$F" | tr 'A-F' 'a-f')
  say "MD5=$GOT"
  [ "$GOT" = "$EXPECTED_MD5" ] || { say 'MD5_VERIFY_FAILED'; return 1; }
  say 'PACKAGE_HASH_VERIFY_OK'
  return 0
}

if [ -f "$PKG" ] && verify_hash "$PKG"; then
  say 'USING_EXISTING_HASH_VERIFIED_PACKAGE'
else
  [ -f "$PKG" ] && { say 'REMOVING_INVALID_EXISTING_PACKAGE'; rm -f "$PKG"; }
  rm -f "$TMP"
  say 'FULL_DOWNLOAD starting_from_byte=0'
  curl -fL --http1.1 --tlsv1.2 -H 'Cache-Control: no-cache' --connect-timeout 20 -o "$TMP" "$URL"
  RC=$?
  say "CURL_EXIT=$RC bytes=$(size "$TMP")"
  [ "$RC" -eq 0 ] || fail 'single-stream transfer failed; partial preserved only for diagnosis, do not resume it'
  verify_hash "$TMP" || fail 'download completed but exact package hash does not match; do not use this file'
  mv "$TMP" "$PKG" || fail 'cannot finalize InstallAssistant.pkg'
  say "FRESH_PACKAGE_READY=$PKG"
fi

rm -rf "$XARWORK" "$STAGE"
mkdir -p "$XARWORK" "$STAGE" || fail 'cannot create staging directories'
say 'XAR_LISTING'
/usr/bin/xar -tf "$PKG" >/tmp/th2-xar-list.txt 2>/tmp/th2-xar-list.err || fail 'xar cannot list package'
grep -Eq '(^|/)Payload$' /tmp/th2-xar-list.txt || fail 'Payload not present in XAR table of contents'
say 'EXTRACTING_ONLY_PAYLOAD_FROM_XAR'
/usr/bin/xar -xf "$PKG" -C "$XARWORK" Payload >/tmp/th2-xar-payload.log 2>&1 || {
  tail -n 10 /tmp/th2-xar-payload.log 2>/dev/null || true
  fail 'selective Payload extraction failed'
}
PAYLOAD=$(find "$XARWORK" -type f -name Payload -print | head -n 1)
[ -n "$PAYLOAD" ] || fail 'Payload not found after selective XAR extraction'
"$AA" list -i "$PAYLOAD" >/dev/null 2>&1 || fail 'Apple Archive tool cannot read Payload'
say 'PAYLOAD_VERIFY_OK'
say 'EXTRACTING_INSTALLER_APP'
"$AA" extract -i "$PAYLOAD" -d "$STAGE" -ignore-eperm || fail 'Apple Archive Payload extraction failed'

FOUND=$(find "$STAGE" -type d -name 'Install macOS Tahoe.app' -print | head -n 1)
[ -n "$FOUND" ] || FOUND=$(find "$STAGE" -type d -name 'Install macOS*.app' -print | head -n 1)
[ -n "$FOUND" ] && [ -d "$FOUND" ] || fail 'Tahoe installer app not found in Payload'
CIM="$FOUND/Contents/Resources/createinstallmedia"
[ -x "$CIM" ] || fail 'createinstallmedia missing from extracted app'
say "APP_EXTRACT_OK=$FOUND"

SSDIR="$FOUND/Contents/SharedSupport"
SS="$SSDIR/SharedSupport.dmg"
mkdir -p "$SSDIR" || fail 'cannot create SharedSupport directory'
rm -f "$SS"
if /bin/cp -c "$PKG" "$SS" 2>/dev/null; then
  say 'SHARED_SUPPORT_CLONE_OK'
else
  /bin/cp "$PKG" "$SS" || fail 'cannot copy package as SharedSupport.dmg'
  say 'SHARED_SUPPORT_COPY_OK'
fi
/bin/chmod 0644 "$SS" 2>/dev/null || true
/usr/bin/hdiutil imageinfo "$SS" >/dev/null 2>&1 || fail 'hybrid package is not recognized as SharedSupport disk image'
say 'SHARED_SUPPORT_IMAGEINFO_OK'

if [ -x /usr/bin/codesign ]; then
  /usr/bin/codesign -v "$CIM" >/dev/null 2>&1 || fail 'createinstallmedia code signature check failed'
  say 'CREATEINSTALLMEDIA_CODESIGN_OK'
fi

rm -rf "$APP"
/bin/mv "$FOUND" "$APP" || fail 'cannot move Tahoe app to /Volumes/Apple/Applications'
CIM="$APP/Contents/Resources/createinstallmedia"
rm -rf "$XARWORK" "$STAGE"
say "APP_READY=$APP"

TINFO=$(diskutil info "$TARGET") || fail "$TARGET not found"
printf '%s\n' "$TINFO" | grep -q 'Device Location:.*Internal' || fail 'disk0s3 is not internal'
printf '%s\n' "$TINFO" | grep -q 'Part of Whole:.*disk0' || fail 'disk0s3 is not part of disk0'
TBYTES=$(printf '%s\n' "$TINFO" | awk -F'[()]' '/Disk Size:/ {x=$2; gsub(/[^0-9]/,"",x); print x; exit}')
[ -n "$TBYTES" ] || fail 'cannot read disk0s3 size'
[ "$TBYTES" -gt 60000000000 ] && [ "$TBYTES" -lt 80000000000 ] || fail "unexpected disk0s3 size: $TBYTES"
ROOTDEV=$(df / | awk 'NR==2 {print $1}')
case "$ROOTDEV" in /dev/disk0s3|/dev/rdisk0s3) fail 'current Recovery is running from disk0s3';; esac

diskutil mount "$TARGET" >/dev/null 2>&1 || true
MOUNT=$(diskutil info "$TARGET" | awk -F: '/Mount Point/ {sub(/^[ \t]+/,"",$2); print $2; exit}')
[ -n "$MOUNT" ] && [ "$MOUNT" != 'Not mounted' ] && [ -d "$MOUNT" ] || fail 'disk0s3 is not mounted'
say "ABOUT_TO_ERASE_ONLY=$TARGET"
say "CREATEINSTALLMEDIA_TARGET=$MOUNT"
"$CIM" --volume "$MOUNT" --nointeraction || fail 'createinstallmedia failed'

NEWMOUNT=$(diskutil info "$TARGET" | awk -F: '/Mount Point/ {sub(/^[ \t]+/,"",$2); print $2; exit}')
[ -n "$NEWMOUNT" ] && [ "$NEWMOUNT" != 'Not mounted' ] || fail 'Tahoe installer not mounted after build'
if command -v bless >/dev/null 2>&1; then bless --info "$NEWMOUNT" || fail 'bless does not recognize Tahoe installer'; fi
say "BUILD_OK: Tahoe boot installer created on $TARGET at $NEWMOUNT"
