#!/bin/bash
# Network/DNS/TLS connectivity test for macOS Recovery. No large file download.
set +u
export LC_ALL=C
LOG='/tmp/network-test.log'; : > "$LOG"
say(){ printf '%s\n' "$*" | tee -a "$LOG"; }
for c in curl awk tee date sed tail; do command -v "$c" >/dev/null 2>&1 || { say "RESULT=INCONCLUSIVE missing_tool=$c"; exit 3; }; done
APPLE_URL='https://swcdn.apple.com/content/downloads/37/33/140-93587-A_GRFFH93NOL/f944yaqo1cjhh2m0kxrl0zhcpg9yb9qphv/InstallAssistant.pkg'
GH_URL='https://github.com/'
ERR=0
say '============================================================'
say 'MODE=NETWORK_CONNECTIVITY_TLS_V4'
say 'RU: Проверка DNS/ICMP/TCP/TLS/HTTP без больших загрузок.'
say 'EN: DNS/ICMP/TCP/TLS/HTTP connectivity test without large downloads.'
say 'INTERNAL_SSD_WRITE=NONE'
say '============================================================'

if command -v scutil >/dev/null 2>&1; then say 'NETWORK_STATE_BEGIN'; scutil --nwi 2>&1 | tee -a "$LOG"; say 'NETWORK_STATE_END'; fi
if command -v ifconfig >/dev/null 2>&1; then say 'INTERFACES_BEGIN'; ifconfig 2>&1 | tee -a "$LOG"; say 'INTERFACES_END'; fi
if command -v route >/dev/null 2>&1; then say 'DEFAULT_ROUTE_BEGIN'; route -n get default 2>&1 | tee -a "$LOG"; say 'DEFAULT_ROUTE_END'; fi
if command -v ping >/dev/null 2>&1; then
  say 'PING_GITHUB_START'; ping -c 10 github.com 2>&1 | tee -a "$LOG" || say 'PING_GITHUB=NO_REPLY_OR_ICMP_BLOCKED'
  say 'PING_APPLE_START'; ping -c 10 swcdn.apple.com 2>&1 | tee -a "$LOG" || say 'PING_APPLE=NO_REPLY_OR_ICMP_BLOCKED'
fi

probe(){
  LABEL=$1; URL=$2; COUNT=$3; I=1
  while [ "$I" -le "$COUNT" ]; do
    OUT=$(curl -fsSIL --http1.1 --tlsv1.2 --connect-timeout 15 --max-time 45 -o /dev/null \
      -w 'http=%{http_code} remote=%{remote_ip} tls=%{ssl_verify_result} dns=%{time_namelookup} connect=%{time_connect} start=%{time_starttransfer} total=%{time_total}' "$URL" 2>&1)
    RC=$?
    HTTP=$(printf '%s\n' "$OUT" | sed -n 's/.*http=\([0-9][0-9][0-9]\).*/\1/p' | tail -n 1)
    say "${LABEL}_PROBE n=$I curl=$RC $OUT"
    OK=0
    if [ "$RC" -eq 0 ]; then case "$HTTP" in 2??|3??) OK=1;; esac; fi
    [ "$OK" -eq 1 ] || ERR=$((ERR+1))
    I=$((I+1))
  done
}
probe APPLE "$APPLE_URL" 20
probe GITHUB "$GH_URL" 10

if [ -d /Volumes/RESCUE ] && [ -w /Volumes/RESCUE ]; then
  TS=$(date +%Y%m%d-%H%M%S 2>/dev/null || echo unknown)
  cp "$LOG" "/Volumes/RESCUE/NETWORK-$TS.log" 2>/dev/null || true
  say "LOG_SAVED=/Volumes/RESCUE/NETWORK-$TS.log"
fi

if [ "$ERR" -eq 0 ]; then
  say 'RESULT=PASS'
  say 'RU: DNS/TCP/TLS/HTTP-путь во время теста работал стабильно; HTTP 4xx/5xx также считаются ошибкой probe. Отсутствие ping-ответа само по себе не считается FAIL.'
  say 'EN: DNS/TCP/TLS/HTTP path was stable; HTTP 4xx/5xx are also treated as probe failures. Missing ping replies alone are not treated as FAIL.'
  say 'NEXT_RU: Для проверки целостности больших загрузок отдельно запустите DOWNLOAD TEST.'
  say 'NEXT_EN: Run DOWNLOAD TEST separately to verify large-transfer byte integrity.'
  exit 0
else
  say "RESULT=FAIL errors=$ERR"
  say 'RU: Зафиксированы ошибки DNS/TCP/TLS/HTTP, недоступность endpoint или HTTP 4xx/5xx.'
  say 'EN: DNS/TCP/TLS/HTTP failures, endpoint unavailability, or HTTP 4xx/5xx were recorded.'
  say 'NEXT_RU: Повторите через Ethernet/другую сеть. Если FAIL только у APPLE, проверьте актуальность Apple endpoint; если на разных endpoint/сетях — проверяйте Recovery/T2/firmware/RAM.'
  say 'NEXT_EN: Retry over Ethernet/another network. If only APPLE fails, verify the Apple endpoint; if multiple endpoints/networks fail, investigate Recovery/T2/firmware/RAM.'
  exit 2
fi
