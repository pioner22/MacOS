#!/bin/bash
# Multi-size download integrity test. Payloads stream directly to SHA-256.
set +u
export LC_ALL=C
LOG='/tmp/download-test.log'; : > "$LOG"
say(){ printf '%s\n' "$*" | tee -a "$LOG"; }
for c in curl awk tee rm date; do command -v "$c" >/dev/null 2>&1 || { say "RESULT=INCONCLUSIVE missing_tool=$c"; exit 3; }; done
if command -v sha256sum >/dev/null 2>&1; then SHA=sha256sum
elif command -v shasum >/dev/null 2>&1; then SHA=shasum
else say 'RESULT=INCONCLUSIVE no_sha256_tool'; exit 3; fi

FIXBASE='https://github.com/pioner22/MacOS/releases/download/diagnostic-fixtures-v1'
ERR=0; RUNS=0; BYTES_EXPECTED=0
say '============================================================'
say 'MODE=DOWNLOAD_MULTI_SIZE_INTEGRITY_V4'
say 'RU: Проверка загрузок 1/8/32/128/512 MiB + HTTP Range/resume с точным SHA-256.'
say 'EN: Multi-size 1/8/32/128/512 MiB downloads plus verified HTTP Range/resume checks.'
say 'PAYLOAD_INTERNAL_SSD_WRITE=NONE'
say 'RU: Payload идёт прямо в SHA-256; на внутренний SSD файл payload не сохраняется.'
say 'EN: Payload bytes stream directly into SHA-256 and are not saved as a payload file on the internal SSD.'
say '============================================================'

stream_check(){
  LABEL=$1; URL=$2; EXPECT=$3; BYTES=$4; N=$5
  H="/tmp/download-hash-$$-$N"; : > "$H"
  say "DOWNLOAD_START asset=$LABEL run=$N expected_bytes=$BYTES"
  if [ "$SHA" = sha256sum ]; then
    curl -fL --http1.1 --tlsv1.2 --retry 2 --connect-timeout 20 --max-time 3600 "$URL" 2>>"$LOG" | sha256sum > "$H"
  else
    curl -fL --http1.1 --tlsv1.2 --retry 2 --connect-timeout 20 --max-time 3600 "$URL" 2>>"$LOG" | shasum -a 256 > "$H"
  fi
  P=("${PIPESTATUS[@]}"); GOT=$(awk '{print $1}' "$H"); rm -f "$H"
  RUNS=$((RUNS+1)); BYTES_EXPECTED=$((BYTES_EXPECTED+BYTES))
  if [ "${P[0]:-99}" -eq 0 ] && [ "${P[1]:-99}" -eq 0 ] && [ "$GOT" = "$EXPECT" ]; then
    say "DOWNLOAD_PASS asset=$LABEL run=$N sha256=$GOT"
    return 0
  fi
  say "DOWNLOAD_FAIL asset=$LABEL run=$N curl=${P[0]:-99} hash=${P[1]:-99} got=$GOT expected=$EXPECT"
  return 1
}

range_check(){
  LABEL=$1; URL=$2; START=$3; END=$4; EXPECT=$5; N=$6
  H="/tmp/download-range-hash-$$-$N"; : > "$H"
  BYTES=$((END-START+1))
  say "RANGE_START asset=$LABEL run=$N bytes=$START-$END expected_bytes=$BYTES"
  if [ "$SHA" = sha256sum ]; then
    curl -fL --http1.1 --tlsv1.2 --retry 2 --connect-timeout 20 --max-time 900 -r "$START-$END" "$URL" 2>>"$LOG" | sha256sum > "$H"
  else
    curl -fL --http1.1 --tlsv1.2 --retry 2 --connect-timeout 20 --max-time 900 -r "$START-$END" "$URL" 2>>"$LOG" | shasum -a 256 > "$H"
  fi
  P=("${PIPESTATUS[@]}"); GOT=$(awk '{print $1}' "$H"); rm -f "$H"
  RUNS=$((RUNS+1)); BYTES_EXPECTED=$((BYTES_EXPECTED+BYTES))
  if [ "${P[0]:-99}" -eq 0 ] && [ "${P[1]:-99}" -eq 0 ] && [ "$GOT" = "$EXPECT" ]; then
    say "RANGE_PASS asset=$LABEL run=$N sha256=$GOT"
    return 0
  fi
  say "RANGE_FAIL asset=$LABEL run=$N curl=${P[0]:-99} hash=${P[1]:-99} got=$GOT expected=$EXPECT"
  return 1
}

own_fixture(){
  S=$1; H=$2; CNT=$3
  N=$(printf 'nettest-%03dMiB.bin' "$S")
  I=1
  while [ "$I" -le "$CNT" ]; do
    stream_check "$N" "$FIXBASE/$N" "$H" $((S*1048576)) "$I" || ERR=$((ERR+1))
    I=$((I+1))
  done
}

READY=0
curl -fsIL --http1.1 --tlsv1.2 --connect-timeout 15 --max-time 45 "$FIXBASE/nettest-001MiB.bin" >/dev/null 2>>"$LOG" && READY=1

if [ "$READY" -eq 1 ]; then
  say 'FIXTURE_SOURCE=OWN_GITHUB_RELEASE'
  own_fixture 1   '85c3ea1f26f1a18ba9c7b1adb12ca91a157ad1330c5d1fe3d542cfee13b4e7a8' 5
  own_fixture 8   '9bedc7cb90624f439e2baffd0ce25d69682da41aa2b521e26c879059cfc85949' 4
  own_fixture 32  '5aa0f6b39ed47a7a648b17d92daa61bc7ec25a1c46ecabd2f2c757f820cd7a38' 3
  own_fixture 128 'a18494ea78d4e7a610cc165ff66b4d7caf8db32aebb6b7b289e89d9207409e7c' 2
  own_fixture 512 '924d46bc2b284f264d08ac11ed2385723c1b094df2ea8652583b807711083110' 2

  # 16 MiB range starting at 256 MiB inside the deterministic 512 MiB asset.
  # This tests HTTP Range/partial-transfer behavior used by resume-style download paths.
  RANGE_URL="$FIXBASE/nettest-512MiB.bin"
  RANGE_START=268435456
  RANGE_END=285212671
  RANGE_SHA='6b2bd172178b6e8a4d992581273e7962efe0ec8066e6204537fe27a34b7d940c'
  I=1
  while [ "$I" -le 3 ]; do
    range_check RANGE_512_MID "$RANGE_URL" "$RANGE_START" "$RANGE_END" "$RANGE_SHA" "$I" || ERR=$((ERR+1))
    I=$((I+1))
  done
else
  say 'FIXTURE_SOURCE=FALLBACK_PUBLIC_GITHUB_RELEASES'
  say 'RU: Собственный release ещё недоступен; временно используем публичные GitHub assets с опубликованными SHA-256. Range-test пропускается.'
  say 'EN: Dedicated release is not available yet; using public GitHub assets with published SHA-256. Range test is skipped.'
  stream_check PS_23M 'https://github.com/PowerShell/PowerShell/releases/download/v7.6.6/PowerShell-7.6.6-win-fxdependent.zip' 'ea3c73ac3bf7afa07432c65b8d9f16b8945befa216cec38a51b6e213dc8fa709' 23012318 1 || ERR=$((ERR+1))
  stream_check PS_75M 'https://github.com/PowerShell/PowerShell/releases/download/v7.6.6/powershell-7.6.6-osx-x64.pkg' '68fd85010f02e5e16634f811da8d72a5ee58e01c24b353df5bf4acd3a645f56e' 75026625 1 || ERR=$((ERR+1))
  stream_check PS_106M 'https://github.com/PowerShell/PowerShell/releases/download/v7.6.6/PowerShell-7.6.6-win-x64.zip' '02fe458be20493fbdf43f61ea20610b811ee6c738ab1676c61b9cfcd1a33c860' 106328873 1 || ERR=$((ERR+1))
  stream_check PS_352M 'https://github.com/PowerShell/PowerShell/releases/download/v7.6.6/PowerShell-7.6.6.msixbundle' 'ad992bc654ad8e6fa7070baedfbc0edbf8cab5b6bcb4f9f7a891fd2438fafe4b' 352172261 1 || ERR=$((ERR+1))
  stream_check LLVM_425M 'https://github.com/llvm/llvm-project/releases/download/llvmorg-23.1.1/clang%2Bllvm-23.1.1-aarch64-pc-windows-msvc.tar.zst' '0f9d0308a93b76318eae633806eddbec098fb96f27a706fed5ada399f9e391b5' 425456048 1 || ERR=$((ERR+1))
fi

if [ -d /Volumes/RESCUE ] && [ -w /Volumes/RESCUE ]; then
  TS=$(date +%Y%m%d-%H%M%S 2>/dev/null || echo unknown)
  cp "$LOG" "/Volumes/RESCUE/DOWNLOAD-$TS.log" 2>/dev/null || true
  say "LOG_SAVED=/Volumes/RESCUE/DOWNLOAD-$TS.log"
fi

say "DOWNLOAD_SUMMARY runs=$RUNS errors=$ERR expected_bytes=$BYTES_EXPECTED"
if [ "$ERR" -eq 0 ]; then
  say 'RESULT=PASS'
  say 'RU: Все выполненные загрузки завершились без обрыва и побитово совпали с эталонными SHA-256.'
  say 'EN: All completed transfers finished without interruption and matched ground-truth SHA-256 exactly.'
  say 'NEXT_RU: Если Apple Installer всё равно обрывается, отдельно проверяйте NETWORK, RAM и Recovery/T2/firmware.'
  say 'NEXT_EN: If Apple Installer still fails, separately investigate NETWORK, RAM and Recovery/T2/firmware.'
  exit 0
else
  say 'RESULT=FAIL'
  say 'RU: Обнаружен обрыв передачи, Range/resume failure или несовпадение SHA-256.'
  say 'EN: A transfer interruption, Range/resume failure, or SHA-256 mismatch was detected.'
  say 'NEXT_RU: Сначала исключите RAM, затем повторите NETWORK/DOWNLOAD через Ethernet и другую сеть.'
  say 'NEXT_EN: Exclude RAM first, then repeat NETWORK/DOWNLOAD over Ethernet and another network.'
  exit 2
fi
