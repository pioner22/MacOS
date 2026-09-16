#!/bin/bash
# A2141 Recovery download rescuer.
# Default mode is NON-DESTRUCTIVE: it never repartitions or erases a disk.
# It looks for stalled Apple installer/update archive downloads, resumes them,
# verifies completed archives, and finalizes only when the exact cache target
# can be determined. Bash 3.2 compatible for old macOS Recovery environments.
set -u

SAFE_ROOT='/Volumes/Apple/Recovery-Downloads'
URL_CACHE="$SAFE_ROOT/url-cache"
SEQUOIA_FALLBACK='https://raw.githubusercontent.com/pioner22/MacOS/db695a426f3893464682eaa90d99cef811305372/s.sh'

say(){ printf '%s\n' "$*"; }
fail(){ printf 'STOP: %s\n' "$*" >&2; exit 1; }
size(){ stat -f '%z' "$1" 2>/dev/null || printf '0\n'; }
need(){ command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"; }

# Keep the mandatory tool list minimal: old Catalina Recovery lacks some
# ordinary userland helpers such as basename/dirname. Bash parameter expansion
# is used instead of those helpers.
for c in curl stat grep awk sed date mkdir rm mv sleep find tail; do need "$c"; done

RECOVERY_VER='unknown'
if command -v sw_vers >/dev/null 2>&1; then
  RECOVERY_VER=$(sw_vers -productVersion 2>/dev/null || printf unknown)
fi
say "RECOVERY_VERSION=$RECOVERY_VER"

if [ -d /Volumes/Apple ]; then
  mkdir -p "$SAFE_ROOT" "$URL_CACHE" 2>/dev/null || true
fi

# Keep Recovery awake while downloading/verifying.
if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -di -w $$ >/tmp/a2141-helper-caffeinate.log 2>&1 &
  CAFF=$!
  trap 'kill "$CAFF" 2>/dev/null || true' EXIT INT TERM
fi

# Explicit opt-in only. Default invocation must never rebuild/erase disk0s3.
if [ "${SEQUOIA_BUILD:-0}" = 1 ]; then
  say 'SEQUOIA_BUILD=1: launching pinned known-good Sequoia builder.'
  curl -qfLo /tmp/sequoia-builder.sh "$SEQUOIA_FALLBACK" || fail 'cannot download pinned Sequoia builder'
  exec /bin/bash /tmp/sequoia-builder.sh
fi

is_apple_url(){
  case "$1" in
    https://*.apple.com/*|https://apple.com/*|https://*.icloud.com/*) return 0;;
    *) return 1;;
  esac
}

clean_url(){
  # Trim common punctuation/escaping captured from installer logs.
  printf '%s' "$1" | sed 's/["'"'<>),;]*$//' | sed 's/\\u0026/\&/g'
}

url_filename(){
  local U P
  U=${1%%\?*}
  P=${U##*/}
  printf '%s\n' "$P"
}

cache_url(){
  local U B
  U=$1
  B=$(url_filename "$U")
  [ -n "$B" ] || return 0
  [ -d "$URL_CACHE" ] || return 0
  printf '%s\n' "$U" > "$URL_CACHE/$B.url" 2>/dev/null || true
}

# Print/store archive URLs exposed by Recovery/install/update logs.
scan_urls(){
  local L U B
  : > /tmp/a2141-archive-urls 2>/dev/null || true

  for L in /var/log/install.log /private/var/log/install.log /var/log/system.log /private/var/log/system.log /tmp/install.log /tmp/*.log; do
    [ -f "$L" ] || continue
    grep -aoE 'https?://[^[:space:]"<>]+' "$L" 2>/dev/null | while IFS= read -r U; do
      U=$(clean_url "$U")
      is_apple_url "$U" || continue
      B=$(url_filename "$U")
      case "$B" in
        *.pkg|*.dmg|*.ipsw|*.zip|*.chunklist|*.plist|*.gz)
          printf '%s\n' "$U"
          ;;
      esac
    done >> /tmp/a2141-archive-urls
  done

  # Installer data often contains its own logs/plists with the exact CDN URL.
  for L in /Volumes/*/'macOS Install Data'/* /Volumes/*/'macOS Install Data'/*/*; do
    [ -f "$L" ] || continue
    case "$L" in
      *.log|*.txt|*.plist|*.xml|*.json)
        grep -aoE 'https?://[^[:space:]"<>]+' "$L" 2>/dev/null | while IFS= read -r U; do
          U=$(clean_url "$U")
          is_apple_url "$U" || continue
          B=$(url_filename "$U")
          case "$B" in
            *.pkg|*.dmg|*.ipsw|*.zip|*.chunklist|*.plist|*.gz)
              printf '%s\n' "$U"
              ;;
          esac
        done >> /tmp/a2141-archive-urls
        ;;
    esac
  done

  if [ -s /tmp/a2141-archive-urls ]; then
    awk '!seen[$0]++' /tmp/a2141-archive-urls > /tmp/a2141-archive-urls.unique
    mv /tmp/a2141-archive-urls.unique /tmp/a2141-archive-urls
    while IFS= read -r U; do cache_url "$U"; done < /tmp/a2141-archive-urls
    say 'APPLE_ARCHIVE_URLS_FOUND:'
    tail -n 12 /tmp/a2141-archive-urls
  else
    say 'APPLE_ARCHIVE_URLS_FOUND=0'
  fi
}

find_url_for_name(){
  local NAME=$1 U B C
  FOUND_URL=''
  if [ -s /tmp/a2141-archive-urls ]; then
    while IFS= read -r U; do
      B=$(url_filename "$U")
      [ "$B" = "$NAME" ] && FOUND_URL=$U
    done < /tmp/a2141-archive-urls
  fi
  if [ -z "$FOUND_URL" ] && [ -f "$URL_CACHE/$NAME.url" ]; then
    IFS= read -r C < "$URL_CACHE/$NAME.url" || true
    FOUND_URL=$C
  fi
}

file_is_open(){
  local F=$1
  if command -v lsof >/dev/null 2>&1; then
    lsof "$F" 2>/dev/null | awk 'NR>1 {f=1} END{exit(f?0:1)}'
    return $?
  fi
  return 1
}

file_is_stable(){
  local F=$1 A B
  A=$(size "$F")
  sleep 6
  B=$(size "$F")
  [ "$A" = "$B" ]
}

verify_pkg(){
  local F=$1 W RC
  [ -x /usr/bin/xar ] || return 2
  if [ -d /Volumes/Apple ]; then W="$SAFE_ROOT/.verify-xar"; else W='/tmp/.verify-xar'; fi
  rm -rf "$W"; mkdir -p "$W" || return 2
  say "VERIFY_XAR=$F"
  /usr/bin/xar -xf "$F" -C "$W" >/tmp/a2141-xar.log 2>&1
  RC=$?
  rm -rf "$W"
  if [ "$RC" = 0 ]; then say 'XAR_VERIFY_OK'; return 0; fi
  say 'XAR_VERIFY_FAILED'; tail -n 6 /tmp/a2141-xar.log 2>/dev/null || true
  return 1
}

verify_dmg(){
  local F=$1
  [ -x /usr/bin/hdiutil ] || return 2
  say "VERIFY_DMG=$F"
  /usr/bin/hdiutil verify "$F" >/tmp/a2141-dmg.log 2>&1 && { say 'DMG_VERIFY_OK'; return 0; }
  /usr/bin/hdiutil imageinfo "$F" >/dev/null 2>&1 && { say 'DMG_PARSE_OK'; return 0; }
  say 'DMG_VERIFY_FAILED'; tail -n 6 /tmp/a2141-dmg.log 2>/dev/null || true
  return 1
}

verify_zip(){
  local F=$1
  if [ -x /usr/bin/unzip ]; then
    say "VERIFY_ZIP=$F"
    /usr/bin/unzip -tq "$F" >/tmp/a2141-zip.log 2>&1 && { say 'ZIP_VERIFY_OK'; return 0; }
    say 'ZIP_VERIFY_FAILED'; tail -n 6 /tmp/a2141-zip.log 2>/dev/null || true
    return 1
  fi
  return 2
}

verify_asset(){
  local F=$1 N
  N=$2
  case "$N" in
    *.pkg) verify_pkg "$F"; return $?;;
    *.dmg) verify_dmg "$F"; return $?;;
    *.ipsw|*.zip) verify_zip "$F"; return $?;;
    *) return 2;;
  esac
}

finalize_exact_partial(){
  local P=$1 FINAL=$2
  [ -f "$P" ] || return 1
  if [ -f "$FINAL" ]; then
    mv "$FINAL" "$FINAL.bad-$(date +%Y%m%d-%H%M%S 2>/dev/null || echo old)" || return 1
  fi
  mv "$P" "$FINAL" || return 1
  chmod 0644 "$FINAL" 2>/dev/null || true
  command -v sync >/dev/null 2>&1 && sync
  say "ASSET_READY=$FINAL"
  return 0
}

resume_one(){
  local P=$1 FINAL NAME URL RC ATT HAVE FRESH VRC

  [ -f "$P" ] || return 0
  case "$P" in
    *.partial) FINAL=${P%.partial};;
    *.part) FINAL=${P%.part};;
    *.download) FINAL=${P%.download};;
    *) return 0;;
  esac
  # basename is not present in some Catalina Recovery builds.
  NAME=${FINAL##*/}
  case "$NAME" in
    *.pkg|*.dmg|*.ipsw|*.zip) ;;
    *) return 0;;
  esac

  say "PARTIAL_FOUND=$P"
  if file_is_open "$P"; then
    say 'DOWNLOAD_ACTIVE=open-by-process; leaving it untouched.'
    return 0
  fi
  if ! file_is_stable "$P"; then
    say 'DOWNLOAD_ACTIVE=file-growing; leaving it untouched.'
    return 0
  fi
  HAVE=$(size "$P")
  say "PARTIAL_STALLED bytes=$HAVE"

  # A completed archive can remain with a .partial suffix after a crash.
  verify_asset "$P" "$NAME"
  VRC=$?
  if [ "$VRC" = 0 ]; then
    finalize_exact_partial "$P" "$FINAL" || fail "cannot finalize $P"
    return 0
  fi

  find_url_for_name "$NAME"
  URL=$FOUND_URL
  if [ -z "$URL" ]; then
    say "URL_NOT_FOUND_FOR=$NAME"
    return 0
  fi
  say "RESUME_URL=$URL"

  ATT=1
  while [ "$ATT" -le 30 ]; do
    HAVE=$(size "$P")
    say "RESUME_ATTEMPT=$ATT name=$NAME existing_bytes=$HAVE"
    curl -fL -C - -H 'Cache-Control: no-cache' --connect-timeout 20 --speed-time 180 --speed-limit 1024 -o "$P" "$URL"
    RC=$?
    HAVE=$(size "$P")
    say "CURL_EXIT=$RC bytes=$HAVE"
    [ "$RC" = 0 ] && break

    # Server may reject Range. Never destroy the existing partial; get a fresh
    # copy alongside it and replace only after successful archive verification.
    if [ "$RC" = 33 ]; then
      FRESH="$P.fresh"
      rm -f "$FRESH"
      say "RANGE_REJECTED: downloading fresh copy to $FRESH"
      curl -fL -H 'Cache-Control: no-cache' --connect-timeout 20 --speed-time 180 --speed-limit 1024 -o "$FRESH" "$URL"
      RC=$?
      say "FRESH_CURL_EXIT=$RC bytes=$(size "$FRESH")"
      if [ "$RC" = 0 ]; then
        verify_asset "$FRESH" "$NAME"
        VRC=$?
        if [ "$VRC" = 0 ]; then
          mv "$P" "$P.old-$(date +%Y%m%d-%H%M%S 2>/dev/null || echo old)" || true
          mv "$FRESH" "$P" || fail 'cannot install verified fresh download into cache'
          finalize_exact_partial "$P" "$FINAL" || fail 'cannot finalize verified fresh asset'
          return 0
        fi
      fi
      say 'FRESH_DOWNLOAD_NOT_VERIFIED: preserving original partial.'
      return 0
    fi

    ATT=$((ATT+1))
    [ "$ATT" -le 30 ] || { say 'RESUME_INCOMPLETE: partial preserved.'; return 0; }
    sleep 5
  done

  verify_asset "$P" "$NAME"
  VRC=$?
  if [ "$VRC" = 0 ]; then
    finalize_exact_partial "$P" "$FINAL" || fail 'cannot finalize verified asset'
  elif [ "$VRC" = 2 ]; then
    # Unknown verifier: curl completed, keep the cache file but don't rename it
    # blindly because firmware/personalization assets can be stateful.
    say "DOWNLOAD_COMPLETE_NO_VERIFIER=$P"
  else
    say "DOWNLOAD_FINISHED_BUT_VERIFY_FAILED=$P"
  fi
}

scan_partials(){
  : > /tmp/a2141-partials 2>/dev/null || true
  # Restrict scanning to installer/update caches; do not crawl user data/backup volumes.
  for D in /Volumes/*/'macOS Install Data' /Volumes/*/Library/Updates /Volumes/*/private/var/db/softwareupdate /Volumes/*/.TemporaryItems /tmp /var/tmp; do
    [ -d "$D" ] || continue
    find "$D" -type f \( -name '*.pkg.partial' -o -name '*.dmg.partial' -o -name '*.ipsw.partial' -o -name '*.zip.partial' -o -name '*.pkg.part' -o -name '*.dmg.part' -o -name '*.ipsw.part' -o -name '*.zip.part' -o -name '*.pkg.download' -o -name '*.dmg.download' -o -name '*.ipsw.download' -o -name '*.zip.download' \) -print 2>/dev/null >> /tmp/a2141-partials
  done
  if [ -s /tmp/a2141-partials ]; then
    awk '!seen[$0]++' /tmp/a2141-partials > /tmp/a2141-partials.unique
    mv /tmp/a2141-partials.unique /tmp/a2141-partials
  fi
}

show_t2_clues(){
  local L
  : > /tmp/a2141-t2-clues 2>/dev/null || true
  for L in /var/log/install.log /private/var/log/install.log /var/log/system.log /private/var/log/system.log /tmp/*.log; do
    [ -f "$L" ] || continue
    grep -aiE 'bridgeOS|iBridge|personaliz|integrity|secure.?boot|boot.?policy|firmware|BOSErrorDomain|MobileSoftwareUpdate' "$L" 2>/dev/null | tail -n 20 >> /tmp/a2141-t2-clues
  done
  if [ -s /tmp/a2141-t2-clues ]; then
    say 'T2_UPDATE_CLUES:'
    tail -n 25 /tmp/a2141-t2-clues
  fi
}

say 'MODE=SAFE_DOWNLOAD_RESCUE (no disk erase/repartition)'
scan_urls
scan_partials

if [ -s /tmp/a2141-partials ]; then
  while IFS= read -r P; do resume_one "$P"; done < /tmp/a2141-partials
else
  say 'PARTIAL_ARCHIVES_FOUND=0'
fi

# Keep Catalina-specific convenience: if an exact InstallESDDmg.pkg already
# exists, verify it even when there is no .partial file.
for F in /Volumes/*/'macOS Install Data'/InstallESDDmg.pkg; do
  [ -f "$F" ] || continue
  say "CATALINA_FINAL_FOUND=$F"
  verify_pkg "$F" || true
done

show_t2_clues

say 'SCAN_DONE'
say 'If PARTIAL_ARCHIVES_FOUND=0, trigger the failed Update/install once, let it fail, then run the same one-line command again.'
say 'If the T2 operation exposes only personalized integrity data and no archive URL/partial, it cannot be safely pre-seeded as a generic package; the T2 clues above will show that case.'
