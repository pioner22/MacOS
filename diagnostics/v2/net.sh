#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Fresh curl + counter + SHA process per attempt; no retry in an existing pipe.
n_reason(){
  case "$1" in
    5|6) printf DNS_ERROR;; 7) printf CONNECT_ERROR;; 28) printf TIMEOUT;;
    35|51|58|60|77|83|90|91) printf TLS_ERROR;;
    22) printf HTTP_ERROR;; 18) printf TRUNCATED_TRANSFER;;
    23) printf LOCAL_OUTPUT_ERROR;; 56) printf RECEIVE_ERROR;;
    0) printf OK;; *) printf 'CURL_ERROR_%s' "$1";;
  esac
}
n_headers(){
  awk '/^HTTP\//{s=$2;r="";e=""}
    tolower($0)~/^content-range:/{sub(/^[^:]*:[ \t]*/,"");sub(/\r$/,"");r=$0}
    tolower($0)~/^content-encoding:/{sub(/^[^:]*:[ \t]*/,"");sub(/\r$/,"");e=tolower($0)}
    END{printf "%s\n%s\n%s\n",s,r,e}' "$1"
}
n_stream(){
  local label=$1 url=$2 expected=$3 bytes=$4 attempt=$5
  local start=${6:-} end=${7:-} total=${8:-} timeout=${MACDIAG_TRANSFER_TIMEOUT:-1800}
  local dir got='' actual='' status='' range='' encoding='' now p=() opts=()
  d_num "$timeout" 1 3600 || return 3
  case "$url" in https://*) :;; *) return 3;; esac
  [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || return 3
  d_num "$attempt" 1 100 || return 3
  case "$bytes" in ''|*[!0-9]*) return 3;; esac
  [ ${#bytes} -le 10 ] && [ "$bytes" -gt 0 ] && [ "$bytes" -le 2147483648 ] || return 3
  if [ -n "$start" ]; then
    case "$start:$end:$total" in *[!0-9:]*) return 3;; esac
    [ -n "$end" ] && [ -n "$total" ] && [ ${#total} -le 10 ] && [ ${#start} -le 10 ] && [ ${#end} -le 10 ] || return 3
    [ "$end" -ge "$start" ] && [ "$end" -lt "$total" ] && [ $((end-start+1)) -eq "$bytes" ] || return 3
    opts=(-r "$start-$end")
  fi
  dir=$(mktemp -d "$D_WORK/transfer.XXXXXXXX") || return 3
  : > "$dir/count"; : > "$dir/hash"; : > "$dir/headers"
  now=$(date +%s)
  d_log "DOWNLOAD_START asset=$label attempt=$attempt expected_bytes=$bytes artifacts=$dir"
  curl -q -fsSL --proto '=https' --proto-redir '=https' --max-redirs 5 \
    --retry 0 --connect-timeout 20 --max-time "$timeout" \
    -H 'Accept-Encoding: identity' -D "$dir/headers" "${opts[@]}" "$url" 2> "$dir/curl.stderr" |
    perl "$D_ROOT/diagnostics/v2/count_stream.pl" "$dir/count" "$bytes" |
    d_sha > "$dir/hash"
  p=("${PIPESTATUS[@]}")
  read -r actual < "$dir/count"; read -r got _ < "$dir/hash"
  n_headers "$dir/headers" > "$dir/parsed"
  { IFS= read -r status; IFS= read -r range; IFS= read -r encoding; } < "$dir/parsed"
  d_log "TRANSFER asset=$label attempt=$attempt curl=${p[0]} counter=${p[1]} hash=${p[2]} http=$status actual_bytes=$actual elapsed_s=$(( $(date +%s)-now )) sha256=$got"
  if [ -n "$start" ] && [ "$status" = 200 ]; then d_log 'OBSERVED=RANGE_NOT_SUPPORTED'; return 3; fi
  if [ "${p[1]}" -eq 4 ]; then d_log 'OBSERVED=BODY_TOO_LONG'; return 2; fi
  # Local checker failure has priority: a broken SHA process causes curl EPIPE.
  if [ "${p[1]}" -ne 0 ] || [ "${p[2]}" -ne 0 ]; then d_log 'OBSERVED=LOCAL_CHECKER_FAILURE'; return 3; fi
  if [ "${p[0]}" -ne 0 ]; then
    d_log "OBSERVED=$(n_reason "${p[0]}")"
    case "${p[0]}" in 18|56) case "$actual" in ''|*[!0-9]*) :;;*) [ "$actual" -ge "$bytes" ] || d_log 'OBSERVED=TRUNCATED_TRANSFER';;esac;;esac
    case "${p[0]}" in 1|2|3|4|23|26|27) return 3;; esac
    case "$status" in 401|403|404|429) return 3;; esac
    return 2
  fi
  case "$actual" in ''|*[!0-9]*) d_log 'OBSERVED=INVALID_COUNTER_OUTPUT';return 3;;esac
  [[ "$got" =~ ^[0-9a-f]{64}$ ]] || { d_log 'OBSERVED=INVALID_HASH_OUTPUT';return 3; }
  [ "$actual" = "$bytes" ] || { d_log 'OBSERVED=CONTENT_LENGTH_MISMATCH'; return 2; }
  [ -z "$encoding" ] || [ "$encoding" = identity ] || { d_log 'OBSERVED=UNEXPECTED_CONTENT_ENCODING'; return 3; }
  if [ -n "$start" ]; then
    [ "$status" = 206 ] || { d_log 'OBSERVED=UNEXPECTED_HTTP_STATUS'; return 3; }
    [ "$range" = "bytes $start-$end/$total" ] || { d_log 'OBSERVED=CONTENT_RANGE_MISMATCH'; return 2; }
  else [ "$status" = 200 ] || { d_log 'OBSERVED=UNEXPECTED_HTTP_STATUS'; return 3; }; fi
  [ "$got" = "$expected" ] || { d_log 'OBSERVED=SHA256_MISMATCH'; return 2; }
  d_log "TRANSFER_PASS asset=$label attempt=$attempt bytes=$actual sha256=$got"
  return 0
}
n_plan(){
  local size bytes digest filename reps i rc rows=0 bad=0 missing=0 manifest=$1 base=$2 limit=$3
  while IFS=$'\t' read -r size bytes digest filename; do
    case "$size" in size_mib|'') continue;; *[!0-9]*) continue;; esac
    d_num "$size" 1 512 || return 3
    [ "$size" -le "$limit" ] || continue
    [[ "$filename" =~ ^nettest-[0-9][0-9][0-9]MiB\.bin$ ]] || return 3
    [ "$bytes" = $((size*1048576)) ] || return 3
    case "$size" in 1) reps=5;; 8) reps=4;; 32) reps=3;; 128|512) reps=2;; *) return 3;; esac
    rows=$((rows+1)); i=1
    while [ "$i" -le "$reps" ]; do
      n_stream "$filename" "$base/$filename" "$digest" "$bytes" "$i"; rc=$?
      case "$rc" in 0) :;; 2) bad=1;; 130|143) return 130;; *) missing=1;; esac
      # Still perform an independent second attempt; failed attempts remain failures.
      [ "$rc" -eq 0 ] || [ "$i" -lt 2 ] || break
      i=$((i+1))
    done
  done < "$manifest"
  [ "$bad" -eq 0 ] || return 2
  [ "$missing" -eq 0 ] && [ "$rows" -gt 0 ] || return 3
  return 0
}
