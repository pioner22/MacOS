#!/bin/bash
# GitHub -> internal SSD integrity diagnostic for macOS Recovery.
# Recovery-compatible: does not require cmp. Uses GitHub-published SHA-256 digests,
# repeated rereads, two independent downloads, and a real local byte-stream rewrite.
# NEVER repartitions/erases disks. Writes only under TESTDIR.
set -u

TESTDIR='/Volumes/Apple/GitHub-SSD-Test'

say(){ printf '%s\n' "$*"; }
fail(){ printf 'STOP: %s\n' "$*" >&2; exit 1; }
need(){ command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"; }
size(){ stat -f '%z' "$1" 2>/dev/null || printf '0\n'; }

for c in curl stat mkdir rm cat awk sleep; do need "$c"; done
[ -d /Volumes/Apple ] || fail '/Volumes/Apple is not mounted'
mkdir -p "$TESTDIR" || fail "cannot create $TESTDIR"

if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -di -w $$ >/tmp/ssdtest-caffeinate.log 2>&1 &
  CAFF=$!
  trap 'kill "$CAFF" 2>/dev/null || true' EXIT INT TERM
fi

SHA_TOOL=''
if command -v shasum >/dev/null 2>&1; then
  SHA_TOOL='shasum'
elif command -v sha256sum >/dev/null 2>&1; then
  SHA_TOOL='sha256sum'
elif command -v openssl >/dev/null 2>&1; then
  SHA_TOOL='openssl'
fi
[ -n "$SHA_TOOL" ] || fail 'no SHA-256 tool found (shasum/sha256sum/openssl)'

MD5_TOOL=''
if command -v md5 >/dev/null 2>&1; then MD5_TOOL='md5'; fi

sha256_file(){
  F=$1
  case "$SHA_TOOL" in
    shasum) shasum -a 256 "$F" 2>/dev/null | awk '{print $1}';;
    sha256sum) sha256sum "$F" 2>/dev/null | awk '{print $1}';;
    openssl) openssl dgst -sha256 "$F" 2>/dev/null | awk '{print $NF}';;
  esac
}

md5_file(){
  F=$1
  if [ "$MD5_TOOL" = 'md5' ]; then md5 -q "$F" 2>/dev/null; else printf '\n'; fi
}

TOTAL=0
PASS=0
FAILS=0
STRONG_STORAGE_FAIL=0
NETWORK_OR_PATH_FAIL=0
HASH_FAIL=0

run_asset(){
  NAME=$1
  EXPECTED=$2
  EXPECTED_SHA=$3
  URL=$4
  TOTAL=$((TOTAL+1))

  A="$TESTDIR/$NAME.A"
  B="$TESTDIR/$NAME.B"
  C="$TESTDIR/$NAME.local-rewrite"
  rm -f "$A" "$B" "$C"

  say '------------------------------------------------------------'
  say "TEST=$NAME expected_bytes=$EXPECTED"
  say "EXPECTED_SHA256=$EXPECTED_SHA"

  say 'DOWNLOAD_A=start'
  curl -fL --http1.1 -H 'Cache-Control: no-cache' --connect-timeout 20 -o "$A" "$URL"
  RCA=$?
  SA=$(size "$A")
  say "DOWNLOAD_A_EXIT=$RCA bytes=$SA"
  if [ "$RCA" -ne 0 ] || [ "$SA" != "$EXPECTED" ]; then
    say 'RESULT_DOWNLOAD_A=FAIL'
    FAILS=$((FAILS+1)); NETWORK_OR_PATH_FAIL=$((NETWORK_OR_PATH_FAIL+1))
    return
  fi
  command -v sync >/dev/null 2>&1 && sync

  A_SHA=$(sha256_file "$A")
  A_MD5=$(md5_file "$A")
  say "A_SHA256=$A_SHA"
  [ -n "$A_MD5" ] && say "A_MD5=$A_MD5"
  if [ "$A_SHA" = "$EXPECTED_SHA" ]; then
    say 'A_GITHUB_SHA256=PASS'
  else
    say 'A_GITHUB_SHA256=FAIL'
    HASH_FAIL=$((HASH_FAIL+1))
  fi

  sleep 2
  A_SHA_2=$(sha256_file "$A")
  sleep 2
  A_SHA_3=$(sha256_file "$A")
  say "A_SHA256_REREAD_2=$A_SHA_2"
  say "A_SHA256_REREAD_3=$A_SHA_3"
  if [ "$A_SHA" != "$A_SHA_2" ] || [ "$A_SHA" != "$A_SHA_3" ]; then
    say 'SAME_FILE_REREAD=FAIL'
    STRONG_STORAGE_FAIL=$((STRONG_STORAGE_FAIL+1)); FAILS=$((FAILS+1))
    return
  else
    say 'SAME_FILE_REREAD=PASS'
  fi

  say 'DOWNLOAD_B=start'
  curl -fL --http1.1 -H 'Cache-Control: no-cache' --connect-timeout 20 -o "$B" "$URL"
  RCB=$?
  SB=$(size "$B")
  say "DOWNLOAD_B_EXIT=$RCB bytes=$SB"
  if [ "$RCB" -ne 0 ] || [ "$SB" != "$EXPECTED" ]; then
    say 'RESULT_DOWNLOAD_B=FAIL'
    FAILS=$((FAILS+1)); NETWORK_OR_PATH_FAIL=$((NETWORK_OR_PATH_FAIL+1))
    return
  fi
  command -v sync >/dev/null 2>&1 && sync

  B_SHA=$(sha256_file "$B")
  B_MD5=$(md5_file "$B")
  say "B_SHA256=$B_SHA"
  [ -n "$B_MD5" ] && say "B_MD5=$B_MD5"
  if [ "$B_SHA" = "$EXPECTED_SHA" ]; then
    say 'B_GITHUB_SHA256=PASS'
  else
    say 'B_GITHUB_SHA256=FAIL'
    HASH_FAIL=$((HASH_FAIL+1))
  fi

  if [ "$A_SHA" = "$B_SHA" ]; then
    say 'INDEPENDENT_DOWNLOAD_HASH_COMPARE=PASS'
  else
    say 'INDEPENDENT_DOWNLOAD_HASH_COMPARE=FAIL'
    FAILS=$((FAILS+1)); NETWORK_OR_PATH_FAIL=$((NETWORK_OR_PATH_FAIL+1))
    return
  fi

  say 'LOCAL_REWRITE=start'
  cat "$A" > "$C" || {
    say 'LOCAL_REWRITE_WRITE=FAIL'
    STRONG_STORAGE_FAIL=$((STRONG_STORAGE_FAIL+1)); FAILS=$((FAILS+1))
    return
  }
  command -v sync >/dev/null 2>&1 && sync
  SC=$(size "$C")
  say "LOCAL_REWRITE_BYTES=$SC"
  if [ "$SC" != "$EXPECTED" ]; then
    say 'LOCAL_REWRITE_SIZE=FAIL'
    STRONG_STORAGE_FAIL=$((STRONG_STORAGE_FAIL+1)); FAILS=$((FAILS+1))
    return
  fi

  C_SHA=$(sha256_file "$C")
  C_MD5=$(md5_file "$C")
  say "LOCAL_REWRITE_SHA256=$C_SHA"
  [ -n "$C_MD5" ] && say "LOCAL_REWRITE_MD5=$C_MD5"
  if [ "$C_SHA" = "$A_SHA" ]; then
    say 'LOCAL_REWRITE_HASH_COMPARE=PASS'
  else
    say 'LOCAL_REWRITE_HASH_COMPARE=FAIL'
    STRONG_STORAGE_FAIL=$((STRONG_STORAGE_FAIL+1)); FAILS=$((FAILS+1))
    return
  fi

  if [ "$A_SHA" = "$EXPECTED_SHA" ] && [ "$B_SHA" = "$EXPECTED_SHA" ] && [ "$C_SHA" = "$EXPECTED_SHA" ]; then
    say 'TEST_RESULT=PASS'
    PASS=$((PASS+1))
  else
    say 'ASSET_GROUND_TRUTH=FAIL_BUT_LOCAL_COPIES_STABLE'
    FAILS=$((FAILS+1))
  fi
}

say 'MODE=GITHUB_SSD_INTEGRITY_TEST_V2'
say "TESTDIR=$TESTDIR"
say "SHA256_TOOL=$SHA_TOOL"
say "MD5_TOOL=${MD5_TOOL:-NONE}"
say 'Each asset: two independent downloads + repeated rereads + real local rewrite.'

run_asset \
  'llvm-aarch64-zst' \
  '425456048' \
  '0f9d0308a93b76318eae633806eddbec098fb96f27a706fed5ada399f9e391b5' \
  'https://github.com/llvm/llvm-project/releases/download/llvmorg-23.1.1/clang%2Bllvm-23.1.1-aarch64-pc-windows-msvc.tar.zst'

run_asset \
  'llvm-aarch64-xz' \
  '763828684' \
  'c8cd61f6624accf0d0f9f4519ddcc97745c6a865205bb43f364b6aaf9c50a31e' \
  'https://github.com/llvm/llvm-project/releases/download/llvmorg-23.1.1/clang%2Bllvm-23.1.1-aarch64-pc-windows-msvc.tar.xz'

run_asset \
  'llvm-x86_64-xz' \
  '901304424' \
  'c54ac8146b420fe72e11e6fdd56498d6818011ad23267196b6ab37b5ac9264c3' \
  'https://github.com/llvm/llvm-project/releases/download/llvmorg-23.1.1/clang%2Bllvm-23.1.1-x86_64-pc-windows-msvc.tar.xz'

say '============================================================'
say "SUMMARY total=$TOTAL pass=$PASS fails=$FAILS"
say "STRONG_STORAGE_FAIL=$STRONG_STORAGE_FAIL"
say "NETWORK_OR_PATH_FAIL=$NETWORK_OR_PATH_FAIL"
say "HASH_FAIL=$HASH_FAIL"

if [ "$STRONG_STORAGE_FAIL" -gt 0 ]; then
  say 'FINAL=STORAGE_PATH_SUSPECT'
  say 'Repeated reread or local rewrite changed data. Suspect SSD/T2 storage path, RAM, or lower-level I/O.'
elif [ "$HASH_FAIL" -gt 0 ]; then
  say 'FINAL=DOWNLOADED_BYTES_DO_NOT_MATCH_GITHUB_GROUND_TRUTH'
  say 'Local copies were stable but one or more GitHub-published SHA-256 digests failed.'
elif [ "$NETWORK_OR_PATH_FAIL" -gt 0 ]; then
  say 'FINAL=TRANSFER_OR_STORAGE_PATH_UNSTABLE'
  say 'Independent transfers failed or produced different hashes; more isolation is required.'
elif [ "$PASS" -eq "$TOTAL" ]; then
  say 'FINAL=PASS_NO_CORRUPTION_DETECTED'
  say 'All GitHub assets matched published SHA-256 and survived reread/rewrite checks.'
else
  say 'FINAL=INCONCLUSIVE'
fi

say "FILES_LEFT_IN=$TESTDIR"
say 'Do not delete them yet. Re-read their SHA-256 after a reboot for a persistence check.'
