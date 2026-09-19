#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
D_ROOT=$(cd "$(dirname "$0")/../.." && pwd -P) || exit 3
. "$D_ROOT/diagnostics/v2/core.sh"
. "$D_ROOT/diagnostics/v2/net.sh"
D_WORK=$1; limit=$2; D_LOG="$D_WORK/network-detail.log"
d_num "$limit" 1 512 || exit 3
: > "$D_LOG" || exit 3
d_hash_ready || exit 3
base=https://github.com/pioner22/MacOS/releases/download/diagnostic-fixtures-v1
status=$(curl -q -sSIL --proto '=https' --proto-redir '=https' --retry 0 --connect-timeout 15 --max-time 45 -o /dev/null -w '%{http_code}' "$base/nettest-001MiB.bin" 2> "$D_WORK/fixture-probe.stderr")
probe_rc=$?
if [ "$probe_rc" -eq 0 ] && [ "$status" = 200 ]; then
  d_log 'FIXTURE_SOURCE=OWN_GITHUB_RELEASE'
  n_plan "$D_ROOT/diagnostics/v2/network-fixtures.tsv" "$base" "$limit"; a=$?
  [ "$a" -eq 130 ] && exit 130
  b=0
  if [ "$limit" -ge 512 ];then
    n_stream RANGE_MID "$base/nettest-512MiB.bin" 6b2bd172178b6e8a4d992581273e7962efe0ec8066e6204537fe27a34b7d940c 16777216 1 268435456 285212671 536870912; b=$?
    d_log 'RANGE_SCOPE=PARTIAL_GET_NOT_RESUME_REASSEMBLY'
  fi
  d_aggregate "$a" "$b"; rc=$?
else
  d_log "OWN_FIXTURES=UNAVAILABLE curl=$probe_rc http=$status"
  d_log 'RU: Основные эталоны недоступны. Резервные загрузки проверяются отдельно; неполное покрытие не скрывается.'
  d_log 'EN: Dedicated fixtures are unavailable. Fallback transfers are checked separately; incomplete coverage is retained.'
  base=https://github.com/PowerShell/PowerShell/releases/download/v7.6.6
  n_stream PS_23M "$base/PowerShell-7.6.6-win-fxdependent.zip" ea3c73ac3bf7afa07432c65b8d9f16b8945befa216cec38a51b6e213dc8fa709 23012318 1; a=$?
  n_stream PS_75M "$base/powershell-7.6.6-osx-x64.pkg" 68fd85010f02e5e16634f811da8d72a5ee58e01c24b353df5bf4acd3a645f56e 75026625 1; b=$?
  d_aggregate "$a" "$b" 3; rc=$?
fi
if [ "$rc" -eq 0 ];then echo 'ENGINE_COMPLETE=DOWNLOAD_PASS'
elif [ "$rc" -eq 2 ];then echo 'ENGINE_COMPLETE=DOWNLOAD_FAILED attribution=UNCONFIRMED'
else echo 'ENGINE_COMPLETE=DOWNLOAD_INCOMPLETE';fi
exit "$rc"
