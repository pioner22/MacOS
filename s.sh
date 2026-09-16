#!/bin/bash
# A2141 Recovery helper.
# 1) If a Catalina macOS Install Data cache is present, safely resumes/verifies
#    InstallESDDmg.pkg and leaves a completed verified package in that cache.
# 2) Otherwise, outside Catalina Recovery, falls back to the known-good Sequoia
#    internal-installer builder pinned to a prior commit.
# Bash 3.2 compatible. Never erases disk0/disk0s2 in Catalina-resume mode.
set -u

SEQUOIA_FALLBACK='https://raw.githubusercontent.com/pioner22/MacOS/db695a426f3893464682eaa90d99cef811305372/s.sh'
URL_CACHE='/Volumes/Apple/Catalina-InstallESDDmg.url'

say(){ printf '%s\n' "$*"; }
fail(){ printf 'STOP: %s\n' "$*" >&2; exit 1; }
size(){ stat -f '%z' "$1" 2>/dev/null || printf '0\n'; }
need(){ command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"; }

for c in curl stat grep awk date mkdir rm mv sleep; do need "$c"; done
[ -x /usr/bin/xar ] || fail 'xar not found'

# Keep Recovery awake while the helper works.
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -di -w $$ >/tmp/a2141-helper-caffeinate.log 2>&1 &
  CAFF=$!
  trap 'kill "$CAFF" 2>/dev/null || true' EXIT INT TERM
fi

RECOVERY_VER='unknown'
if command -v sw_vers >/dev/null 2>&1; then
  RECOVERY_VER=$(sw_vers -productVersion 2>/dev/null || printf unknown)
fi
say "RECOVERY_VERSION=$RECOVERY_VER"

CAT_DIR=''
CAT_PART=''
CAT_FINAL=''
for D in /Volumes/*/'macOS Install Data'; do
  [ -d "$D" ] || continue
  if [ -f "$D/InstallESDDmg.pkg.partial" ] || [ -f "$D/InstallESDDmg.pkg" ]; then
    CAT_DIR=$D
    [ -f "$D/InstallESDDmg.pkg.partial" ] && CAT_PART="$D/InstallESDDmg.pkg.partial"
    [ -f "$D/InstallESDDmg.pkg" ] && CAT_FINAL="$D/InstallESDDmg.pkg"
    break
  fi
done

# If Catalina has created macOS Install Data but neither package file exists yet,
# remember the directory only in Catalina Recovery. We do not create a competing
# download while Apple's installer may still be starting.
if [ -z "$CAT_DIR" ]; then
  case "$RECOVERY_VER" in
    10.15*)
      for D in /Volumes/*/'macOS Install Data'; do
        [ -d "$D" ] || continue
        CAT_DIR=$D
        break
      done
      ;;
  esac
fi

find_installesd_url(){
  FOUND_URL=''
  local L U F
  for L in /var/log/install.log /private/var/log/install.log; do
    [ -f "$L" ] || continue
    U=$(grep -aoE 'https?://[^[:space:]]*InstallESDDmg\.pkg' "$L" 2>/dev/null | tail -n 1)
    [ -n "$U" ] && FOUND_URL=$U
  done
  if [ -z "$FOUND_URL" ] && [ -n "$CAT_DIR" ]; then
    for F in "$CAT_DIR"/*.log "$CAT_DIR"/*.plist "$CAT_DIR"/*.xml "$CAT_DIR"/*.txt; do
      [ -f "$F" ] || continue
      U=$(grep -aoE 'https?://[^[:space:]]*InstallESDDmg\.pkg' "$F" 2>/dev/null | tail -n 1)
      [ -n "$U" ] && FOUND_URL=$U
    done
  fi
  if [ -z "$FOUND_URL" ] && [ -f "$URL_CACHE" ]; then
    IFS= read -r FOUND_URL < "$URL_CACHE" || true
  fi
  if [ -n "$FOUND_URL" ] && [ -d /Volumes/Apple ]; then
    printf '%s\n' "$FOUND_URL" > "$URL_CACHE" 2>/dev/null || true
  fi
}

file_is_open(){
  local F=$1
  if command -v lsof >/dev/null 2>&1; then
    lsof "$F" 2>/dev/null | awk 'NR>1 {found=1} END{exit(found?0:1)}'
    return $?
  fi
  return 1
}

verify_catalina_pkg(){
  local F=$1 VBASE RC
  [ -f "$F" ] || return 1
  if [ -d /Volumes/Apple ]; then
    VBASE='/Volumes/Apple/.Catalina-InstallESD-verify'
  else
    VBASE="$CAT_DIR/.InstallESD-verify"
  fi
  rm -rf "$VBASE"
  mkdir -p "$VBASE" || return 1
  say "VERIFY_XAR=$F"
  /usr/bin/xar -xf "$F" -C "$VBASE" >/tmp/catalina-xar.log 2>&1
  RC=$?
  rm -rf "$VBASE"
  if [ "$RC" = 0 ]; then
    say 'CATALINA_XAR_VERIFY_OK'
    return 0
  fi
  say 'CATALINA_XAR_VERIFY_FAILED'
  tail -n 8 /tmp/catalina-xar.log 2>/dev/null || true
  return 1
}

finalize_partial(){
  local STAMP
  [ -n "$CAT_PART" ] && [ -f "$CAT_PART" ] || fail 'partial package disappeared'
  if [ -f "$CAT_DIR/InstallESDDmg.pkg" ]; then
    STAMP=$(date +%Y%m%d-%H%M%S 2>/dev/null || echo old)
    mv "$CAT_DIR/InstallESDDmg.pkg" "$CAT_DIR/InstallESDDmg.pkg.bad-$STAMP" || fail 'cannot quarantine old final package'
  fi
  mv "$CAT_PART" "$CAT_DIR/InstallESDDmg.pkg" || fail 'cannot finalize InstallESDDmg.pkg'
  chmod 0644 "$CAT_DIR/InstallESDDmg.pkg" 2>/dev/null || true
  command -v sync >/dev/null 2>&1 && sync
  CAT_FINAL="$CAT_DIR/InstallESDDmg.pkg"
  CAT_PART=''
  say "CATALINA_PACKAGE_READY=$CAT_FINAL"
  say 'NEXT: restart the Catalina install; the verified package is now in macOS Install Data.'
}

resume_catalina(){
  local S1 S2 URL ATTEMPT RC HAVE STAMP
  say "CATALINA_CACHE=$CAT_DIR"

  # If a completed file already exists, do not redownload it when it verifies.
  if [ -n "$CAT_FINAL" ] && [ -f "$CAT_FINAL" ]; then
    if file_is_open "$CAT_FINAL"; then
      say 'CATALINA_INSTALLER_ACTIVE: final package is currently open; not touching it.'
      return 0
    fi
    if verify_catalina_pkg "$CAT_FINAL"; then
      say "CATALINA_PACKAGE_READY=$CAT_FINAL"
      return 0
    fi
    STAMP=$(date +%Y%m%d-%H%M%S 2>/dev/null || echo old)
    mv "$CAT_FINAL" "$CAT_FINAL.bad-$STAMP" || fail 'cannot quarantine invalid final package'
    CAT_FINAL=''
  fi

  [ -n "$CAT_PART" ] && [ -f "$CAT_PART" ] || {
    say 'CATALINA_CACHE_FOUND_BUT_NO_PARTIAL: nothing to resume yet.'
    say 'If the Apple installer fails, rerun the same one-line command; it will pick up the partial automatically.'
    return 0
  }

  # Never race Apple's downloader. If the file is open or still growing, leave it alone.
  if file_is_open "$CAT_PART"; then
    say 'CATALINA_DOWNLOAD_ACTIVE: partial is open by another process; not touching it.'
    return 0
  fi
  S1=$(size "$CAT_PART")
  sleep 8
  S2=$(size "$CAT_PART")
  say "CATALINA_PARTIAL_BYTES=$S2"
  if [ "$S1" != "$S2" ]; then
    say 'CATALINA_DOWNLOAD_ACTIVE: partial is still growing; not touching it.'
    return 0
  fi

  # It may already be complete but still carry the .partial suffix.
  if verify_catalina_pkg "$CAT_PART"; then
    finalize_partial
    return 0
  fi

  find_installesd_url
  URL=$FOUND_URL
  [ -n "$URL" ] || {
    say 'CATALINA_URL_NOT_FOUND: InstallESDDmg.pkg URL was not found in current logs/cache.'
    say 'Do not delete the partial; rerun after the installer logs another download attempt.'
    return 0
  }
  say "CATALINA_URL=$URL"

  ATTEMPT=1
  while [ "$ATTEMPT" -le 30 ]; do
    HAVE=$(size "$CAT_PART")
    say "CATALINA_RESUME_ATTEMPT=$ATTEMPT existing_bytes=$HAVE"
    curl -fL -C - --connect-timeout 20 --speed-time 180 --speed-limit 1024 -o "$CAT_PART" "$URL"
    RC=$?
    HAVE=$(size "$CAT_PART")
    say "CURL_EXIT=$RC bytes=$HAVE"
    if [ "$RC" = 0 ]; then
      break
    fi
    if [ "$RC" = 33 ]; then
      say 'CATALINA_RESUME_REJECTED: server rejected Range resume; preserving the partial unchanged.'
      return 0
    fi
    ATTEMPT=$((ATTEMPT+1))
    [ "$ATTEMPT" -le 30 ] || {
      say 'CATALINA_RESUME_INCOMPLETE: partial preserved for the next run.'
      return 0
    }
    sleep 5
  done

  if verify_catalina_pkg "$CAT_PART"; then
    finalize_partial
    return 0
  fi

  STAMP=$(date +%Y%m%d-%H%M%S 2>/dev/null || echo old)
  mv "$CAT_PART" "$CAT_PART.bad-$STAMP" || true
  CAT_PART=''
  say 'CATALINA_RESUMED_FILE_FAILED_VERIFY: bad resumed file quarantined.'
  say 'Rerun the same one-line command after Apple creates a new partial; no disk partition is changed.'
  return 0
}

# Catalina cache takes priority whenever one exists.
if [ -n "$CAT_DIR" ]; then
  resume_catalina
  exit 0
fi

# In Catalina Recovery, never fall through into the Sequoia disk-builder merely
# because no partial has appeared yet.
case "$RECOVERY_VER" in
  10.15*)
    say 'CATALINA_NO_INSTALL_DATA_FOUND: start/retry Catalina once, then rerun this same command if it fails.'
    exit 0
    ;;
esac

# No Catalina recovery work is pending: preserve the previous Sequoia-builder behavior.
say 'NO_CATALINA_CACHE: launching pinned Sequoia internal-installer builder.'
curl -qfLo /tmp/sequoia-builder.sh "$SEQUOIA_FALLBACK" || fail 'cannot download pinned Sequoia builder'
exec /bin/bash /tmp/sequoia-builder.sh
