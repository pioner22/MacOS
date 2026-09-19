#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Verify a complete downloaded/offline package, never execute its manifest.
root=$1
[ -d "$root/diagnostics/v2" ] || exit 3
manifest="$root/diagnostics/v2/package.tsv"
[ -f "$manifest" ] || exit 3
sha(){
  if command -v sha256sum >/dev/null 2>&1;then sha256sum "$1"
  elif command -v shasum >/dev/null 2>&1;then shasum -a 256 "$1"
  else return 3;fi
}
rows=0;bad=0
while IFS=$'\t' read -r expected bytes path extra;do
  [ -n "$expected" ] || continue
  [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || exit 3
  case "$bytes" in ''|*[!0-9]*) exit 3;;esac
  [ ${#bytes} -le 8 ] && [ "$bytes" -gt 0 ] && [ "$bytes" -le 1048576 ] || exit 3
  case "$path" in diagnostics/v2/*) :;;*) exit 3;;esac
  case "$path" in *..*|*[!a-zA-Z0-9_./-]*) exit 3;;esac
  [ -z "$extra" ] && [ -f "$root/$path" ] && [ ! -L "$root/$path" ] || exit 3
  actual=$(wc -c < "$root/$path" | tr -d '[:space:]')
  [ "$actual" = "$bytes" ] || { printf 'PACKAGE_SIZE_FAIL=%s\n' "$path";exit 3; }
  got=$(sha "$root/$path");rc=$?;got=${got%% *}
  [ "$rc" -eq 0 ] && [ "$got" = "$expected" ] || { printf 'PACKAGE_HASH_FAIL=%s\n' "$path";exit 3; }
  rows=$((rows+1))
done < "$manifest"
[ "$rows" -ge 10 ] && [ "$rows" -le 40 ] || exit 3
printf 'PACKAGE_VERIFY=PASS files=%s\n' "$rows"
