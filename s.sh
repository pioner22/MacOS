#!/bin/bash
# Sequoia Recovery auto-builder for A2141.
# Reuses an already downloaded valid InstallAssistant.pkg when present, verifies
# its full XAR checksums, extracts the Apple-Archive Payload, reconstructs the
# installer app, and rebuilds ONLY /dev/disk0s3 as the internal installer.
# It never erases disk0, disk0s2, or /Volumes/Apple.
set -u

URL='https://swcdn.apple.com/content/downloads/24/14/142-16660-A_CTI1XX4VYC/dwxnuxoud4401qcf8to49p8iq1ij987j1e/InstallAssistant.pkg'
EXPECTED='15664077639'
BASE='/Volumes/Apple/Sequoia-15.8-24H23'
PKG="$BASE/InstallAssistant.pkg"
PART="$BASE/InstallAssistant.pkg.new.part"
XARWORK="$BASE/xar-new"
STAGE="$BASE/app-stage"
APPROOT='/Volumes/Apple/Applications'
FINALAPP="$APPROOT/Install macOS Sequoia.app"
TARGET='/dev/disk0s3'

say(){ printf '%s\n' "$*"; }
fail(){ printf 'STOP: %s\n' "$*" >&2; exit 1; }
need(){ command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"; }
size(){ stat -f '%z' "$1" 2>/dev/null || printf '0\n'; }

for c in curl diskutil stat awk grep find mkdir rm mv date df caffeinate bless; do need "$c"; done
[ -x /usr/bin/xar ] || fail 'xar not found'
[ -x /usr/bin/ditto ] || fail 'ditto not found'
[ -x /usr/bin/hdiutil ] || fail 'hdiutil not found'
[ -d /Volumes/Apple ] || fail '/Volumes/Apple is not mounted'

AA=''
if [ -x /usr/bin/aa ]; then
  AA='/usr/bin/aa'
elif [ -x /usr/bin/yaa ]; then
  AA='/usr/bin/yaa'
else
  fail 'Apple Archive extractor aa/yaa not found in this Recovery'
fi
say "APPLE_ARCHIVE_TOOL=$AA"

caffeinate -di -w $$ >/tmp/sequoia-auto-caffeinate.log 2>&1 &
CAFF=$!
trap 'kill "$CAFF" 2>/dev/null || true' EXIT INT TERM

# Safety: Apple must be the large internal APFS volume.
INFO=$(diskutil info /Volumes/Apple) || fail 'cannot inspect /Volumes/Apple'
printf '%s\n' "$INFO" | grep -q 'Device Location:.*Internal' || fail '/Volumes/Apple is not internal'
printf '%s\n' "$INFO" | grep -q 'File System Personality:.*APFS' || fail '/Volumes/Apple is not APFS'
FREE=$(df -k /Volumes/Apple | awk 'NR==2 {print $4}')
[ -n "$FREE" ] || fail 'cannot determine free space on Apple'
[ "$FREE" -gt 41943040 ] || fail 'need at least 40 GiB free on Apple'

# Safety: exact dedicated internal HFS+ installer partition only.
TINFO=$(diskutil info "$TARGET") || fail "$TARGET not found"
printf '%s\n' "$TINFO" | grep -q 'Device Location:.*Internal' || fail "$TARGET is not internal"
printf '%s\n' "$TINFO" | grep -q 'Part of Whole:.*disk0' || fail "$TARGET is not part of disk0"
printf '%s\n' "$TINFO" | grep -Eq 'File System Personality:.*(Journaled HFS\+|Mac OS Extended)' || fail "$TARGET is not HFS+"
TBYTES=$(printf '%s\n' "$TINFO" | awk -F'[()]' '/Disk Size:/ {x=$2; gsub(/[^0-9]/,"",x); print x; exit}')
[ -n "$TBYTES" ] || fail 'cannot read target size'
[ "$TBYTES" -gt 60000000000 ] && [ "$TBYTES" -lt 80000000000 ] || fail "unexpected target size: $TBYTES bytes"
ROOTDEV=$(df / | awk 'NR==2 {print $1}')
case "$ROOTDEV" in /dev/disk0s3|/dev/rdisk0s3) fail 'current system is running from disk0s3; reboot Internet Recovery first';; esac
say "TARGET_OK=$TARGET bytes=$TBYTES root=$ROOTDEV"

mkdir -p "$BASE" "$APPROOT" || fail 'cannot create working directories'

fresh_download(){
  rm -f "$PART"
  say 'Downloading a fresh macOS Sequoia 15.8 InstallAssistant.pkg from Apple CDN...'
  ATTEMPT=1
  while [ "$ATTEMPT" -le 40 ]; do
    HAVE=$(size "$PART")
    say "DOWNLOAD_ATTEMPT=$ATTEMPT existing_bytes=$HAVE"
    if [ "$HAVE" -gt 0 ]; then
      curl -fL -C - -H 'Cache-Control: no-cache' --connect-timeout 20 --speed-time 180 --speed-limit 1024 -o "$PART" "$URL"
    else
      curl -fL -H 'Cache-Control: no-cache' --connect-timeout 20 --speed-time 180 --speed-limit 1024 -o "$PART" "$URL"
    fi
    RC=$?
    HAVE=$(size "$PART")
    say "CURL_EXIT=$RC bytes=$HAVE"
    if [ "$RC" = 0 ]; then break; fi
    ATTEMPT=$((ATTEMPT+1))
    [ "$ATTEMPT" -le 40 ] || fail 'download did not complete; partial file preserved'
    sleep 5
  done
  [ "$(size "$PART")" = "$EXPECTED" ] || fail "download size mismatch: got $(size "$PART"), expected $EXPECTED"
  mv "$PART" "$PKG" || fail 'cannot finalize package'
  say "DOWNLOAD_OK size=$(size "$PKG")"
}

verify_xar(){
  rm -rf "$XARWORK"
  mkdir -p "$XARWORK" || return 1
  say 'VERIFY: fully extracting XAR and checking archived checksums...'
  /usr/bin/xar -xf "$PKG" -C "$XARWORK"
}

# Reuse the second, already-good download instead of downloading 15.6 GB again.
if [ -f "$PKG" ] && [ "$(size "$PKG")" = "$EXPECTED" ]; then
  say "USING_EXISTING_PACKAGE size=$(size "$PKG")"
  if verify_xar; then
    say 'XAR_VERIFY_OK'
  else
    say 'Existing package failed XAR verification; quarantining and downloading once more.'
    STAMP=$(date +%Y%m%d-%H%M%S 2>/dev/null || echo old)
    mv "$PKG" "$BASE/InstallAssistant.pkg.bad-$STAMP" || fail 'cannot quarantine invalid package'
    fresh_download
    verify_xar || fail 'fresh package failed XAR checksum verification; do NOT build installer'
    say 'XAR_VERIFY_OK'
  fi
else
  if [ -f "$PKG" ]; then
    STAMP=$(date +%Y%m%d-%H%M%S 2>/dev/null || echo old)
    mv "$PKG" "$BASE/InstallAssistant.pkg.bad-$STAMP" || fail 'cannot quarantine wrong-size package'
  fi
  fresh_download
  verify_xar || fail 'fresh package failed XAR checksum verification; do NOT build installer'
  say 'XAR_VERIFY_OK'
fi

PAYLOAD=$(/usr/bin/find "$XARWORK" -type f -name Payload -print | head -n 1)
[ -n "$PAYLOAD" ] || fail 'Payload not found after XAR extraction'
say "PAYLOAD=$PAYLOAD"

# Modern InstallAssistant Payload is Apple Archive, not tar.
rm -rf "$STAGE"
mkdir -p "$STAGE" || fail 'cannot create app staging directory'
say 'Checking Apple Archive Payload...'
"$AA" list -i "$PAYLOAD" >/dev/null 2>&1 || fail 'aa/yaa cannot read Payload'
say 'Extracting installer application from Apple Archive Payload...'
"$AA" extract -i "$PAYLOAD" -d "$STAGE" -ignore-eperm || fail 'Apple Archive Payload extraction failed'

FOUND=$(/usr/bin/find "$STAGE" -type d -name 'Install macOS Sequoia.app' -print | head -n 1)
[ -n "$FOUND" ] && [ -d "$FOUND" ] || fail 'Install macOS Sequoia.app not found in Payload'
CIM="$FOUND/Contents/Resources/createinstallmedia"
[ -x "$CIM" ] || fail 'createinstallmedia is missing from extracted app'
say "APP_EXTRACT_OK=$FOUND"

# Reproduce Apple's InstallAssistant postinstall behavior: the hybrid PKG itself
# is placed in Contents/SharedSupport as SharedSupport.dmg.
SSDIR="$FOUND/Contents/SharedSupport"
SS="$SSDIR/SharedSupport.dmg"
mkdir -p "$SSDIR" || fail 'cannot create SharedSupport directory'
rm -f "$SS"
if /bin/cp -c "$PKG" "$SS" 2>/dev/null; then
  say 'SHARED_SUPPORT_CLONE_OK'
else
  say 'APFS clone copy unavailable; copying SharedSupport.dmg normally...'
  /bin/cp "$PKG" "$SS" || fail 'cannot create SharedSupport.dmg from InstallAssistant.pkg'
fi
/bin/chmod 0644 "$SS" || fail 'cannot set SharedSupport.dmg permissions'
/usr/bin/hdiutil imageinfo "$SS" >/dev/null 2>&1 || fail 'SharedSupport.dmg is not recognized as a disk image'
say 'SHARED_SUPPORT_OK'

# Validate the Apple-signed createinstallmedia binary when codesign is available.
if [ -x /usr/bin/codesign ]; then
  /usr/bin/codesign -v -R='anchor apple' "$CIM" || fail 'createinstallmedia Apple code signature check failed'
  say 'CODESIGN_OK'
fi

# Move app on the same APFS volume, preserving clone/link semantics.
rm -rf "$FINALAPP"
/bin/mv "$FOUND" "$FINALAPP" || fail 'cannot move installer app to /Volumes/Apple/Applications'
CIM="$FINALAPP/Contents/Resources/createinstallmedia"
[ -x "$CIM" ] || fail 'final createinstallmedia is missing'
say "APP_READY=$FINALAPP"

# XAR expansion is no longer needed; remove it to free temporary space.
rm -rf "$XARWORK" "$STAGE"

# Final safety check immediately before the only destructive step.
TINFO=$(diskutil info "$TARGET") || fail "$TARGET disappeared before build"
printf '%s\n' "$TINFO" | grep -q 'Device Location:.*Internal' || fail 'target identity changed'
printf '%s\n' "$TINFO" | grep -q 'Part of Whole:.*disk0' || fail 'target parent changed'
ROOTDEV=$(df / | awk 'NR==2 {print $1}')
case "$ROOTDEV" in /dev/disk0s3|/dev/rdisk0s3) fail 'refusing to erase current root source';; esac

diskutil mount "$TARGET" >/dev/null 2>&1 || true
MOUNT=$(diskutil info "$TARGET" | awk -F: '/Mount Point/ {sub(/^[ \t]+/,"",$2); print $2; exit}')
[ -n "$MOUNT" ] && [ "$MOUNT" != 'Not mounted' ] && [ -d "$MOUNT" ] || fail 'target is not mounted'
say "BUILD: createinstallmedia will erase ONLY $TARGET mounted at $MOUNT"
"$CIM" --volume "$MOUNT" --nointeraction || fail 'createinstallmedia failed'

NEWMOUNT=$(diskutil info "$TARGET" | awk -F: '/Mount Point/ {sub(/^[ \t]+/,"",$2); print $2; exit}')
[ -n "$NEWMOUNT" ] && [ "$NEWMOUNT" != 'Not mounted' ] || fail 'rebuilt installer is not mounted'
bless --info "$NEWMOUNT" || fail 'bless does not recognize rebuilt installer'
say 'BUILD_OK: fresh internal Install macOS Sequoia created on disk0s3.'
say 'NEXT: shut down, hold Option at power-on, choose Install macOS Sequoia, install to Apple (~930 GB).'
