#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
D_ROOT=$(cd "$(dirname "$0")/../.." && pwd -P) || exit 3
. "$D_ROOT/diagnostics/v2/core.sh"
D_WORK=$1;D_LOG="$D_WORK/network-detail.log"
: > "$D_LOG" || exit 3
n_probe_all(){
  local url i status rc bad=0 missing=0
  for url in https://github.com/ https://www.apple.com/;do
    for i in 1 2 3;do
      status=$(curl -q -sSIL --proto '=https' --proto-redir '=https' --max-redirs 5 --retry 0 --connect-timeout 15 --max-time 45 -o /dev/null -w '%{http_code} dns=%{time_namelookup} connect=%{time_connect} tls=%{time_appconnect} total=%{time_total}' "$url" 2>> "$D_WORK/network.stderr")
      rc=$?;d_log "HTTPS url=$url run=$i curl=$rc $status"
      if [ "$rc" -ne 0 ];then bad=1
      else case "$status" in 2[0-9][0-9]' '*) :;;*) missing=1;;esac;fi
    done
  done
  if [ "$bad" -ne 0 ];then d_result FAIL 2 HTTPS_REACHABILITY 'Сбой HTTPS-пути. Смотрите curl-код; сравните другую сеть. Это не доказательство поломки адаптера.' 'HTTPS-path failure. Inspect curl codes and compare another network; adapter failure is not established.'
  elif [ "$missing" -ne 0 ];then d_result INCONCLUSIVE 3 HTTP_ENDPOINT 'Сервер ответил неожиданным HTTP-кодом.' 'Endpoint returned an unexpected HTTP code.'
  else d_result PASS 0 HTTPS_SMALL_PROBES 'Малые HTTPS-запросы прошли. Загрузка установщика Apple этим не проверена.' 'Small HTTPS probes passed. This does not verify an Apple installer download.';fi
}
n_probe_all;rc=$?
[ "$rc" -ne 0 ] || echo ENGINE_COMPLETE=NETWORK_PASS
exit "$rc"
