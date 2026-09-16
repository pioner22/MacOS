#!/bin/bash
# Network/DNS/TLS connectivity test for macOS Recovery. No large file download.
set +u
export LC_ALL=C
LOG='/tmp/network-test.log'; : > "$LOG"
say(){ printf '%s\n' "$*" | tee -a "$LOG"; }
for c in curl awk tee date; do command -v "$c" >/dev/null 2>&1 || { say "RESULT=INCONCLUSIVE missing_tool=$c"; exit 3; }; done
APPLE_URL='https://swcdn.apple.com/content/downloads/37/33/140-93587-A_GRFFH93NOL/f944yaqo1cjhh2m0kxrl0zhcpg9yb9qphv/InstallAssistant.pkg'
GH_URL='https://github.com/'
ERR=0
say '============================================================'
say 'MODE=NETWORK_CONNECTIVITY_TLS_V2'
say 'RU: Проверка DNS/ICMP/TCP/TLS/HTTP без больших загрузок.'
say 'EN: DNS/ICMP/TCP/TLS/HTTP connectivity test without large downloads.'
say 'INTERNAL_SSD_WRITE=NONE'
say '============================================================'

if command -v scutil >/dev/null 2>&1; then
  say 'NETWORK_STATE_BEGIN'; scutil --nwi 2>&1 | tee -a "$LOG"; say 'NETWORK_STATE_END'
fi
if command -v ifconfig >/dev/null 2>&1; then
  say 'INTERFACES_BEGIN'; ifconfig 2>&1 | tee -a "$LOG"; say 'INTERFACES_END'
fi
if command -v route >/dev/null 2>&1; then
  say 'DEFAULT_ROUTE_BEGIN'; route -n get default 2>&1 | tee -a "$LOG"; say 'DEFAULT_ROUTE_END'
fi
if command -v ping >/dev/null 2>&1; then
  say 'PING_GITHUB_START'; ping -c 10 github.com 2>&1 | tee -a "$LOG" || ERR=$((ERR+1))
  say 'PING_APPLE_START'; ping -c 10 swcdn.apple.com 2>&1 | tee -a "$LOG" || true
fi

probe(){
  LABEL=$1; URL=$2; COUNT=$3; I=1
  while [ "$I" -le "$COUNT" ]; do
    OUT=$(curl -sSIL --http1.1 --tlsv1.2 --connect-timeout 15 --max-time 45 -o /dev/null -w 'http=%{http_code} remote=%{remote_ip} tls=%{ssl_verify_result} dns=%{time_namelookup} connect=%{time_connect} start=%{time_starttransfer} total=%{time_total}' "$URL" 2>&1)
    RC=$?
    say "${LABEL}_PROBE n=$I curl=$RC $OUT"
    [ "$RC" -eq 0 ] || ERR=$((ERR+1))
    I=$((I+1))
  done
}
probe APPLE "$APPLE_URL" 20
probe GITHUB "$GH_URL" 10

if [ "$ERR" -eq 0 ]; then
  say 'RESULT=PASS'
  say 'RU: DNS/TCP/TLS/HTTP-путь во время теста работал стабильно.'
  say 'EN: DNS/TCP/TLS/HTTP path was stable during the test.'
  say 'NEXT_RU: Для проверки целостности больших загрузок отдельно запустите DOWNLOAD TEST.'
  say 'NEXT_EN: Run DOWNLOAD TEST separately to verify large-transfer byte integrity.'
  exit 0
else
  say "RESULT=FAIL errors=$ERR"
  say 'RU: Зафиксированы ошибки соединения/DNS/TLS/HTTP или потеря доступности.'
  say 'EN: Connectivity/DNS/TLS/HTTP failures or loss of reachability were recorded.'
  say 'NEXT_RU: Повторите через Ethernet/другую сеть. Если ошибки сохраняются на разных сетях, проверяйте Recovery/T2/firmware/RAM.'
  say 'NEXT_EN: Retry over Ethernet/another network. If failures persist across networks, investigate Recovery/T2/firmware/RAM.'
  exit 2
fi
