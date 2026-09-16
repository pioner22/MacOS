#!/bin/bash
# Download integrity test. No internal SSD writes; payloads stream directly to SHA-256.
set +u
export LC_ALL=C
LOG='/tmp/download-test.log'; : > "$LOG"
say(){ printf '%s\n' "$*" | tee -a "$LOG"; }
for c in curl awk tee rm; do command -v "$c" >/dev/null 2>&1 || { say "RESULT=INCONCLUSIVE missing_tool=$c"; exit 3; }; done
if command -v sha256sum >/dev/null 2>&1; then SHA=sha256sum
elif command -v shasum >/dev/null 2>&1; then SHA=shasum
else say 'RESULT=INCONCLUSIVE no_sha256_tool'; exit 3; fi

URL_A='https://github.com/llvm/llvm-project/releases/download/llvmorg-23.1.1/clang%2Bllvm-23.1.1-aarch64-pc-windows-msvc.tar.zst'
SHA_A='0f9d0308a93b76318eae633806eddbec098fb96f27a706fed5ada399f9e391b5'
SIZE_A=425456048
URL_B='https://github.com/llvm/llvm-project/releases/download/llvmorg-23.1.1/clang%2Bllvm-23.1.1-aarch64-pc-windows-msvc.tar.xz'
SHA_B='c8cd61f6624accf0d0f9f4519ddcc97745c6a865205bb43f364b6aaf9c50a31e'
SIZE_B=763828684
ERR=0
say '============================================================'
say 'MODE=DOWNLOAD_INTEGRITY_V2'
say 'RU: Проверка именно целостности больших скачиваний по опубликованным SHA-256.'
say 'EN: Large-download byte-integrity test against published SHA-256 values.'
say 'INTERNAL_SSD_WRITE=NONE'
say 'RU: Поток идёт напрямую в SHA-256; внутренний SSD в тесте не участвует.'
say 'EN: Download bytes stream directly into SHA-256; the internal SSD is not involved.'
say '============================================================'

stream_check(){
  LABEL=$1; URL=$2; EXPECT=$3; BYTES=$4; RUN=$5
  H="/tmp/download-hash-$$"; : > "$H"
  if [ "$SHA" = sha256sum ]; then
    curl -fL --http1.1 --tlsv1.2 --retry 2 --connect-timeout 20 --max-time 2400 "$URL" 2>>"$LOG" | sha256sum > "$H"
  else
    curl -fL --http1.1 --tlsv1.2 --retry 2 --connect-timeout 20 --max-time 2400 "$URL" 2>>"$LOG" | shasum -a 256 > "$H"
  fi
  P=("${PIPESTATUS[@]}"); GOT=$(awk '{print $1}' "$H"); rm -f "$H"
  if [ "${P[0]:-99}" -eq 0 ] && [ "${P[1]:-99}" -eq 0 ] && [ "$GOT" = "$EXPECT" ]; then
    say "DOWNLOAD_PASS asset=$LABEL run=$RUN expected_bytes=$BYTES sha256=$GOT"
    return 0
  fi
  say "DOWNLOAD_FAIL asset=$LABEL run=$RUN curl=${P[0]:-99} hash=${P[1]:-99} got=$GOT expected=$EXPECT"
  return 1
}

I=1
while [ "$I" -le 3 ]; do stream_check LLVM_ZST "$URL_A" "$SHA_A" "$SIZE_A" "$I" || ERR=$((ERR+1)); I=$((I+1)); done
stream_check LLVM_XZ "$URL_B" "$SHA_B" "$SIZE_B" 1 || ERR=$((ERR+1))

if [ "$ERR" -eq 0 ]; then
  say 'RESULT=PASS'
  say 'RU: Четыре крупные загрузки завершились; каждый поток совпал с опубликованным SHA-256.'
  say 'EN: Four large transfers completed and every stream matched the published SHA-256.'
  say 'NEXT_RU: Если именно Apple Installer всё равно рвётся, запускайте NETWORK TEST и проверяйте Recovery/T2/firmware/RAM.'
  say 'NEXT_EN: If Apple Installer still fails, run NETWORK TEST and investigate Recovery/T2/firmware/RAM.'
  exit 0
else
  say "RESULT=FAIL errors=$ERR"
  say 'RU: Зафиксирован обрыв передачи или побитовое несовпадение с эталонным SHA-256.'
  say 'EN: A transfer interruption or byte-level mismatch against ground-truth SHA-256 was detected.'
  say 'NEXT_RU: Сначала исключите RAM. Затем повторите NETWORK TEST по Ethernet/другой сети.'
  say 'NEXT_EN: Exclude RAM first, then repeat NETWORK TEST over Ethernet/another network.'
  exit 2
fi
