#!/bin/bash
set -u
D='/Volumes/Apple/GitHub-SSD-Test'
[ -d "$D" ] || { echo "STOP: $D not found"; exit 1; }
if ! command -v md5 >/dev/null 2>&1; then echo 'STOP: md5 not found'; exit 1; fi
for F in "$D"/*; do
  [ -f "$F" ] || continue
  echo "FILE=$F"
  echo "MD5=$(md5 -q "$F")"
done
for P in \
  'llvm-aarch64-zst' \
  'llvm-aarch64-xz' \
  'llvm-x86_64-xz'; do
  A="$D/$P.A"; B="$D/$P.B"; C="$D/$P.local-rewrite"
  if [ -f "$A" ] && [ -f "$B" ]; then cmp -s "$A" "$B" && echo "REREAD_COMPARE_PASS $P A=B" || echo "REREAD_COMPARE_FAIL $P A!=B"; fi
  if [ -f "$A" ] && [ -f "$C" ]; then cmp -s "$A" "$C" && echo "REREAD_LOCAL_PASS $P" || echo "REREAD_LOCAL_FAIL $P"; fi
done
