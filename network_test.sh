#!/bin/bash
# Network/TLS/integrity test for macOS Recovery.
# Streams known GitHub bytes directly to SHA-256 (no internal SSD writes) and probes Apple CDN.
set +u
export LC_ALL=C
LOG='/tmp/network-test.log'
: > "$LOG"
say(){ printf '%s\n' "$*" | tee -a "$LOG"; }
fail(){ say "STOP: $*"; exit 1; }
for c in curl awk tee date; do command -v "$c" >/dev/null 2>&1 || fail "missing command: $c"; done
if command -v sha256sum >/dev/null 2>&1; then SHA=sha256sum
elif command -v shasum >/dev/null 2>&1; then SHA=shasum
else fail 'no SHA-256 tool'; fi

GH_URL='https://github.com/llvm/llvm-project/releases/download/llvmorg-23.1.1/clang%2Bllvm-23.1.1-aarch64-pc-windows-msvc.tar.zst'
GH_EXPECT='0f9d0308a93b76318eae633806eddbec098fb96f27a706fed5ada399f9e391b5'
GH_BYTES=425456048
APPLE_URL='https://swcdn.apple.com/content/downloads/37/33/140-93587-A_GRFFH93NOL/f944yaqo1cjhh2m0kxrl0zhcpg9yb9qphv/InstallAssistant.pkg'

say '============================================================'
say 'MODE=NETWORK_TLS_INTEGRITY_V1'
say 'INTERNAL_SSD_WRITE=NONE'
say 'GitHub: 3 full known-hash streams; Apple CDN: repeated HTTPS/TLS header probes.'
say '============================================================'

ERR=0
if command -v ping >/dev/null 2>&1; then
  say 'PING_GITHUB_START'
  ping -c 10 github.com 2>&1 | tee -a "$LOG" || ERR=$((ERR+1))
  say 'PING_APPLE_CDN_START'
  ping -c 10 swcdn.apple.com 2>&1 | tee -a "$LOG" || true
fi

say 'APPLE_CDN_PROBES_START'
I=1
while [ "$I" -le 20 ]; do
  OUT=$(curl -sSIL --http1.1 --tlsv1.2 --connect-timeout 15 --max-time 45 -o /dev/null -w 'http=%{http_code} remote=%{remote_ip} tls=%{ssl_verify_result} connect=%{time_connect} start=%{time_starttransfer} total=%{time_total}' "$APPLE_URL" 2>&1)
  RC=$?
  say "APPLE_PROBE n=$I curl=$RC $OUT"
  [ "$RC" -eq 0 ] || ERR=$((ERR+1))
  I=$((I+1))
done

say 'GITHUB_GROUND_TRUTH_STREAMS_START'
I=1
while [ "$I" -le 3 ]; do
  HF="/tmp/net-hash-$$"
  : > "$HF"
  if [ "$SHA" = sha256sum ]; then
    curl -fL --http1.1 --tlsv1.2 --retry 2 --connect-timeout 20 --max-time 1800 "$GH_URL" 2>>"$LOG" | sha256sum > "$HF"
  else
    curl -fL --http1.1 --tlsv1.2 --retry 2 --connect-timeout 20 --max-time 1800 "$GH_URL" 2>>"$LOG" | shasum -a 256 > "$HF"
  fi
  P=("${PIPESTATUS[@]}"); CRC=${P[0]:-99}; HRC=${P[1]:-99}
  GOT=$(awk '{print $1}' "$HF"); rm -f "$HF"
  if [ "$CRC" -eq 0 ] && [ "$HRC" -eq 0 ] && [ "$GOT" = "$GH_EXPECT" ]; then
    say "GITHUB_STREAM_PASS n=$I sha256=$GOT expected_bytes=$GH_BYTES"
  else
    say "GITHUB_STREAM_FAIL n=$I curl=$CRC hash_rc=$HRC got=$GOT expected=$GH_EXPECT"
    ERR=$((ERR+1))
  fi
  I=$((I+1))
done

if [ "$ERR" -eq 0 ]; then
  say 'FINAL=PASS_NETWORK_TLS_AND_STREAM_INTEGRITY'
  exit 0
else
  say "FINAL=FAIL_OR_UNSTABLE_NETWORK_PATH errors=$ERR"
  exit 2
fi
