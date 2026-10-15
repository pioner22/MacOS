#!/bin/bash
# Robust fixed-range downloader for the known Tahoe 26.6.2 InstallAssistant.pkg.
# Intended for unstable Recovery networking. Each range is accepted only when
# curl exits successfully AND the exact byte count matches; failed ranges are
# discarded and retried from the beginning. After assembly the full XAR is
# extracted to verify Apple's archived checksums. Only then is the package
# handed to the existing Tahoe media builder.
set -u

URL='https://swcdn.apple.com/content/downloads/37/33/140-93587-A_GRFFH93NOL/f944yaqo1cjhh2m0kxrl0zhcpg9yb9qphv/InstallAssistant.pkg'
EXPECTED=18384624402
CHUNK=134217728
BASE='/Volumes/Apple/Tahoe-26.6.2-25G83'
OUT="$BASE/InstallAssistant.pkg"
PART="$BASE/InstallAssistant.pkg.part"
FRESH="$BASE/InstallAssistant.pkg.chunked"
CHUNKDIR="$BASE/chunks"
VERIFY="$BASE/xar-chunk-verify"
NEXT='https://raw.githubusercontent.com/pioner22/MacOS/main/thm.sh'

say(){ printf '%s\n' "$*"; }
fail(){ printf 'STOP: %s\n' "$*" >&2; exit 1; }
need(){ command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"; }
size(){ stat -f '%z' "$1" 2>/dev/null || printf '0\n'; }

for c in curl stat mkdir rm mv cat sleep; do need "$c"; done
[ -x /usr/bin/xar ] || fail 'xar not found'
[ -d /Volumes/Apple ] || fail '/Volumes/Apple is not mounted'
mkdir -p "$BASE" "$CHUNKDIR" || fail 'cannot create Tahoe download directories'

if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -di -w $$ >/tmp/tahoe-chunk-caffeinate.log 2>&1 &
  CAFF=$!
  trap 'kill "$CAFF" 2>/dev/null || true' EXIT INT TERM
fi

verify_xar(){
  F=$1
  rm -rf "$VERIFY"
  mkdir -p "$VERIFY" || return 1
  say "VERIFY_XAR=$F"
  /usr/bin/xar -xf "$F" -C "$VERIFY" >/tmp/tahoe-chunk-xar.log 2>&1
  RC=$?
  rm -rf "$VERIFY"
  if [ "$RC" -eq 0 ]; then
    say 'XAR_VERIFY_OK'
    return 0
  fi
  say 'XAR_VERIFY_FAILED'
  tail -n 8 /tmp/tahoe-chunk-xar.log 2>/dev/null || true
  return 1
}

# Reuse a package only when Apple's internal XAR checksums all pass.
if [ -f "$OUT" ]; then
  say "EXISTING_PACKAGE bytes=$(size "$OUT")"
  if [ "$(size "$OUT")" = "$EXPECTED" ] && verify_xar "$OUT"; then
    say 'PACKAGE_ALREADY_GOOD'
    curl -fL -H 'Cache-Control: no-cache' "$NEXT" | /bin/bash
    exit $?
  fi
  say "REMOVING_INVALID_PACKAGE=$OUT"
  rm -f "$OUT" || fail 'cannot remove invalid InstallAssistant.pkg'
fi

# The old resume-built .part already failed XAR verification. It must never be
# used as a source for the chunked download, so remove it now to reclaim space.
if [ -f "$PART" ]; then
  say "REMOVING_KNOWN_BAD_RESUME=$PART bytes=$(size "$PART")"
  rm -f "$PART" || fail 'cannot remove known-bad resume package'
fi
# Files named .bad are created only after this helper has already classified
# them as invalid, so they are safe to discard as well.
if [ -f "$OUT.bad" ]; then
  say "REMOVING_KNOWN_BAD_PACKAGE=$OUT.bad bytes=$(size "$OUT.bad")"
  rm -f "$OUT.bad" || true
fi
# A previous unverified assembled file is disposable; verified OUT is handled above.
rm -f "$FRESH"

INDEX=0
START=0
while [ "$START" -lt "$EXPECTED" ]; do
  END=$((START + CHUNK - 1))
  [ "$END" -lt "$EXPECTED" ] || END=$((EXPECTED - 1))
  WANT=$((END - START + 1))
  NAME=$(printf 'chunk-%04d' "$INDEX")
  FILE="$CHUNKDIR/$NAME"
  TMP="$FILE.part"

  if [ -f "$FILE" ] && [ "$(size "$FILE")" = "$WANT" ]; then
    say "CHUNK_OK index=$INDEX range=$START-$END bytes=$WANT cached=yes"
  else
    rm -f "$FILE" "$TMP"
    ATT=1
    while [ "$ATT" -le 30 ]; do
      say "CHUNK_DOWNLOAD index=$INDEX attempt=$ATT range=$START-$END bytes=$WANT"
      curl -fL --http1.1 --tlsv1.2 -r "$START-$END" \
        -H 'Cache-Control: no-cache' \
        --connect-timeout 20 --speed-time 180 --speed-limit 1024 \
        -o "$TMP" "$URL"
      RC=$?
      GOT=$(size "$TMP")
      say "CHUNK_RESULT index=$INDEX curl_exit=$RC bytes=$GOT"
      if [ "$RC" -eq 0 ] && [ "$GOT" = "$WANT" ]; then
        mv "$TMP" "$FILE" || fail "cannot finalize chunk $INDEX"
        break
      fi
      rm -f "$TMP"
      ATT=$((ATT+1))
      [ "$ATT" -le 30 ] || fail "chunk $INDEX could not be downloaded intact"
      sleep 3
    done
  fi

  INDEX=$((INDEX+1))
  START=$((END+1))
done

say "ALL_CHUNKS_READY count=$INDEX"
rm -f "$FRESH"
I=0
while [ "$I" -lt "$INDEX" ]; do
  NAME=$(printf 'chunk-%04d' "$I")
  cat "$CHUNKDIR/$NAME" >> "$FRESH" || fail "cannot assemble chunk $I"
  I=$((I+1))
done

[ "$(size "$FRESH")" = "$EXPECTED" ] || fail "assembled size mismatch: $(size "$FRESH") expected $EXPECTED"
say "ASSEMBLED_OK bytes=$EXPECTED"
verify_xar "$FRESH" || fail 'fresh chunked package still failed XAR verification; chunks preserved for diagnosis'

mv "$FRESH" "$OUT" || fail 'cannot finalize verified InstallAssistant.pkg'
rm -rf "$CHUNKDIR"
say "FRESH_PACKAGE_READY=$OUT"
say 'Launching Tahoe media builder with the verified package...'
curl -fL -H 'Cache-Control: no-cache' "$NEXT" | /bin/bash
