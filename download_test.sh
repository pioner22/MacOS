#!/bin/bash
# Download integrity test. No internal SSD writes; temp files are under /tmp.
set +u
export LC_ALL=C
LOG='/tmp/download-test.log'; : > "$LOG"
say(){ printf '%s\n' "$*" | tee -a "$LOG"; }
for c in curl awk tee rm stat; do command -v "$c" >/dev/null 2>&1 || { say "RESULT=INCONCLUSIVE missing_tool=$c"; exit 3; }; done
if command -v sha256sum >/dev/null 2>&1; then SHA=sha256sum
elif command -v shasum >/dev/null 2>&1; then SHA=shasum
else say 'RESULT=INCONCLUSIVE no_sha256_tool'; exit 3; fi

GH_URL='https://github.com/llvm/llvm-project/releases/download/llvmorg-23.1.1/clang%2Bllvm-23.1.1-aarch64-pc-windows-msvc.tar.zst'
GH_EXPECT='0f9d0308a93b76318eae633806eddbec098fb96f27a706fed5ada399f9e391b5'
APPLE_SMALL='https://swcdn.apple.com/content/downloads/37/33/140-93587-A_GRFFH93NOL/f944yaqo1cjhh2m0kxrl0zhcpg9yb9qphv/InstallAssistant.pkg.integrityDataV1'
ERR=0
say '============================================================'
say 'MODE=DOWNLOAD_INTEGRITY_V1'
say 'RU: Проверка именно целостности скачивания, отдельно от общего network test.'
say 'EN: Download-byte-integrity test, separate from the general network test.'
say 'INTERNAL_SSD_WRITE=NONE'
say '============================================================'

I=1
while [ "$I" -le 3 ]; do
  H='/tmp/download-gh.sha'; : > "$H"
  if [ "$SHA" = sha256sum ]; then
    curl -fL --http1.1 --tlsv1.2 --retry 2 --connect-timeout 20 --max-time 1800 "$GH_URL" 2>>"$LOG" | sha256sum > "$H"
  else
    curl -fL --http1.1 --tlsv1.2 --retry 2 --connect-timeout 20 --max-time 1800 "$GH_URL" 2>>"$LOG" | shasum -a 256 > "$H"
  fi
  P=("${PIPESTATUS[@]}"); GOT=$(awk '{print $1}' "$H")
  if [ "${P[0]:-99}" -eq 0 ] && [ "${P[1]:-99}" -eq 0 ] && [ "$GOT" = "$GH_EXPECT" ]; then
    say "GITHUB_DOWNLOAD_PASS run=$I sha256=$GOT"
  else
    say "GITHUB_DOWNLOAD_FAIL run=$I curl=${P[0]:-99} hash=${P[1]:-99} got=$GOT expected=$GH_EXPECT"
    ERR=$((ERR+1))
  fi
  I=$((I+1))
done

APPLE_HASHES=''
I=1
while [ "$I" -le 3 ]; do
  F="/tmp/apple-integrity-$I.bin"
  rm -f "$F"
  curl -fL --http1.1 --tlsv1.2 --retry 2 --connect-timeout 20 --max-time 300 -o "$F" "$APPLE_SMALL" 2>>"$LOG"
  RC=$?
  if [ "$RC" -ne 0 ] || [ ! -s "$F" ]; then
    say "APPLE_SMALL_DOWNLOAD_FAIL run=$I curl=$RC"
    ERR=$((ERR+1))
  else
    if [ "$SHA" = sha256sum ]; then H=$(sha256sum "$F" | awk '{print $1}'); else H=$(shasum -a 256 "$F" | awk '{print $1}'); fi
    SZ=$(stat -f '%z' "$F" 2>/dev/null)
    say "APPLE_SMALL_DOWNLOAD run=$I bytes=$SZ sha256=$H"
    APPLE_HASHES="$APPLE_HASHES $H"
  fi
  I=$((I+1))
done
rm -f /tmp/apple-integrity-*.bin /tmp/download-gh.sha

set -- $APPLE_HASHES
if [ "$#" -eq 3 ]; then
  if [ "$1" = "$2" ] && [ "$1" = "$3" ]; then say "APPLE_REPEATABILITY=PASS sha256=$1"; else say "APPLE_REPEATABILITY=FAIL h1=$1 h2=$2 h3=$3"; ERR=$((ERR+1)); fi
else
  say 'APPLE_REPEATABILITY=INCONCLUSIVE not_all_three_downloads_completed'
fi

if [ "$ERR" -eq 0 ]; then
  say 'RESULT=PASS'
  say 'RU: Повторные загрузки прошли стабильно; GitHub-файл совпал с опубликованным SHA-256, Apple-файл повторился побитово.'
  say 'EN: Repeated downloads were stable; the GitHub asset matched its published SHA-256 and the Apple file repeated bit-identically.'
  say 'NEXT_RU: Если установка macOS всё ещё рвётся, проверяйте Recovery/T2/firmware и память, а не только сеть.'
  say 'NEXT_EN: If macOS installation still breaks, investigate Recovery/T2/firmware and RAM, not only the network.'
  exit 0
else
  say "RESULT=FAIL errors=$ERR"
  say 'RU: Обнаружены обрывы или несовпадение скачанных данных.'
  say 'EN: Transfer failures or downloaded-data mismatches were detected.'
  say 'NEXT_RU: Запустите NETWORK TEST, повторите на другой сети/Ethernet и учитывайте, что неисправная RAM тоже может портить буферы загрузки.'
  say 'NEXT_EN: Run NETWORK TEST, retry on another network/Ethernet, and remember bad RAM can also corrupt download buffers.'
  exit 2
fi
