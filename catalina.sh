#!/bin/bash
# Build an official macOS Catalina 10.15.7 (19H15) bootable installer on /dev/disk0s3.
# Downloads Apple Software Update assets with resume support, builds the full
# Install macOS Catalina.app using the same legacy layout used by gibMacOS,
# then runs Apple's createinstallmedia. ONLY /dev/disk0s3 is erased.
# /Volumes/Apple and disk0s2 are never erased.
set -u

PREFIX='https://swcdn.apple.com/content/downloads/26/37/001-68446/r1dbqtmf3mtpikjnd04cq31p4jk91dceh8'
BASE='/Volumes/Apple/Catalina-10.15.7-19H15'
APP="$BASE/Install macOS Catalina.app"
TARGET='/dev/disk0s3'
MNT='/tmp/CatalinaBaseSystem'

say(){ printf '%s\n' "$*"; }
fail(){ printf 'STOP: %s\n' "$*" >&2; exit 1; }
need(){ command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"; }
size(){ stat -f '%z' "$1" 2>/dev/null || printf '0\n'; }

for c in curl diskutil stat awk grep mkdir rm mv sleep df; do need "$c"; done
[ -x /usr/bin/hdiutil ] || fail 'hdiutil not found'
[ -x /usr/bin/xar ] || fail 'xar not found'
[ -x /usr/bin/ditto ] || fail 'ditto not found'
[ -x /usr/bin/python ] || fail 'python not found; needed to patch InstallInfo.plist safely'
[ -d /Volumes/Apple ] || fail '/Volumes/Apple is not mounted'

VER=$(sw_vers -productVersion 2>/dev/null || printf unknown)
say "RECOVERY_VERSION=$VER"
say 'MODE=CATALINA_10.15.7_BOOT_INSTALLER_BUILDER'
say 'SOURCE=Apple Software Update product 001-68446 (10.15.7, build 19H15)'

if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -di -w $$ >/tmp/catalina-builder-caffeinate.log 2>&1 &
  CAFF=$!
  trap 'kill "$CAFF" 2>/dev/null || true; /usr/bin/hdiutil detach "$MNT" >/dev/null 2>&1 || true' EXIT INT TERM
else
  trap '/usr/bin/hdiutil detach "$MNT" >/dev/null 2>&1 || true' EXIT INT TERM
fi

AINFO=$(diskutil info /Volumes/Apple) || fail 'cannot inspect /Volumes/Apple'
printf '%s\n' "$AINFO" | grep -q 'Device Location:.*Internal' || fail '/Volumes/Apple is not internal'
printf '%s\n' "$AINFO" | grep -q 'File System Personality:.*APFS' || fail '/Volumes/Apple is not APFS'
FREE=$(df -k /Volumes/Apple | awk 'NR==2 {print $4}')
[ -n "$FREE" ] || fail 'cannot determine free space on Apple'
[ "$FREE" -gt 31457280 ] || fail 'need at least 30 GiB free on /Volumes/Apple'

TINFO=$(diskutil info "$TARGET") || fail "$TARGET not found"
printf '%s\n' "$TINFO" | grep -q 'Device Location:.*Internal' || fail "$TARGET is not internal"
printf '%s\n' "$TINFO" | grep -q 'Part of Whole:.*disk0' || fail "$TARGET is not part of disk0"
printf '%s\n' "$TINFO" | grep -Eq 'File System Personality:.*(Journaled HFS\+|Mac OS Extended)' || fail "$TARGET is not HFS+"
TBYTES=$(printf '%s\n' "$TINFO" | awk -F'[()]' '/Disk Size:/ {x=$2; gsub(/[^0-9]/,"",x); print x; exit}')
[ -n "$TBYTES" ] || fail 'cannot read target size'
[ "$TBYTES" -gt 60000000000 ] && [ "$TBYTES" -lt 80000000000 ] || fail "unexpected target size: $TBYTES bytes"
ROOTDEV=$(df / | awk 'NR==2 {print $1}')
case "$ROOTDEV" in /dev/disk0s3|/dev/rdisk0s3) fail 'current Recovery is running from disk0s3; boot Internet Recovery first';; esac
say "TARGET_OK=$TARGET bytes=$TBYTES root=$ROOTDEV"

if [ -d '/Volumes/Apple/Applications/Install macOS Sequoia.app' ] || [ -f '/Volumes/Apple/Sequoia-15.8-24H23/InstallAssistant.pkg' ]; then
  say 'SEQUOIA_SOURCE_PRESERVED_ON_APPLE=YES'
else
  say 'WARNING: no saved Sequoia app/pkg found on /Volumes/Apple. Rebuilding Sequoia later may require downloading it again.'
fi

mkdir -p "$BASE" || fail 'cannot create Catalina work directory'

verify_pkg(){
  F=$1
  W="$BASE/.xar-verify"
  rm -rf "$W"; mkdir -p "$W" || return 1
  say "VERIFY_XAR=$F"
  /usr/bin/xar -xf "$F" -C "$W" >/tmp/catalina-builder-xar.log 2>&1
  RC=$?
  rm -rf "$W"
  if [ "$RC" -eq 0 ]; then say 'XAR_VERIFY_OK'; return 0; fi
  say 'XAR_VERIFY_FAILED'
  tail -n 8 /tmp/catalina-builder-xar.log 2>/dev/null || true
  return 1
}

verify_dmg(){
  F=$1
  say "VERIFY_DMG=$F"
  /usr/bin/hdiutil verify "$F" >/tmp/catalina-builder-dmg.log 2>&1 && { say 'DMG_VERIFY_OK'; return 0; }
  /usr/bin/hdiutil imageinfo "$F" >/dev/null 2>&1 && { say 'DMG_PARSE_OK'; return 0; }
  say 'DMG_VERIFY_FAILED'
  tail -n 8 /tmp/catalina-builder-dmg.log 2>/dev/null || true
  return 1
}

verify_small(){
  F=$1
  [ "$(size "$F")" -gt 0 ] || return 1
  case "$F" in
    *.plist)
      if [ -x /usr/bin/plutil ]; then /usr/bin/plutil -lint "$F" >/dev/null 2>&1 || return 1; fi
      ;;
  esac
  return 0
}

verify_asset(){
  F=$1; N=$2
  case "$N" in
    InstallESDDmg.pkg) verify_pkg "$F"; return $?;;
    *.dmg) verify_dmg "$F"; return $?;;
    *.plist|*.chunklist) verify_small "$F"; return $?;;
  esac
  return 1
}

download_asset(){
  N=$1
  URL="$PREFIX/$N"
  OUT="$BASE/$N"
  PART="$OUT.part"

  if [ -f "$OUT" ]; then
    say "EXISTING_ASSET=$OUT bytes=$(size "$OUT")"
    if verify_asset "$OUT" "$N"; then
      say "ASSET_OK=$N"
      return 0
    fi
    mv "$OUT" "$OUT.bad" 2>/dev/null || fail "cannot quarantine invalid $N"
  fi

  ATT=1
  while [ "$ATT" -le 40 ]; do
    HAVE=$(size "$PART")
    say "DOWNLOAD_ATTEMPT=$ATT asset=$N existing_bytes=$HAVE"
    if [ "$HAVE" -gt 0 ]; then
      curl -fL -C - -H 'Cache-Control: no-cache' --connect-timeout 20 --speed-time 180 --speed-limit 1024 -o "$PART" "$URL"
    else
      curl -fL -H 'Cache-Control: no-cache' --connect-timeout 20 --speed-time 180 --speed-limit 1024 -o "$PART" "$URL"
    fi
    RC=$?
    say "CURL_EXIT=$RC asset=$N bytes=$(size "$PART")"
    if [ "$RC" -eq 0 ]; then break; fi
    ATT=$((ATT+1))
    [ "$ATT" -le 40 ] || fail "download incomplete for $N; partial preserved at $PART"
    sleep 5
  done

  verify_asset "$PART" "$N" || fail "downloaded $N failed verification; partial preserved"
  mv "$PART" "$OUT" || fail "cannot finalize $N"
  say "ASSET_OK=$N bytes=$(size "$OUT")"
}

for N in BaseSystem.dmg BaseSystem.chunklist InstallESDDmg.pkg InstallInfo.plist AppleDiagnostics.dmg AppleDiagnostics.chunklist; do
  download_asset "$N"
done
say 'ALL_CATALINA_ASSETS_VERIFIED'

rm -rf "$MNT"
mkdir -p "$MNT" || fail 'cannot create BaseSystem mount point'
/usr/bin/hdiutil attach "$BASE/BaseSystem.dmg" -nobrowse -readonly -mountpoint "$MNT" >/tmp/catalina-builder-attach.log 2>&1 || {
  tail -n 20 /tmp/catalina-builder-attach.log 2>/dev/null || true
  fail 'cannot mount BaseSystem.dmg'
}

FOUND=''
for A in "$MNT"/*.app; do
  [ -d "$A" ] || continue
  FOUND=$A
  break
done
[ -n "$FOUND" ] || fail 'installer app not found at BaseSystem root'
say "BASESYSTEM_APP=$FOUND"

rm -rf "$APP"
/usr/bin/ditto "$FOUND" "$APP" || fail 'cannot copy Catalina installer app from BaseSystem'
/usr/bin/hdiutil detach "$MNT" >/dev/null 2>&1 || /usr/bin/hdiutil detach "$MNT" -force >/dev/null 2>&1 || fail 'cannot detach BaseSystem'

SS="$APP/Contents/SharedSupport"
mkdir -p "$SS" || fail 'cannot create SharedSupport'

clone_or_copy(){
  SRC=$1; DST=$2
  rm -f "$DST"
  if /bin/cp -c "$SRC" "$DST" 2>/dev/null; then return 0; fi
  /bin/cp "$SRC" "$DST"
}

clone_or_copy "$BASE/BaseSystem.dmg" "$SS/BaseSystem.dmg" || fail 'cannot copy BaseSystem.dmg'
clone_or_copy "$BASE/BaseSystem.chunklist" "$SS/BaseSystem.chunklist" || fail 'cannot copy BaseSystem.chunklist'
clone_or_copy "$BASE/AppleDiagnostics.dmg" "$SS/AppleDiagnostics.dmg" || fail 'cannot copy AppleDiagnostics.dmg'
clone_or_copy "$BASE/AppleDiagnostics.chunklist" "$SS/AppleDiagnostics.chunklist" || fail 'cannot copy AppleDiagnostics.chunklist'
clone_or_copy "$BASE/InstallESDDmg.pkg" "$SS/InstallESD.dmg" || fail 'cannot create InstallESD.dmg from InstallESDDmg.pkg'
clone_or_copy "$BASE/InstallInfo.plist" "$SS/InstallInfo.plist" || fail 'cannot copy InstallInfo.plist'

/usr/bin/python - "$SS/InstallInfo.plist" <<'PY'
from __future__ import print_function
import sys, plistlib
p = sys.argv[1]
try:
    with open(p, 'rb') as f:
        d = plistlib.load(f)
except AttributeError:
    d = plistlib.readPlist(p)
pii = d.get('Payload Image Info', {})
if 'URL' in pii:
    pii['URL'] = pii['URL'].replace('InstallESDDmg.pkg', 'InstallESD.dmg')
if 'id' in pii:
    pii['id'] = pii['id'].replace('com.apple.pkg.InstallESDDmg', 'com.apple.dmg.InstallESD')
pii.pop('chunklistURL', None)
pii.pop('chunklistid', None)
try:
    with open(p, 'wb') as f:
        plistlib.dump(d, f)
except AttributeError:
    plistlib.writePlist(d, p)
PY
[ "$?" -eq 0 ] || fail 'failed to patch InstallInfo.plist'
if [ -x /usr/bin/plutil ]; then /usr/bin/plutil -lint "$SS/InstallInfo.plist" >/dev/null 2>&1 || fail 'patched InstallInfo.plist is invalid'; fi

CIM="$APP/Contents/Resources/createinstallmedia"
[ -x "$CIM" ] || fail 'createinstallmedia not found in Catalina app'
say "CATALINA_APP_READY=$APP"

if [ -x /usr/bin/codesign ]; then
  /usr/bin/codesign -v "$CIM" >/dev/null 2>&1 || fail 'createinstallmedia code signature check failed'
  say 'CREATEINSTALLMEDIA_CODESIGN_OK'
fi

TINFO=$(diskutil info "$TARGET") || fail "$TARGET disappeared before build"
printf '%s\n' "$TINFO" | grep -q 'Device Location:.*Internal' || fail 'target identity changed'
printf '%s\n' "$TINFO" | grep -q 'Part of Whole:.*disk0' || fail 'target parent changed'
ROOTDEV=$(df / | awk 'NR==2 {print $1}')
case "$ROOTDEV" in /dev/disk0s3|/dev/rdisk0s3) fail 'refusing to erase current root source';; esac

diskutil mount "$TARGET" >/dev/null 2>&1 || true
TMOUNT=$(diskutil info "$TARGET" | awk -F: '/Mount Point/ {sub(/^[ \t]+/,"",$2); print $2; exit}')
[ -n "$TMOUNT" ] && [ "$TMOUNT" != 'Not mounted' ] && [ -d "$TMOUNT" ] || fail 'disk0s3 is not mounted'

say 'ABOUT_TO_ERASE_ONLY=/dev/disk0s3'
say 'NOTE: this replaces the current Sequoia boot installer on disk0s3 with Catalina. Sequoia source files on /Volumes/Apple are not touched.'
say "CREATEINSTALLMEDIA_TARGET=$TMOUNT"
"$CIM" --volume "$TMOUNT" --nointeraction || fail 'Catalina createinstallmedia failed'

NEWMOUNT=$(diskutil info "$TARGET" | awk -F: '/Mount Point/ {sub(/^[ \t]+/,"",$2); print $2; exit}')
[ -n "$NEWMOUNT" ] && [ "$NEWMOUNT" != 'Not mounted' ] || fail 'Catalina installer is not mounted after build'
if command -v bless >/dev/null 2>&1; then bless --info "$NEWMOUNT" || fail 'bless does not recognize Catalina installer'; fi
say "BUILD_OK: Catalina 10.15.7 boot installer created on $TARGET at $NEWMOUNT"
say 'NEXT: shut down, hold Option, choose Install macOS Catalina, install to CatalinaTemp. After first boot create an admin, then use Command-R -> Startup Security Utility -> Medium Security.'
