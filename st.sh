#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Downloads one complete immutable package before executing any of its modules.
# The bootstrap itself is trusted through its distribution channel, not a vendor signature.
b_start(){
  umask 077
  local ref=f27d3d2bb88cb9dbd0a3b0b58bc66503f1e52efa
  local manifest_sha=0f8c8dee04f519e2d9bf6f820a64190e85737ef0f44e2b53e7b933e2a3d8c4f6
  local root='' scratch='' offline=0 hash bytes path extra got rc=0 rows=0 caff=''
  B_BOOT_SCRATCH='';B_BOOT_CAFF='';B_BOOT_CHILD=''
  if [ "${1:-}" = --offline ];then
    offline=1;shift
    root=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P) || return 3
  else
    scratch=$(mktemp -d /tmp/macdiag-package.XXXXXXXX) || return 3
    root=$scratch;B_BOOT_SCRATCH=$scratch
  fi
  b_cleanup(){
    if [ -n "${B_BOOT_CHILD:-}" ];then kill -TERM "$B_BOOT_CHILD" 2>/dev/null || :;wait "$B_BOOT_CHILD" 2>/dev/null || :;B_BOOT_CHILD='';fi
    [ -z "${B_BOOT_CAFF:-}" ] || kill "$B_BOOT_CAFF" 2>/dev/null || :
    case "${B_BOOT_SCRATCH:-}" in /tmp/macdiag-package.*) rm -rf "$B_BOOT_SCRATCH";;esac
    B_BOOT_SCRATCH='';B_BOOT_CAFF='' 
  }
  trap 'exit 130' INT
  trap 'exit 143' TERM HUP
  trap b_cleanup EXIT
  b_sha(){
    if command -v sha256sum >/dev/null 2>&1;then sha256sum "$1"
    elif command -v shasum >/dev/null 2>&1;then shasum -a 256 "$1"
    else return 3;fi
  }
  b_get(){
    curl -q -fsSL --proto '=https' --proto-redir '=https' --retry 2 \
      --connect-timeout 20 --max-time 120 "$1" -o "$2"
  }
  mkdir -p "$root/diagnostics/v2" || return 3
  local base="https://raw.githubusercontent.com/pioner22/MacOS/$ref"
  local manifest="$root/diagnostics/v2/package.tsv"
  if [ "$offline" -eq 0 ];then
    b_get "$base/diagnostics/v2/package.tsv" "$manifest" || { echo 'RESULT=INCONCLUSIVE manifest_download_failed';return 3; }
  fi
  got=$(b_sha "$manifest");rc=$?;got=${got%% *}
  [ "$rc" -eq 0 ] && [ "$got" = "$manifest_sha" ] || { echo 'RESULT=INCONCLUSIVE manifest_integrity_failed';return 3; }
  while IFS=$'\t' read -r hash bytes path extra;do
    [[ "$hash" =~ ^[0-9a-f]{64}$ ]] || return 3
    case "$bytes" in ''|*[!0-9]*) return 3;;esac
    [ ${#bytes} -le 8 ] && [ "$bytes" -gt 0 ] && [ "$bytes" -le 1048576 ] || return 3
    [ -z "$extra" ] || return 3
    case "$path" in diagnostics/v2/*) :;;*) return 3;;esac
    case "$path" in *..*|*[!a-zA-Z0-9_./-]*) return 3;;esac
    if [ "$offline" -eq 0 ];then b_get "$base/$path" "$root/$path" || { echo "RESULT=INCONCLUSIVE module_download_failed=$path";return 3; };fi
    [ -f "$root/$path" ] && [ ! -L "$root/$path" ] || return 3
    got=$(wc -c < "$root/$path" | tr -d '[:space:]')
    [ "$got" = "$bytes" ] || { echo "RESULT=INCONCLUSIVE module_size_failed=$path";return 3; }
    got=$(b_sha "$root/$path");rc=$?;got=${got%% *}
    [ "$rc" -eq 0 ] && [ "$got" = "$hash" ] || { echo "RESULT=INCONCLUSIVE module_hash_failed=$path";return 3; }
    rows=$((rows+1))
  done < "$manifest"
  [ "$rows" -ge 12 ] && [ "$rows" -le 40 ] || return 3
  /bin/bash -n "$root/diagnostics/v2/menu.sh" || return 3
  export MACDIAG_SNAPSHOT=$ref
  printf 'PACKAGE_VERIFIED snapshot=%s files=%s\n' "$ref" "$rows"
  if command -v caffeinate >/dev/null 2>&1;then caffeinate -di -w $$ >/dev/null 2>&1 & caff=$!;B_BOOT_CAFF=$caff;fi
  /bin/bash "$root/diagnostics/v2/menu.sh" "$@" & B_BOOT_CHILD=$!
  wait "$B_BOOT_CHILD";rc=$?;B_BOOT_CHILD='' 
  b_cleanup
  trap - EXIT INT TERM HUP
  return "$rc"
}
b_start "$@"
exit "$?"
