#!/bin/bash
# Sequoia Recovery auto-builder for A2141 layout used in this recovery session.
# Fresh-downloads Apple's Sequoia 15.8 InstallAssistant, validates it by fully
# extracting the XAR (which checks archived checksums), extracts the installer app,
# and rebuilds ONLY /dev/disk0s3 as the internal bootable installer.
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

for c in curl diskutil stat awk grep find mkdir rm mv date df caffeinate; do need "$c"; done
[ -x /usr/bin/xar ] || fail 'xar not found'
[ -x /usr/bin/tar ] || fail 'tar not found'
[ -x /usr/bin/ditto ] || fail 'ditto not found'
[ -x /usr/bin/hdiutil ] || fail 'hdiutil not found'
[ -d /Volumes/Apple ] || fail '/Volumes/Apple is not mounted'

caffeinate -di -w $$ >/tmp/sequoia-auto-caffeinate.log 2>&1 &
CAFF=$!
trap 'kill "$CAFF" 2>/dev/null || true' EXIT INT TERM

# Safety: Apple must be internal APFS.
INFO=$(diskutil info /Volumes/Apple) || fail 'cannot inspect /Volumes/Apple'
printf '%s\n' "$INFO" | grep -q 'Device Location:.*Internal' || fail '/Volumes/Apple is not internal'
printf '%s\n' "$INFO" | grep -q 'File System Personality:.*APFS' || fail '/Volumes/Apple is not APFS'
FREE=$(df -k /Volumes/Apple | awk 'NR==2 {print $4}')
[ -n "$FREE" ] || fail 'cannot determine free space on Apple'
[ "$FREE" -gt 62914560 ] || fail 'need at least 60 GiB free on Apple for download/extraction/staging'

# Safety: exact dedicated target only; internal HFS+ partition on disk0, around 70 GB.
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

# Quarantine the known-bad completed package. Never resume from it.
if [ -f "$PKG" ]; then
  STAMP=$(date +%Y%m%d-%H%M%S 2>/dev/null || echo old)
  BAD="$BASE/InstallAssistant.pkg.bad-$STAMP"
  say "Quarantining previous package -> $BAD"
  mv "$PKG" "$BAD" || fail 'cannot quarantine old package'
fi
rm -f "$PART"
rm -rf "$XARWORK" "$STAGE"

# Fresh download. Network interruptions resume only within this new attempt.
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
mv "$PART" "$PKG" || fail 'cannot finalize new package'
say "DOWNLOAD_OK size=$(size "$PKG")"

# Full XAR extraction is our integrity gate. It previously detected the bad SharedSupport.dmg.
mkdir -p "$XARWORK" || fail 'cannot create XAR work directory'
say 'VERIFY: fully extracting XAR and checking archived checksums...'
/usr/bin/xar -xf "$PKG" -C "$XARWORK" || fail 'fresh package failed XAR checksum verification; do NOT build installer'
say 'XAR_VERIFY_OK'

PAYLOAD=$(/usr/bin/find "$XARWORK" -type f -name Payload -print | head -n 1)
[ -n "$PAYLOAD" ] || fail 'Payload not found after XAR extraction'
say "PAYLOAD=$PAYLOAD"

# Extract app to a staging directory on the large Apple volume.
mkdir -p "$STAGE" || fail 'cannot create app staging directory'
say 'Extracting installer application from Payload...'
/usr/bin/tar -xf "$PAYLOAD" -C "$STAGE" || fail 'Payload extraction failed'
FOUND=$(/usr/bin/find "$STAGE" -type d -name 'Install macOS Sequoia.app' -print | head -n 1)
[ -n "$FOUND" ] && [ -d "$FOUND" ] || fail 'Install macOS Sequoia.app not found in Payload'
CIM="$FOUND/Contents/Resources/createinstallmedia"
[ -x "$CIM" ] || fail 'createinstallmedia is missing from extracted app'
say "APP_EXTRACT_OK=$FOUND"

# Optional Apple code-signature check if codesign exists in this Recovery.
if [ -x /usr/bin/codesign ]; then
  /usr/bin/codesign -v -R='anchor apple' "$CIM" || fail 'createinstallmedia Apple code signature check failed'
  say 'CODESIGN_OK'
fi

# Copy the verified app to a stable location on Apple.
rm -rf "$FINALAPP"
/usr/bin/ditto "$FOUND" "$FINALAPP" || fail 'cannot copy installer app to /Volumes/Apple/Applications'
CIM="$FINALAPP/Contents/Resources/createinstallmedia"
[ -x "$CIM" ] || fail 'copied createinstallmedia is missing'
say "APP_READY=$FINALAPP"

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

# Verify rebuilt internal installer.
NEWMOUNT=$(diskutil info "$TARGET" | awk -F: '/Mount Point/ {sub(/^[ \t]+/,"",$2); print $2; exit}')
[ -n "$NEWMOUNT" ] && [ "$NEWMOUNT" != 'Not mounted' ] || fail 'rebuilt installer is not mounted'
bless --info "$NEWMOUNT" || fail 'bless does not recognize rebuilt installer'
say 'BUILD_OK: fresh internal Install macOS Sequoia created on disk0s3.'
say 'NEXT: shut down, hold Option at power-on, choose Install macOS Sequoia, install to Apple (~930 GB).'
