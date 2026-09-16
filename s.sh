#!/bin/bash
# Non-destructive Recovery helper for Sequoia InstallAssistant.pkg.
set -u
PKG='/Volumes/Apple/Sequoia-15.8-24H23/InstallAssistant.pkg'
WORK='/Volumes/Apple/Sequoia-15.8-24H23/xar'
EXPECTED='15664077639'
fail(){ echo "STOP: $*" >&2; exit 1; }
[ -f "$PKG" ] || fail 'InstallAssistant.pkg not found'
[ -x /usr/bin/xar ] || fail 'xar not found'
[ -x /usr/bin/tar ] || fail 'tar not found'
[ -x /usr/bin/find ] || fail 'find not found'
SIZE=$(stat -f '%z' "$PKG" 2>/dev/null || echo 0)
echo "PKG_SIZE=$SIZE expected=$EXPECTED"
[ "$SIZE" = "$EXPECTED" ] || fail 'unexpected package size'
caffeinate -di -w $$ >/tmp/s-caffeinate.log 2>&1 &
C=$!
trap 'kill "$C" 2>/dev/null || true' EXIT INT TERM
rm -rf "$WORK" || fail 'cannot remove old work directory'
mkdir -p "$WORK" || fail 'cannot create work directory'
echo 'Extracting PKG with xar...'
/usr/bin/xar -xf "$PKG" -C "$WORK" || fail 'xar extraction failed'
PAYLOAD=$(/usr/bin/find "$WORK" -type f -name Payload -print | head -n 1)
[ -n "$PAYLOAD" ] || fail 'Payload not found'
echo "PAYLOAD=$PAYLOAD"
echo 'Checking Payload...'
if /usr/bin/tar -tf "$PAYLOAD" 2>/dev/null | grep -F 'Install macOS Sequoia.app/Contents/Resources/createinstallmedia' >/dev/null; then
  echo 'INSPECT_OK: createinstallmedia found'
else
  echo 'STOP: Payload is readable, but createinstallmedia was not found'
  exit 2
fi
