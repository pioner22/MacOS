#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Library: every retry owns a new stream, counter, hash, and HTTP header file.
net_attempt(){
  local url expected size range total work crc ccr hrc got count http cr encoding
  local -a extra codes
  url=$1; expected=$2; size=$3; range=${4:-}; total=${5:-}
  case "$url" in https://*) ;; *) NET_REASON=HTTPS_REQUIRED; return 3;; esac
  case "$expected" in *[!a-f0-9]*|'') NET_REASON=INVALID_SHA; return 3;; esac
  [ "${#expected}" = 64 ] && valid_uint "$size" 1 999999999 || { NET_REASON=INVALID_SPEC; return 3; }
  if [ -n "$range" ]; then
    local first last
    first=${range%-*}; last=${range#*-}
    valid_uint "$first" 0 999999999 && valid_uint "$last" 0 999999999 &&
      valid_uint "$total" 1 999999999 && [ "$last" -ge "$first" ] &&
      [ "$last" -lt "$total" ] && [ $((last-first+1)) -eq "$size" ] || { NET_REASON=INVALID_RANGE_SPEC; return 3; }
  fi
  work=$(mktemp -d "$STEP_DIR/transfer.XXXXXX") || return 3
  extra=()
  [ -z "$range" ] || extra=(-r "$range")
  say "TRANSFER_START url=$url expected_bytes=$size range=$range"
  # Do not add --retry here: output cannot be rolled back inside a pipe.
  "${DIAG_CURL:-curl}" -q -fsSL --retry 0 --proto '=https' --proto-redir '=https' --max-redirs 5 \
    --connect-timeout 15 --max-time "${NET_TIMEOUT:-1800}" --speed-time 30 --speed-limit 1024 \
    -H 'Accept-Encoding: identity' -D "$work/headers" "${extra[@]}" "$url" 2>"$work/curl.err" |
    "${DIAG_PERL:-perl}" "$ROOT/count_stream.pl" "$size" "$work/count" |
    "${SHA_CMD[@]}" > "$work/hash"
  codes=("${PIPESTATUS[@]}"); crc=${codes[0]:-99}; ccr=${codes[1]:-99}; hrc=${codes[2]:-99}
  cat "$work/curl.err"
  count=$(cat "$work/count" 2>/dev/null); got=$(awk 'NR==1{print $1}' "$work/hash")
  http=$(awk '/^HTTP\//{x=$2}END{print x}' "$work/headers")
  cr=$(awk 'BEGIN{IGNORECASE=0} /^HTTP\//{x=""} tolower($1)=="content-range:"{sub(/^[^:]*:[ \t]*/,"");sub(/\r$/,"");x=$0} END{print x}' "$work/headers")
  encoding=$(awk '/^HTTP\//{x=""} tolower($1)=="content-encoding:"{sub(/^[^:]*:[ \t]*/,"");sub(/\r$/,"");x=tolower($0)} END{print x}' "$work/headers")
  say "TRANSFER_END curl=$crc counter=$ccr hash_rc=$hrc http=$http bytes=$count sha256=$got"
  NET_CURL=$crc; NET_REASON=UNKNOWN
  case "$http" in
    408|429|500|502|503|504) NET_REASON="HTTP_TRANSIENT_$http"; return 3;;
    4??|5??) NET_REASON=REMOTE_ASSET_UNAVAILABLE; return 3;;
  esac
  if [ -n "$encoding" ] && [ "$encoding" != identity ]; then NET_REASON=UNEXPECTED_CONTENT_ENCODING; return 3;fi
  if [ "$hrc" -ne 0 ] || { [ "$ccr" -ne 0 ] && [ "$ccr" -ne 4 ]; }; then NET_REASON=LOCAL_STREAM_TOOL_ERROR; return 3; fi
  if [ -n "$range" ] && [ "$http" = 200 ]; then NET_REASON=RANGE_NOT_SUPPORTED; return 3; fi
  if [ "$ccr" = 4 ]; then NET_REASON=BODY_TOO_LONG; return 2; fi
  if [ "$crc" -ne 0 ]; then
    case "$crc" in 2|3|4|23|26|27|48) NET_REASON=LOCAL_CURL_OR_TOOL_ERROR; return 3;;
      *) NET_REASON="TRANSFER_FAILED_CURL_$crc"; return 3;; esac
  fi
  if [ -n "$range" ]; then
    if [ "$http" != 206 ] || [ "$cr" != "bytes $range/$total" ]; then NET_REASON=CONTENT_RANGE_INVALID; return 2; fi
  elif [ "$http" != 200 ]; then NET_REASON=HTTP_UNEXPECTED; return 3; fi
  [ "$count" = "$size" ] || { NET_REASON=SIZE_MISMATCH; return 2; }
  [ "$got" = "$expected" ] || { NET_REASON=SHA256_MISMATCH; return 2; }
  NET_REASON=VERIFIED; return 0
}
net_check(){
  local url expected size range total attempt rc had_failure=0
  url=$1; expected=$2; size=$3; range=${4:-}; total=${5:-}
  for attempt in 1 2; do
    net_attempt "$url" "$expected" "$size" "$range" "$total"; rc=$?
    say "ATTEMPT=$attempt RESULT_CODE=$rc REASON=$NET_REASON"
    if [ "$rc" -eq 0 ]; then
      if [ "$had_failure" = 1 ]; then NET_REASON=RECOVERED_TRANSFER_NOT_CLEAN; return 3; fi
      return 0
    fi
    [ "$rc" -ne 2 ] || return 2
    case "$NET_REASON" in
      HTTP_TRANSIENT_*|TRANSFER_FAILED_CURL_5|TRANSFER_FAILED_CURL_6|TRANSFER_FAILED_CURL_7|TRANSFER_FAILED_CURL_18|TRANSFER_FAILED_CURL_28|TRANSFER_FAILED_CURL_35|TRANSFER_FAILED_CURL_52|TRANSFER_FAILED_CURL_55|TRANSFER_FAILED_CURL_56)
        had_failure=1; [ "$attempt" = 2 ] || sleep 1;;
      *) return "$rc";;
    esac
  done
  return 3
}
download_main(){
  local base size sha file repeats i rc failures=0 incomplete=0 done_count=0 http
  need perl && need curl && select_hash || { unknown STREAM_DEPENDENCIES_UNAVAILABLE; return 3; }
  base='https://github.com/pioner22/MacOS/releases/download/diagnostic-fixtures-v1'
  http=$("${DIAG_CURL:-curl}" -q -sSLI --retry 0 --proto '=https' --proto-redir '=https' --max-redirs 5 --connect-timeout 15 --max-time 45 -o /dev/null -w '%{http_code}' "$base/nettest-001MiB.bin"); rc=$?
  if [ "$rc" -eq 0 ] && [ "$http" = 200 ]; then
    while read -r size sha file repeats; do
      for ((i=1;i<=repeats;i++)); do
        net_check "$base/$file" "$sha" "$size"; rc=$?
        done_count=$((done_count+1))
        if [ "$rc" -eq 2 ];then
          say "DOWNLOAD_STOP reason=$NET_REASON completed_attempts=$done_count"
          fault DOWNLOAD_PATH_FAILURE;return 2
        fi
        case "$rc" in 0) ;;2) failures=$((failures+1));;*) incomplete=$((incomplete+1));;esac
      done
    done < "$ROOT/fixtures.txt"
    net_check "$base/nettest-512MiB.bin" 6b2bd172178b6e8a4d992581273e7962efe0ec8066e6204537fe27a34b7d940c 16777216 268435456-285212671 536870912
    rc=$?;case "$rc" in 0) ;;2) failures=$((failures+1));;*) incomplete=$((incomplete+1));;esac
  else
    say "OWN_FIXTURE_UNAVAILABLE curl=$rc http=$http"
    say 'RU: Свой Release недоступен. Резервные загрузки не заменяют проверку всех размеров и Range.'
    say 'EN: Dedicated release unavailable. Fallback downloads cannot validate every size and Range.'
    incomplete=$((incomplete+1))
    base='https://github.com/PowerShell/PowerShell/releases/download/v7.6.6'
    net_check "$base/PowerShell-7.6.6-win-fxdependent.zip" ea3c73ac3bf7afa07432c65b8d9f16b8945befa216cec38a51b6e213dc8fa709 23012318
    rc=$?
    if [ "$rc" -eq 2 ];then
      say "DOWNLOAD_STOP reason=$NET_REASON completed_attempts=1"
      fault DOWNLOAD_PATH_FAILURE;return 2
    fi
    case "$rc" in 0) ;;*) incomplete=$((incomplete+1));;esac
    net_check "$base/powershell-7.6.6-osx-x64.pkg" 68fd85010f02e5e16634f811da8d72a5ee58e01c24b353df5bf4acd3a645f56e 75026625
    rc=$?;case "$rc" in 0) ;;2) failures=$((failures+1));;*) incomplete=$((incomplete+1));;esac
    done_count=2
  fi
  say "DOWNLOAD_SUMMARY full_transfers=$done_count failures=$failures incomplete=$incomplete"
  [ "$failures" -eq 0 ] || { fault DOWNLOAD_PATH_FAILURE; return 2; }
  [ "$incomplete" -eq 0 ] || { unknown DOWNLOAD_COVERAGE_INCOMPLETE_OR_RECOVERED; return 3; }
  passed DOWNLOAD_AND_RANGE_VERIFIED
}
network_main(){
  local url i out rc code failures=0
  need curl || { unknown CURL_UNAVAILABLE; return 3; }
  for url in https://github.com/ https://raw.githubusercontent.com/pioner22/MacOS/main/README.md https://www.apple.com/; do
    for i in 1 2 3; do
      out=$("${DIAG_CURL:-curl}" -q -sSLI --retry 0 --proto '=https' --proto-redir '=https' --max-redirs 5 --connect-timeout 15 --max-time 45 -o /dev/null -w 'http=%{http_code} dns=%{time_namelookup} tcp=%{time_connect} tls=%{time_appconnect} total=%{time_total} verify=%{ssl_verify_result}' "$url" 2>&1); rc=$?
      say "PROBE url=$url run=$i curl=$rc $out"
      code=$(printf '%s\n' "$out" | sed -n 's/.*http=\([0-9][0-9][0-9]\).*/\1/p')
      if [ "$rc" -ne 0 ] || [ "$code" != 200 ]; then failures=$((failures+1)); fi
    done
  done
  say 'SCOPE=HTTPS_ENDPOINTS_ONLY Apple_installer_payload=NOT_TESTED WiFi_disconnect_counter=NOT_MEASURED'
  [ "$failures" -eq 0 ] || { unknown HTTPS_REACHABILITY_UNAVAILABLE; return 3; }
  passed HTTPS_ENDPOINT_PROBES
}
