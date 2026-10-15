#!/bin/bash
# Post-reboot persistence/reread check for GitHub SSD test files.
# Recovery-compatible: does not require cmp.
set -u

D='/Volumes/Apple/GitHub-SSD-Test'
[ -d "$D" ] || { echo "STOP: $D not found"; exit 1; }

SHA_TOOL=''
if command -v shasum >/dev/null 2>&1; then
  SHA_TOOL='shasum'
elif command -v sha256sum >/dev/null 2>&1; then
  SHA_TOOL='sha256sum'
elif command -v openssl >/dev/null 2>&1; then
  SHA_TOOL='openssl'
fi
[ -n "$SHA_TOOL" ] || { echo 'STOP: no SHA-256 tool found'; exit 1; }

sha256_file(){
  F=$1
  case "$SHA_TOOL" in
    shasum) shasum -a 256 "$F" 2>/dev/null | awk '{print $1}';;
    sha256sum) sha256sum "$F" 2>/dev/null | awk '{print $1}';;
    openssl) openssl dgst -sha256 "$F" 2>/dev/null | awk '{print $NF}';;
  esac
}

MD5_TOOL=''
command -v md5 >/dev/null 2>&1 && MD5_TOOL='md5'

FAIL=0
TOTAL=0
PASS=0

check_set(){
  P=$1
  EXPECTED=$2
  A="$D/$P.A"
  B="$D/$P.B"
  C="$D/$P.local-rewrite"

  TOTAL=$((TOTAL+1))
  echo '------------------------------------------------------------'
  echo "TEST=$P"
  echo "EXPECTED_SHA256=$EXPECTED"

  for F in "$A" "$B" "$C"; do
    if [ ! -f "$F" ]; then
      echo "MISSING=$F"
      FAIL=$((FAIL+1))
      return
    fi
  done

  HA=$(sha256_file "$A")
  HB=$(sha256_file "$B")
  HC=$(sha256_file "$C")
  echo "A_SHA256=$HA"
  echo "B_SHA256=$HB"
  echo "C_SHA256=$HC"

  if [ "$MD5_TOOL" = 'md5' ]; then
    echo "A_MD5=$(md5 -q "$A")"
    echo "B_MD5=$(md5 -q "$B")"
    echo "C_MD5=$(md5 -q "$C")"
  fi

  if [ "$HA" = "$EXPECTED" ] && [ "$HB" = "$EXPECTED" ] && [ "$HC" = "$EXPECTED" ]; then
    echo 'GROUND_TRUTH_AFTER_REBOOT=PASS'
  else
    echo 'GROUND_TRUTH_AFTER_REBOOT=FAIL'
    FAIL=$((FAIL+1))
    return
  fi

  if [ "$HA" = "$HB" ] && [ "$HA" = "$HC" ]; then
    echo 'REREAD_HASH_COMPARE=PASS A=B=C'
    PASS=$((PASS+1))
  else
    echo 'REREAD_HASH_COMPARE=FAIL'
    FAIL=$((FAIL+1))
  fi
}

check_set 'llvm-aarch64-zst' '0f9d0308a93b76318eae633806eddbec098fb96f27a706fed5ada399f9e391b5'
check_set 'llvm-aarch64-xz' 'c8cd61f6624accf0d0f9f4519ddcc97745c6a865205bb43f364b6aaf9c50a31e'
check_set 'llvm-x86_64-xz' 'c54ac8146b420fe72e11e6fdd56498d6818011ad23267196b6ab37b5ac9264c3'

echo '============================================================'
echo "SUMMARY total=$TOTAL pass=$PASS fail=$FAIL"
if [ "$FAIL" -eq 0 ] && [ "$PASS" -eq "$TOTAL" ]; then
  echo 'FINAL=PASS_PERSISTENCE_OK'
else
  echo 'FINAL=FAIL_PERSISTENCE_OR_STORAGE_PATH_SUSPECT'
fi
