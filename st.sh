#!/bin/bash
{
# Prefer system utilities on Darwin, not unqualified Homebrew overrides.
if [ "$(/usr/bin/uname -s 2>/dev/null)" = Darwin ];then
  PATH=/usr/bin:/bin:/usr/sbin:/sbin;export PATH
fi
# SPDX-License-Identifier: GPL-3.0-or-later
# Stable entry point. Resolve latest published descriptor once, then pin all files.
# Trust starts with this bootstrap and HTTPS; hashes are not a vendor signature.
macdiag_launch(){
  local work mode version ref manifest_sha extra name sha bytes actual sum n src
  local -a hashcmd
  # Bootstrap-only helpers: never used for diagnostic payload/hash streams.
  boot_note(){
    printf '%s\n' "$*" >&2
    if [ -n "${MACDIAG_BOOT_LOG:-}" ];then
      printf '%s\n' "$*" >> "$MACDIAG_BOOT_LOG" || {
        printf 'RESULT=INCONCLUSIVE BOOTSTRAP_REASON=LOG_WRITE_FAILED\n' >&2;return 3;
      }
    fi
  }
  boot_fail(){
    boot_note "RESULT=INCONCLUSIVE BOOTSTRAP_REASON=$1" || return 3
    boot_note "RU: $2" || return 3
    boot_note "EN: $3" || return 3
    return 3
  }
  boot_fetch(){
    local label url dest limit part err httpfile i rc http length blocks retry
    label=$1;url=$2;dest=$3;limit=$4
    part="$dest.incoming";err="$dest.curl.err";httpfile="$dest.http"
    # Bash's file-limit units can be 512 or 1024 bytes. This conservative limit
    # bounds temporary writes to roughly twice the requested cap on old curl.
    # Exact length is checked below and again against the package manifest.
    blocks=$(((limit+511)/512))
    for i in 1 2 3;do
      rm -f "$part" || { boot_fail PART_RESET_FAILED 'Не удалось очистить временный файл.' 'Cannot reset temporary file.';return 3; }
      boot_note "FETCH_START item=$label attempt=$i max_bytes=$limit" || return 3
      (
        ulimit -f "$blocks" || exit 125
        exec curl -q -fsSL --retry 0 --proto '=https' --proto-redir '=https' --max-redirs 5 \
          --connect-timeout 15 --max-time 120 --max-filesize "$limit" \
          -H 'Cache-Control: no-cache' -w '%{http_code}' "$url" -o "$part"
      ) > "$httpfile" 2> "$err"
      rc=$?;http=$(cat "$httpfile")
      boot_note "FETCH_END item=$label attempt=$i curl_rc=$rc http=$http" || return 3
      if [ -s "$err" ];then
        cat "$err" >&2
        cat "$err" >> "$MACDIAG_BOOT_LOG" || { boot_fail LOG_WRITE_FAILED 'Ошибка сохранения stderr curl.' 'Cannot save curl stderr.';return 3; }
      fi
      if [ "$rc" -eq 0 ] && [ "$http" = 200 ];then
        length=$(wc -c < "$part" | tr -d ' ') || length=''
        case "$length" in ''|*[!0-9]*) boot_fail FETCH_SIZE_UNAVAILABLE 'Не удалось определить размер загрузки.' 'Cannot determine downloaded size.';return 3;;esac
        if [ "$length" -gt "$limit" ] || [ "$length" -eq 0 ];then
          rm -f "$part"
          boot_fail FETCH_SIZE_INVALID 'Получен пустой или слишком большой файл.' 'Received an empty or oversized file.';return 3
        fi
        mv "$part" "$dest" || { boot_fail FETCH_FINALIZE_FAILED 'Не удалось завершить сохранение файла.' 'Cannot finalize downloaded file.';return 3; }
        return 0
      fi
      rm -f "$part"
      case "$rc" in 129|130|143) return "$rc";;esac
      if [ "$rc" -eq 60 ];then
        boot_note "UTC_NOW=$(date -u '+%Y-%m-%dT%H:%M:%SZ')" || return 3
        boot_fail TLS_VERIFY_FAILED 'Не пройдена проверка сертификата. Проверьте дату, доверенные CA, цепочку сертификатов и сеть. TLS не отключать.' 'Certificate verification failed. Check time, trusted CAs, certificate chain and network. Do not disable TLS verification.';return 3
      fi
      retry=no
      case "$rc" in 5|6|7|18|28|35|52|55|56) retry=yes;;
        22) case "$http" in 408|429|500|502|503|504)retry=yes;;esac;;esac
      if [ "$retry" != yes ] || [ "$i" -eq 3 ];then
        boot_fail FETCH_FAILED 'Загрузка не завершена; код curl и HTTP указан выше. Аппаратный тест не запускался.' 'Download did not complete; see curl and HTTP codes above. No hardware test started.';return 3
      fi
      boot_note "FETCH_RETRY item=$label delay_seconds=$i" || return 3
      sleep "$i" || return 130
    done
    boot_fail FETCH_EXHAUSTED 'Попытки загрузки исчерпаны.' 'Download attempts exhausted.'
  }
  umask 077
  export LC_ALL=C
  MACDIAG_BOOT_LOG=
  printf 'BOOTSTRAP_VERSION=1.2\n'
  mode=${1:-menu}
  # Minimal built-in preflight before importing any downloaded module.
  for name in mktemp rm cp mv cat wc tr awk sed grep tee date uname sleep dirname;do
    command -v "$name" >/dev/null 2>&1 || { boot_fail MISSING_TOOL "Нет утилиты: $name." "Missing tool: $name.";return 3; }
  done
  if [ "$mode" != --offline ];then command -v curl >/dev/null 2>&1 || { boot_fail MISSING_CURL 'Нет curl; загрузка невозможна.' 'curl unavailable; cannot download.';return 3; };fi
  work=$(mktemp -d /tmp/macdiag-package.XXXXXX) || { boot_fail TEMP_DIR_FAILED 'Не создан временный каталог.' 'Cannot create temporary directory.';return 3; }
  MACDIAG_BOOT_LOG="$work/bootstrap.log";export MACDIAG_BOOT_LOG
  : > "$MACDIAG_BOOT_LOG" || { MACDIAG_BOOT_LOG=;boot_fail LOG_CREATE_FAILED 'Не создан журнал запуска.' 'Cannot create bootstrap log.';return 3; }
  boot_note "BOOTSTRAP_STAGE=PREFLIGHT BASH=$BASH_VERSION KERNEL=$(uname -s) ARCH=$(uname -m)" || return 3
  echo "BOOTSTRAP_LOG=$MACDIAG_BOOT_LOG"
  # Failed bootstrap evidence is kept; no credentials or environment dump are collected.
  trap 'echo "BOOTSTRAP_EXIT=$? LOG=$MACDIAG_BOOT_LOG"; echo "RU: Лог в /tmp временный. EN: /tmp evidence may be volatile."' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 129' HUP
  hashcmd=()
  for name in sha256sum shasum openssl;do
    command -v "$name" >/dev/null 2>&1 || continue
    case "$name" in shasum)hashcmd=(shasum -a 256);;openssl)hashcmd=(openssl dgst -sha256 -r);;*)hashcmd=(sha256sum);;esac
    actual=$(printf abc | "${hashcmd[@]}") || { hashcmd=();continue; }
    [ "${actual%% *}" = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad ] && break
    hashcmd=()
  done
  [ "${#hashcmd[@]}" -ne 0 ] || { boot_fail SHA256_UNAVAILABLE 'Нет рабочего SHA-256; запуск прекращён.' 'No working SHA-256 implementation; stopping.';return 3; }
  if [ "$mode" = --offline ];then
    src=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd) || { boot_fail OFFLINE_ROOT_FAILED 'Не найден каталог пакета.' 'Cannot locate offline package.';return 3; }
    cp "$src/diagnostics-release.tsv" "$work/release.tsv" || { boot_fail OFFLINE_DESCRIPTOR_FAILED 'Не скопировано описание выпуска.' 'Cannot copy release descriptor.';return 3; }
    mode=${2:-menu}
  else
    src=''
    boot_fetch release "https://raw.githubusercontent.com/pioner22/MacOS/main/diagnostics-release.tsv?t=$(date +%s)-$$" "$work/release.tsv" 4096 || return $?
  fi
  [ "$(wc -l < "$work/release.tsv" | tr -d ' ')" = 1 ] || { boot_fail DESCRIPTOR_ROW_COUNT 'Описание выпуска должно содержать одну строку.' 'Release descriptor must contain exactly one line.';return 3; }
  if ! awk -F '\t' 'NR==1 && NF==3 && $1!="" && $2!="" && $3!="" {ok=1} END{exit (NR==1 && ok)?0:1}' "$work/release.tsv";then
    boot_fail DESCRIPTOR_FIELDS_INVALID 'Нужны ровно три непустых поля.' 'Exactly three nonempty fields required.';return 3
  fi
  local descriptor_text descriptor_bytes
  descriptor_text=$(cat "$work/release.tsv") || return 3
  descriptor_bytes=$(wc -c < "$work/release.tsv" | tr -d ' ') || return 3
  [ "$descriptor_bytes" = "$(( ${#descriptor_text}+1 ))" ] || { boot_fail DESCRIPTOR_TERMINATOR_INVALID 'Недопустимый хвост описания выпуска.' 'Invalid descriptor terminator or trailing data.';return 3; }
  IFS=$'\t' read -r version ref manifest_sha extra < "$work/release.tsv" || { boot_fail DESCRIPTOR_READ_FAILED 'Не прочитано описание выпуска.' 'Cannot read release descriptor.';return 3; }
  case "$version" in ''|*[!A-Za-z0-9._-]*)boot_fail VERSION_INVALID 'Неверная версия в описании выпуска.' 'Invalid release version.';return 3;;esac
  case "$ref:$manifest_sha" in *[!a-f0-9:]*)boot_fail DESCRIPTOR_HASH_FORMAT 'Неверный формат ревизии или хэша.' 'Invalid revision or digest format.';return 3;;esac
  [ "${#ref}" = 40 ] && [ "${#manifest_sha}" = 64 ] && [ -z "$extra" ] || { boot_fail DESCRIPTOR_FIELDS_INVALID 'Неверные поля описания выпуска.' 'Invalid release descriptor fields.';return 3; }
  echo "RELEASE_VERSION=$version CODE_REF=$ref"
  boot_note "RELEASE_SELECTED version=$version ref=$ref" || return 3
  if [ -n "$src" ];then cp "$src/diagnostics_v2/manifest.tsv" "$work/manifest.tsv" || { boot_fail OFFLINE_MANIFEST_FAILED 'Не скопирован манифест.' 'Cannot copy manifest.';return 3; }
  else
    boot_fetch manifest "https://raw.githubusercontent.com/pioner22/MacOS/$ref/diagnostics_v2/manifest.tsv" "$work/manifest.tsv" 1048576 || return $?
  fi
  actual=$("${hashcmd[@]}" "$work/manifest.tsv") || { boot_fail MANIFEST_HASH_TOOL_FAILED 'Не рассчитан хэш манифеста.' 'Manifest hashing failed.';return 3; }
  [ "${actual%% *}" = "$manifest_sha" ] || { boot_fail MANIFEST_HASH_MISMATCH 'Хэш манифеста не совпал; ничего не запускаем.' 'Manifest hash mismatch; nothing will execute.';return 3; }
  n=0
  while IFS=$'\t' read -r sha bytes name extra;do
    case "$name" in common.sh|count_stream.pl|fixtures.txt|metal_vram.m|net.sh|profile.sh|ram_native.c|run.sh|storage_file.c|report.sh|supervise.pl|profiles.tsv|recovery.sh|recovery_ram.pl|recovery_file.pl) ;;*)boot_fail MANIFEST_PATH_INVALID 'Неизвестное имя файла в манифесте.' 'Unapproved file name in manifest.';return 3;;esac
    case "$bytes" in ''|*[!0-9]*)boot_fail MANIFEST_SIZE_INVALID 'Неверный размер файла в манифесте.' 'Invalid manifest file size.';return 3;;esac
    case "$sha" in *[!a-f0-9]*|'')boot_fail MANIFEST_DIGEST_INVALID 'Неверный хэш файла в манифесте.' 'Invalid manifest digest.';return 3;;esac
    [ "${#sha}" = 64 ] && [ "${#bytes}" -le 6 ] && [ -z "$extra" ] && [ ! -e "$work/$name" ] || { boot_fail MANIFEST_FIELDS_OR_DUPLICATE 'Неверные поля или повтор файла в манифесте.' 'Invalid fields or duplicate manifest file.';return 3; }
    if [ -n "$src" ];then cp "$src/diagnostics_v2/$name" "$work/$name.part" || { boot_fail OFFLINE_FILE_FAILED "Не скопирован файл: $name." "Cannot copy file: $name.";return 3; }
    else
      boot_fetch "$name" "https://raw.githubusercontent.com/pioner22/MacOS/$ref/diagnostics_v2/$name" "$work/$name.part" 1048576 || return $?
    fi
    actual=$(wc -c < "$work/$name.part" | tr -d ' ')
    sum=$("${hashcmd[@]}" "$work/$name.part") || { boot_fail FILE_HASH_TOOL_FAILED "Не рассчитан хэш: $name." "Hashing failed: $name.";return 3; }
    [ "$actual" = "$bytes" ] && [ "${sum%% *}" = "$sha" ] || { boot_fail FILE_HASH_OR_SIZE_MISMATCH "Хэш или размер не совпал: $name." "File hash or size mismatch: $name.";return 3; }
    mv "$work/$name.part" "$work/$name" || { boot_fail VERIFIED_FILE_MOVE_FAILED "Не сохранён проверенный файл: $name." "Cannot finalize verified file: $name.";return 3; }
    n=$((n+1))
  done < "$work/manifest.tsv"
  [ "$n" -eq 15 ] || { boot_fail PACKAGE_INCOMPLETE 'Пакет неполный; запуск запрещён.' 'Incomplete package; execution blocked.';return 3; }
  for name in common.sh profile.sh net.sh report.sh recovery.sh run.sh;do /bin/bash -n "$work/$name" || { boot_fail PACKAGE_SYNTAX_FAILED "Ошибка синтаксиса: $name." "Syntax error: $name.";return 3; };done
  export MACDIAG_CODE_REF=$ref MACDIAG_PACKAGE_WORK=$work MACDIAG_RELEASE_VERSION=$version
  # exec keeps the PID/TTY: Ctrl+C reaches the runner directly, no orphan launcher.
  # Validated source cache is retained in /tmp for investigation, not user payloads.
  if command -v caffeinate >/dev/null 2>&1;then caffeinate -di -w $$ > "$work/caffeinate.log" 2>&1 & fi
  trap - EXIT INT TERM HUP
  if ( : </dev/tty ) 2>/dev/null;then exec /bin/bash "$work/run.sh" "$mode" </dev/tty
  else exec /bin/bash "$work/run.sh" "$mode";fi
}
macdiag_launch "$@"
exit $?
}
