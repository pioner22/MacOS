#!/bin/bash
# Recovery helper: inspect Sequoia InstallAssistant.pkg without pkgutil.
# Non-destructive: does not erase disk0s3 or modify disk partitioning.
set -u

PKG='/Volumes/Apple/Sequoia-15.8-24H23/InstallAssistant.pkg'
WORK='/Volumes/Apple/Sequoia-15.8-24H23/xar'
EXPECTED_SIZE='15664077639'

fail(){ echo "STOP: $*" >&2; exit 1; }
[ -f "$PKG" ] || fail "InstallAssistant.pkg not found"
[ -x /usr/bin/xar ] || fail "xar not found"
[ -x /usr/bin/tar ] || fail "tar not found"
[ -x /usr/bin/find ] || fail "find not found"

SIZE=$(stat -f '%z' "$PKG" 2>/dev/null || echo 0)
echo "PKG_SIZE=$SIZE expected=$EXPECTED_SIZE"
[ "$SIZE" = "$EXPECTED_SIZE" ] || fail "unexpected package size"

caffeinate -di -w $$ >/tmp/x-caffeinate.log 2>&1 &
CAFF=$!
trap 'kill "$CAFF" 2>/dev/null || true' EXIT INT TERM

rm -rf "$WORK" || fail "cannot remove old work directory"
mkdir -p "$WORK" || fail "cannot create work directory"

echo "Extracting flat PKG with xar..."
/usr/bin/xar -xf "$PKG" -C "$WORK" || fail "xar extraction failed"

PAYLOAD=$(/usr/bin/find "$WORK" -type f -name Payload -print | head -n 1)
[ -n "$PAYLOAD" ] || fail "Payload not found"
echo "PAYLOAD=$PAYLOAD"

echo "Checking Payload for createinstallmedia..."
if /usr/bin/tar -tf "$PAYLOAD" 2>/dev/null | grep -F 'Install macOS Sequoia.app/Contents/Resources/createinstallmedia' >/dev/null; then
  echo "PAYLOAD_OK: Install macOS Sequoia.app/createinstallmedia found"
else
  echo "PAYLOAD_LISTING_FAILED_OR_CREATEINSTALLMEDIA_NOT_FOUND"
  echo "Payload was extracted from the PKG, but its contents need separate inspection."
  exit 2
fi
