#!/bin/bash
# The entire bootstrap is defined before execution, including when piped to bash.
# SPDX-License-Identifier: GPL-3.0-or-later
macdiag_launch(){
  local ref manifest_sha work mode name sha bytes actual sum tool ca rc attempt n
  local -a hashcmd
  ref='1b4e0677e58641255ab69931169effc0693aeee9'
  manifest_sha='6c4d4421165f2a270eababffd79480345c0b7b2e587bdf2319027ba4f90d206a'
  mode=${1:-menu}
  umask 077
  hashcmd=()
  for tool in sha256sum shasum; do
    command -v "$tool" >/dev/null 2>&1 || continue
    if [ "$tool" = shasum ];then hashcmd=(shasum -a 256);else hashcmd=(sha256sum);fi
    actual=$(printf abc | "${hashcmd[@]}") || { hashcmd=(); continue; }
    [ "${actual%% *}" = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad ] && break
    hashcmd=()
  done
  if [ "${#hashcmd[@]}" -eq 0 ];then
    echo 'RESULT=INCONCLUSIVE SHA256_TOOL_REQUIRED';return 3
  fi
  work=$(mktemp -d /tmp/macdiag-package.XXXXXX) || return 3
  # These variables remain in the enclosing scope until the EXIT trap has run.
  MACDIAG_BOOT_WORK=$work; MACDIAG_BOOT_CAFF=''
  trap 'if [ -n "$MACDIAG_BOOT_CAFF" ];then kill "$MACDIAG_BOOT_CAFF" 2>/dev/null || :;fi; rm -rf "$MACDIAG_BOOT_WORK"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM HUP
  if command -v caffeinate >/dev/null 2>&1;then
    caffeinate -di -w $$ > "$work/caffeinate.log" 2>&1 & MACDIAG_BOOT_CAFF=$!
  fi
  echo "MACDIAG_PACKAGE_REF=$ref"
  # Small source files are fetched into unique regular files, never executed as a live stream.
  for name in manifest.tsv; do
    if ! curl -q -fsSL --retry 0 --proto '=https' --proto-redir '=https' --max-redirs 5 \
      --connect-timeout 15 --max-time 120 --max-filesize 1048576 \
      "https://raw.githubusercontent.com/pioner22/MacOS/$ref/diagnostics_v2/$name" -o "$work/$name";then
      echo 'RESULT=INCONCLUSIVE PACKAGE_MANIFEST_FETCH_FAILED';return 3
    fi
  done
  actual=$("${hashcmd[@]}" "$work/manifest.tsv") || return 3
  if [ "${actual%% *}" != "$manifest_sha" ];then echo 'RESULT=INCONCLUSIVE PACKAGE_MANIFEST_HASH_FAILED';return 3;fi
  n=0
  while read -r sha bytes name;do
    case "$name" in common.sh|count_stream.pl|fixtures.txt|metal_vram.m|net.sh|profile.sh|ram_native.c|run.sh|storage_file.c) ;;*)echo 'RESULT=INCONCLUSIVE INVALID_PACKAGE_PATH';return 3;;esac
    case "$bytes" in ''|*[!0-9]*)return 3;;esac
    case "$sha" in *[!a-f0-9]*|'')return 3;;esac
    [ "${#sha}" = 64 ] && [ "${#bytes}" -le 6 ] || return 3
    [ ! -e "$work/$name" ] || { echo 'RESULT=INCONCLUSIVE DUPLICATE_PACKAGE_PATH';return 3; }
    rc=1
    for attempt in 1 2;do
      rm -f "$work/$name.part"
      if curl -q -fsSL --retry 0 --proto '=https' --proto-redir '=https' --max-redirs 5 \
        --connect-timeout 15 --max-time 120 --max-filesize 1048576 \
        "https://raw.githubusercontent.com/pioner22/MacOS/$ref/diagnostics_v2/$name" -o "$work/$name.part";then rc=0;break;fi
    done
    [ "$rc" -eq 0 ] || { echo "RESULT=INCONCLUSIVE PACKAGE_FILE_FETCH_FAILED=$name";return 3; }
    actual=$(wc -c < "$work/$name.part" | tr -d ' ')
    sum=$("${hashcmd[@]}" "$work/$name.part") || return 3
    if [ "$actual" != "$bytes" ] || [ "${sum%% *}" != "$sha" ];then echo "RESULT=INCONCLUSIVE PACKAGE_FILE_HASH_OR_SIZE_FAILED=$name";return 3;fi
    mv "$work/$name.part" "$work/$name" || return 3
    n=$((n+1))
  done < "$work/manifest.tsv"
  [ "$n" -eq 9 ] || { echo 'RESULT=INCONCLUSIVE PACKAGE_INCOMPLETE';return 3; }
  for name in common.sh profile.sh net.sh run.sh;do /bin/bash -n "$work/$name" || return 3;done
  export MACDIAG_CODE_REF=$ref
  if ( : </dev/tty ) 2>/dev/null;then /bin/bash "$work/run.sh" "$mode" </dev/tty
  else /bin/bash "$work/run.sh" "$mode";fi
  rc=$?
  echo "DIAGNOSTIC_EXIT_CODE=$rc"
  return "$rc"
}
macdiag_launch "$@"
exit $?
