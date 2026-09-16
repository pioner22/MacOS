#!/bin/bash
# Network/DNS/TLS/integrity stress for macOS Recovery/full macOS.
# Uses dedicated deterministic GitHub Release fixtures when available.
set +u
export LC_ALL=C
LOG='/tmp/network-test.log'; : > "$LOG"
say(){ printf '%s\n' "$*" | tee -a "$LOG"; }
for c in curl awk tee date rm; do command -v "$c" >/dev/null 2>&1 || { say "RESULT=INCONCLUSIVE missing_tool=$c"; exit 3; }; done
if command -v sha256sum >/dev/null 2>&1; then SHA=sha256sum
elif command -v shasum >/dev/null 2>&1; then SHA=shasum
else say 'RESULT=INCONCLUSIVE no_sha256_tool'; exit 3; fi

APPLE_URL='https://swcdn.apple.com/content/downloads/37/33/140-93587-A_GRFFH93NOL/f944yaqo1cjhh2m0kxrl0zhcpg9yb9qphv/InstallAssistant.pkg'
GH_URL='https://github.com/'
FIXBASE='https://github.com/pioner22/MacOS/releases/download/diagnostic-fixtures-v1'
ERR=0
STREAMS=0
BYTES_EXPECTED=0

say '============================================================'
say 'MODE=NETWORK_MULTI_SIZE_INTEGRITY_V3'
say 'RU: DNS/TCP/TLS + GitHub-файлы 1/8/32/128/512 MiB с известным SHA-256.'
say 'EN: DNS/TCP/TLS + 1/8/32/128/512 MiB GitHub fixtures with known SHA-256.'
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
    OUT=$(curl -sSIL --http1.1 --tlsv1.2 --connect-timeout 15 --max-time 45 -o /dev/null -w 'http=%{http_code} remote=%{remote_ip} tls=%{ssl_verify_result} dns=%{time_namelookup} connect=%{time_connect} start=%{time_starttransfer} total=%{time_total}' "$URL" 2>&1)
    RC=$?
    say "${LABEL}_PROBE n=$I curl=$RC $OUT"
    [ "$RC" -eq 0 ] || ERR=$((ERR+1))
    I=$((I+1))
  done
}
probe APPLE "$APPLE_URL" 20
probe GITHUB "$GH_URL" 10

fixture_stream(){
  SIZE=$1; EXPECT=$2; RUNS=$3
  NAME=$(printf 'nettest-%03dMiB.bin' "$SIZE")
  URL="$FIXBASE/$NAME"
  I=1
  while [ "$I" -le "$RUNS" ]; do
    HF="/tmp/net-fixture-hash-$$-$SIZE-$I"; : > "$HF"
    say "FIXTURE_START size_mib=$SIZE run=$I/$RUNS url=$URL"
    if [ "$SHA" = sha256sum ]; then
      curl -fL --http1.1 --tlsv1.2 --retry 2 --connect-timeout 20 --max-time 3600 "$URL" 2>>"$LOG" | sha256sum > "$HF"
    else
      curl -fL --http1.1 --tlsv1.2 --retry 2 --connect-timeout 20 --max-time 3600 "$URL" 2>>"$LOG" | shasum -a 256 > "$HF"
    fi
    P=("${PIPESTATUS[@]}"); GOT=$(awk '{print $1}' "$HF"); rm -f "$HF"
    STREAMS=$((STREAMS+1)); BYTES_EXPECTED=$((BYTES_EXPECTED+SIZE*1048576))
    if [ "${P[0]:-99}" -eq 0 ] && [ "${P[1]:-99}" -eq 0 ] && [ "$GOT" = "$EXPECT" ]; then
      say "FIXTURE_PASS size_mib=$SIZE run=$I sha256=$GOT"
    else
      say "FIXTURE_FAIL size_mib=$SIZE run=$I curl=${P[0]:-99} hash_rc=${P[1]:-99} got=$GOT expected=$EXPECT"
      ERR=$((ERR+1))
    fi
    I=$((I+1))
  done
}

# Dedicated fixtures are optional until the release is published.
FIXTURE_READY=0
curl -fsIL --http1.1 --tlsv1.2 --connect-timeout 15 --max-time 45 "$FIXBASE/nettest-001MiB.bin" >/dev/null 2>>"$LOG" && FIXTURE_READY=1
if [ "$FIXTURE_READY" -eq 1 ]; then
  say 'FIXTURE_RELEASE=AVAILABLE'
  fixture_stream 1   '85c3ea1f26f1a18ba9c7b1adb12ca91a157ad1330c5d1fe3d542cfee13b4e7a8' 5
  fixture_stream 8   '9bedc7cb90624f439e2baffd0ce25d69682da41aa2b521e26c879059cfc85949' 4
  fixture_stream 32  '5aa0f6b39ed47a7a648b17d92daa61bc7ec25a1c46ecabd2f2c757f820cd7a38' 3
  fixture_stream 128 'a18494ea78d4e7a610cc165ff66b4d7caf8db32aebb6b7b289e89d9207409e7c' 2
  fixture_stream 512 '924d46bc2b284f264d08ac11ed2385723c1b094df2ea8652583b807711083110' 2
else
  say 'FIXTURE_RELEASE=UNAVAILABLE'
  say 'RU: Собственные GitHub Release fixtures ещё не опубликованы; выполняется только connectivity/TLS часть.'
  say 'EN: Dedicated GitHub Release fixtures are not published yet; only connectivity/TLS checks are available.'
fi

say "NETWORK_SUMMARY errors=$ERR fixture_streams=$STREAMS expected_transfer_bytes=$BYTES_EXPECTED"
if [ "$ERR" -eq 0 ]; then
  if [ "$FIXTURE_READY" -eq 1 ]; then
    say 'RESULT=PASS'
    say 'RU: DNS/TCP/TLS и многократные загрузки файлов разного размера прошли без обрывов и SHA-256 совпал.'
    say 'EN: DNS/TCP/TLS and repeated multi-size transfers passed without disconnects or SHA-256 mismatch.'
    say 'NEXT_RU: Если установка macOS всё ещё обрывается, сеть становится менее вероятной; проверяйте RAM/Recovery/T2/firmware.'
    say 'NEXT_EN: If macOS installation still breaks, the network is less likely; investigate RAM/Recovery/T2/firmware.'
  else
    say 'RESULT=INCONCLUSIVE'
    say 'RU: Базовая сеть работает, но большой multi-size integrity test не выполнен без release fixtures.'
    say 'EN: Basic connectivity works, but the large multi-size integrity matrix could not run without release fixtures.'
    exit 3
  fi
  exit 0
else
  say 'RESULT=FAIL'
  say 'RU: Зафиксированы HTTPS/TLS/transfer ошибки или несовпадение SHA-256.'
  say 'EN: HTTPS/TLS/transfer failures or SHA-256 mismatches were recorded.'
  say 'NEXT_RU: Повторите тест через Ethernet и другую сеть. При hash mismatch отдельно перепроверьте RAM.'
  say 'NEXT_EN: Repeat over Ethernet and another network. If hashes mismatch, re-test RAM separately.'
  exit 2
fi
