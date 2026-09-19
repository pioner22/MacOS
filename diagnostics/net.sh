#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Every attempt has a fresh hash process. Never retry inside a payload pipe.
net_headers() {
    local f=$1
    awk '
      /^HTTP\// {status=$2; range=""; encoding=""}
      tolower($0) ~ /^content-range:/ {sub(/^[^:]*:[ \t]*/,"");sub(/\r$/,"");range=$0}
      tolower($0) ~ /^content-encoding:/ {sub(/^[^:]*:[ \t]*/,"");sub(/\r$/,"");encoding=tolower($0)}
      END{printf "%s\n%s\n%s\n",status,range,encoding}
    ' "$f"
}
net_reason() {
    case "$1" in
      5|6) printf DNS_ERROR;; 7) printf CONNECT_ERROR;; 28) printf TIMEOUT;;
      35|51|58|60|77|83|90|91) printf TLS_ERROR;;
      22) printf HTTP_ERROR;; 18) printf TRUNCATED_TRANSFER;;
      23) printf LOCAL_WRITE_ERROR;; 56) printf RECEIVE_ERROR;;
      0) printf OK;; *) printf 'CURL_ERROR_%s' "$1";;
    esac
}
net_stream() {
    local label=$1 url=$2 expected=$3 bytes=$4 attempt=$5
    local start=${6:-} end=${7:-} total=${8:-}
    local h count headers err status range encoding got n rc=0
    local p=() opts=()
    case "$url" in https://*) ;; *) return 3;; esac
    [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || return 3
    diag_uint "$attempt" 1 100 || return 3
    case "$bytes" in ''|*[!0-9]*) return 3;; esac
    [ "$bytes" -gt 0 ] && [ "$bytes" -le 2147483648 ] || return 3
    h="$DIAG_RUN/stream.sha"; count="$DIAG_RUN/stream.count"
    headers="$DIAG_RUN/stream.headers"; err="$DIAG_RUN/stream.stderr"
    : > "$count"; : > "$h"; : > "$headers"; : > "$err"
    if [ -n "$start" ]; then
        case "$start:$end:$total" in *[!0-9:]*) return 3;; esac
        [ -n "$end" ] && [ -n "$total" ] || return 3
        [ "$end" -ge "$start" ] && [ "$end" -lt "$total" ] && [ $((end-start+1)) -eq "$bytes" ] || return 3
        opts=(-r "$start-$end")
    fi
    diag_log "DOWNLOAD_START asset=$label attempt=$attempt expected_bytes=$bytes"
    curl -q -fsSL --proto '=https' --proto-redir '=https' --max-redirs 5 \
      --retry 0 --connect-timeout 20 --max-time 1800 \
      -H 'Accept-Encoding: identity' -D "$headers" "${opts[@]}" "$url" 2> "$err" |
      perl "$MACDIAG_ROOT/diagnostics/count_stream.pl" "$count" "$bytes" |
      diag_sha > "$h"
    p=("${PIPESTATUS[@]}")
    n=$(cat "$count"); read -r got _ < "$h"
    net_headers "$headers" > "$DIAG_RUN/parsed.headers"
    { IFS= read -r status; IFS= read -r range; IFS= read -r encoding; } < "$DIAG_RUN/parsed.headers"
    diag_log "TRANSFER asset=$label attempt=$attempt curl=${p[0]} counter=${p[1]} sha=${p[2]} http=$status bytes=$n digest=$got"
    if [ -n "$start" ] && [ "$status" = 200 ]; then
        diag_log 'OBSERVED=RANGE_NOT_SUPPORTED'; return 3
    fi
    if [ "${p[1]}" -eq 4 ]; then
        diag_log 'OBSERVED=BODY_EXCEEDS_EXPECTED_LENGTH'; return 2
    fi
    if [ "${p[0]}" -ne 0 ]; then
        diag_log "OBSERVED=$(net_reason "${p[0]}")"
        case "${p[0]}" in
          18|56) case "$n" in ''|*[!0-9]*) :;; *)
            [ "$n" -ge "$bytes" ] || diag_log 'OBSERVED=TRUNCATED_TRANSFER';;
          esac;;
        esac
        case "${p[0]}" in 1|2|3|4|23|26|27) return 3;; esac
        # Missing/blocked remote fixtures cannot diagnose client hardware.
        case "$status" in 401|403|404|429) return 3;; esac
        return 2
    fi
    [ "${p[1]}" -eq 0 ] && [ "${p[2]}" -eq 0 ] || return 3
    [ "$n" = "$bytes" ] || { diag_log 'OBSERVED=CONTENT_LENGTH_MISMATCH'; return 2; }
    [ -z "$encoding" ] || [ "$encoding" = identity ] || { diag_log 'OBSERVED=UNEXPECTED_CONTENT_ENCODING'; return 3; }
    if [ -n "$start" ]; then
        [ "$status" = 206 ] || { diag_log 'OBSERVED=RANGE_NOT_SUPPORTED'; return 3; }
        [ "$range" = "bytes $start-$end/$total" ] || { diag_log 'OBSERVED=CONTENT_RANGE_MISMATCH'; return 2; }
    else
        [ "$status" = 200 ] || { diag_log 'OBSERVED=UNEXPECTED_HTTP_STATUS'; return 3; }
    fi
    [ "$got" = "$expected" ] || { diag_log 'OBSERVED=SHA256_MISMATCH'; return 2; }
    diag_log "TRANSFER_PASS asset=$label attempt=$attempt bytes=$n sha256=$got"
    return 0
}
net_plan() {
    local manifest=$1 max_mib=$2 base=$3
    local size bytes expected name repeat i rc=0 rows=0 missing=0 bad=0
    while IFS=$'\t' read -r size bytes expected name; do
        case "$size" in size_mib|'') continue;; esac
        case "$size" in *[!0-9]*) continue;; esac
        [ "$size" -le "$max_mib" ] || continue
        diag_uint "$size" 1 1024 || return 3
        [[ "$name" =~ ^nettest-[0-9][0-9][0-9]MiB\.bin$ ]] || return 3
        [ "$bytes" = $((size*1048576)) ] || return 3
        case "$size" in 1) repeat=5;; 8) repeat=4;; 32) repeat=3;; 128|512) repeat=2;; *) return 3;; esac
        rows=$((rows+1)); i=1
        while [ "$i" -le "$repeat" ]; do
            net_stream "$name" "$base/$name" "$expected" "$bytes" "$i"; rc=$?
            case "$rc" in 0) :;; 2) bad=1;; *) missing=1;; esac
            [ "$rc" -eq 0 ] || break
            i=$((i+1))
        done
    done < "$manifest"
    [ "$rows" -gt 0 ] || return 3
    [ "$bad" -eq 0 ] || return 2
    [ "$missing" -eq 0 ] || return 3
}
