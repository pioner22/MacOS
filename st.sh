#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Stable entry point. Resolve latest published descriptor once, then pin all files.
# Trust starts with this bootstrap and HTTPS; hashes are not a vendor signature.
macdiag_launch(){
  local work mode version ref manifest_sha extra name sha bytes actual sum n attempt rc src
  local -a hashcmd
  umask 077
  export LC_ALL=C
  mode=${1:-menu}
  hashcmd=()
  for name in sha256sum shasum;do
    command -v "$name" >/dev/null 2>&1 || continue
    if [ "$name" = shasum ];then hashcmd=(shasum -a 256);else hashcmd=(sha256sum);fi
    actual=$(printf abc | "${hashcmd[@]}") || { hashcmd=();continue; }
    [ "${actual%% *}" = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad ] && break
    hashcmd=()
  done
  [ "${#hashcmd[@]}" -ne 0 ] || { echo 'INCONCLUSIVE: SHA-256 недоступен / unavailable';return 3; }
  work=$(mktemp -d /tmp/macdiag-package.XXXXXX) || return 3
  MACDIAG_BOOT_WORK=$work
  trap 'rm -rf "$MACDIAG_BOOT_WORK"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 129' HUP
  if [ "$mode" = --offline ];then
    src=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd) || return 3
    cp "$src/diagnostics-release.tsv" "$work/release.tsv" || return 3
    mode=${2:-menu}
  else
    src=''
    curl -q -fsSL --retry 0 --proto '=https' --proto-redir '=https' --max-redirs 5 \
      --connect-timeout 15 --max-time 90 --max-filesize 4096 -H 'Cache-Control: no-cache' \
      "https://raw.githubusercontent.com/pioner22/MacOS/main/diagnostics-release.tsv?t=$(date +%s)-$$" \
      -o "$work/release.tsv" || { echo 'INCONCLUSIVE: описание выпуска не загружено / release descriptor unavailable';return 3; }
  fi
  [ "$(wc -l < "$work/release.tsv" | tr -d ' ')" = 1 ] || return 3
  IFS=$'\t' read -r version ref manifest_sha extra < "$work/release.tsv" || return 3
  case "$version" in ''|*[!A-Za-z0-9._-]*)return 3;;esac
  case "$ref:$manifest_sha" in *[!a-f0-9:]*)return 3;;esac
  [ "${#ref}" = 40 ] && [ "${#manifest_sha}" = 64 ] && [ -z "$extra" ] || return 3
  echo "RELEASE_VERSION=$version CODE_REF=$ref"
  if [ -n "$src" ];then cp "$src/diagnostics_v2/manifest.tsv" "$work/manifest.tsv" || return 3
  else
    curl -q -fsSL --retry 0 --proto '=https' --proto-redir '=https' --max-redirs 5 \
      --connect-timeout 15 --max-time 120 --max-filesize 1048576 \
      "https://raw.githubusercontent.com/pioner22/MacOS/$ref/diagnostics_v2/manifest.tsv" -o "$work/manifest.tsv" || return 3
  fi
  actual=$("${hashcmd[@]}" "$work/manifest.tsv") || return 3
  [ "${actual%% *}" = "$manifest_sha" ] || { echo 'INCONCLUSIVE: manifest hash mismatch / повреждён манифест';return 3; }
  n=0
  while IFS=$'\t' read -r sha bytes name extra;do
    case "$name" in common.sh|count_stream.pl|fixtures.txt|metal_vram.m|net.sh|profile.sh|ram_native.c|run.sh|storage_file.c|report.sh|supervise.pl) ;;*)return 3;;esac
    case "$bytes" in ''|*[!0-9]*)return 3;;esac
    case "$sha" in *[!a-f0-9]*|'')return 3;;esac
    [ "${#sha}" = 64 ] && [ "${#bytes}" -le 6 ] && [ -z "$extra" ] && [ ! -e "$work/$name" ] || return 3
    if [ -n "$src" ];then cp "$src/diagnostics_v2/$name" "$work/$name.part" || return 3
    else
      rc=1
      for attempt in 1 2;do
        rm -f "$work/$name.part"
        if curl -q -fsSL --retry 0 --proto '=https' --proto-redir '=https' --max-redirs 5 \
          --connect-timeout 15 --max-time 120 --max-filesize 1048576 \
          "https://raw.githubusercontent.com/pioner22/MacOS/$ref/diagnostics_v2/$name" -o "$work/$name.part";then rc=0;break;fi
      done
      [ "$rc" -eq 0 ] || { echo "INCONCLUSIVE: file fetch failed / файл не загружен: $name";return 3; }
    fi
    actual=$(wc -c < "$work/$name.part" | tr -d ' ')
    sum=$("${hashcmd[@]}" "$work/$name.part") || return 3
    [ "$actual" = "$bytes" ] && [ "${sum%% *}" = "$sha" ] || { echo "INCONCLUSIVE: hash/size mismatch / повреждён файл: $name";return 3; }
    mv "$work/$name.part" "$work/$name" || return 3
    n=$((n+1))
  done < "$work/manifest.tsv"
  [ "$n" -eq 11 ] || { echo 'INCONCLUSIVE: incomplete package / неполный пакет';return 3; }
  for name in common.sh profile.sh net.sh report.sh run.sh;do /bin/bash -n "$work/$name" || return 3;done
  export MACDIAG_CODE_REF=$ref MACDIAG_PACKAGE_WORK=$work
  # exec keeps the PID/TTY: Ctrl+C reaches the runner directly, no orphan launcher.
  # Validated source cache is retained in /tmp for investigation, not user payloads.
  if command -v caffeinate >/dev/null 2>&1;then caffeinate -di -w $$ > "$work/caffeinate.log" 2>&1 & fi
  trap - EXIT INT TERM HUP
  if ( : </dev/tty ) 2>/dev/null;then exec /bin/bash "$work/run.sh" "$mode" </dev/tty
  else exec /bin/bash "$work/run.sh" "$mode";fi
}
macdiag_launch "$@"
exit $?
