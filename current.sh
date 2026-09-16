#!/bin/bash
# Maximum non-destructive internal SSD diagnostic for macOS Recovery.
# Stage 1: baseline + ground-truth rereads + external control + fill/stress most free APFS space.
# Stage 2 (after reboot): full persistence reread + raw sequential read + APFS verification.
# Does NOT erase/repartition the internal disk. Destructive whole-device testing is a later stage.
set -u

VOL='/Volumes/Apple'
ROOT="$VOL/SSD-MAX-DIAG"
MANIFEST="$ROOT/chunks.manifest"
MARKER="$ROOT/STAGE1_COMPLETE"
LOG="$ROOT/diag.log"
SEED="/tmp/ssd-max-seed.$$"
HASH_TMP="/tmp/ssd-max-hash.$$"

say(){ printf '%s\n' "$*"; }
fail(){ printf 'STOP: %s\n' "$*" >&2; exit 1; }
need(){ command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"; }
trim(){ awk '{$1=$1;print}'; }

for c in diskutil awk sed grep cat dd stat df mkdir rm sync sleep tee date sysctl tr; do need "$c"; done
[ -d "$VOL" ] || fail "$VOL is not mounted"
mkdir -p "$ROOT" || fail "cannot create $ROOT"

# Duplicate all terminal output into an on-disk log while preserving terminal visibility.
if command -v tee >/dev/null 2>&1; then
  exec > >(tee -a "$LOG") 2>&1
fi

cleanup(){ rm -f "$SEED" "$HASH_TMP" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

if command -v caffeinate >/dev/null 2>&1; then
  caffeinate -di -w $$ >/tmp/ssd-max-caffeinate.log 2>&1 &
  CAFF=$!
  trap 'kill "$CAFF" 2>/dev/null || true; cleanup' EXIT INT TERM
fi

SHA_TOOL=''
if command -v sha256sum >/dev/null 2>&1; then
  SHA_TOOL='sha256sum'
elif command -v shasum >/dev/null 2>&1; then
  SHA_TOOL='shasum'
elif command -v openssl >/dev/null 2>&1; then
  SHA_TOOL='openssl'
fi
[ -n "$SHA_TOOL" ] || fail 'no SHA-256 tool available'

sha_file(){
  F=$1
  case "$SHA_TOOL" in
    sha256sum) sha256sum "$F" 2>/dev/null | awk '{print $1}';;
    shasum) shasum -a 256 "$F" 2>/dev/null | awk '{print $1}';;
    openssl) openssl dgst -sha256 "$F" 2>/dev/null | awk '{print $NF}';;
  esac
}

sha_stdin(){
  case "$SHA_TOOL" in
    sha256sum) sha256sum 2>/dev/null | awk '{print $1}';;
    shasum) shasum -a 256 2>/dev/null | awk '{print $1}';;
    openssl) openssl dgst -sha256 2>/dev/null | awk '{print $NF}';;
  esac
}

file_size(){ stat -f '%z' "$1" 2>/dev/null || printf '0\n'; }
boot_id(){ sysctl -n kern.boottime 2>/dev/null | tr -d ' \t\r\n'; }

# Resolve the physical internal disk backing the Apple APFS volume.
PSTORE=$(diskutil info "$VOL" 2>/dev/null | awk -F: '/APFS Physical Store/ {gsub(/^[ \t]+|[ \t]+$/, "", $2); print $2; exit}')
WHOLE=''
if [ -n "$PSTORE" ]; then
  WHOLE=$(printf '%s\n' "$PSTORE" | sed 's/s[0-9][0-9]*$//')
fi
if [ -z "$WHOLE" ]; then
  # Conservative fallback: use disk0 only if diskutil explicitly says it is internal.
  if diskutil info /dev/disk0 2>/dev/null | grep -q 'Internal:.*Yes'; then WHOLE='disk0'; fi
fi
RAW=''
[ -n "$WHOLE" ] && RAW="/dev/r$WHOLE"

say '============================================================'
say 'MODE=MAX_INTERNAL_SSD_DIAGNOSTIC_NONDESTRUCTIVE_V1'
say "DATE=$(date 2>/dev/null || true)"
say "VOLUME=$VOL"
say "SHA256_TOOL=$SHA_TOOL"
say "APFS_PHYSICAL_STORE=${PSTORE:-UNKNOWN}"
say "PHYSICAL_WHOLE_DISK=${WHOLE:-UNKNOWN}"
say 'This test intentionally performs very heavy reads/writes but does NOT erase the disk.'
say 'Keep AC power connected and do not interrupt unless an I/O error or repeated hash mismatch appears.'
say '============================================================'

baseline(){
  say '--- BASELINE: disk map ---'
  diskutil list || true
  say '--- BASELINE: Apple volume info ---'
  diskutil info "$VOL" || true
  if [ -n "$WHOLE" ]; then
    say '--- BASELINE: physical disk info ---'
    diskutil info "/dev/$WHOLE" || true
    say '--- BASELINE: partition map verify ---'
    diskutil verifyDisk "/dev/$WHOLE"
    RC=$?
    say "VERIFY_DISK_EXIT=$RC"
    [ "$RC" -eq 0 ] || return 1
  fi
  say '--- BASELINE: APFS volume verify ---'
  diskutil verifyVolume "$VOL"
  RC=$?
  say "VERIFY_VOLUME_EXIT=$RC"
  [ "$RC" -eq 0 ] || return 1

  if command -v system_profiler >/dev/null 2>&1; then
    say '--- BASELINE: NVMe/SSD profile ---'
    system_profiler SPNVMeDataType 2>/dev/null || true
  fi
  if command -v pmset >/dev/null 2>&1; then
    say '--- POWER ---'
    pmset -g batt 2>/dev/null || true
  fi
  return 0
}

check_known_file(){
  F=$1
  EXPECTED=$2
  EXPECTED_SIZE=$3
  LABEL=$4
  [ -f "$F" ] || { say "KNOWN_FILE_SKIP label=$LABEL reason=missing file=$F"; return 0; }
  SZ=$(file_size "$F")
  if [ "$SZ" != "$EXPECTED_SIZE" ]; then
    say "KNOWN_FILE_SKIP label=$LABEL reason=incomplete_previous_transfer bytes=$SZ expected_bytes=$EXPECTED_SIZE"
    return 0
  fi
  H1=$(sha_file "$F")
  sleep 1
  H2=$(sha_file "$F")
  say "KNOWN_FILE=$LABEL"
  say "EXPECTED_SHA256=$EXPECTED"
  say "READ1_SHA256=$H1"
  say "READ2_SHA256=$H2"
  if [ "$H1" != "$H2" ]; then
    say "KNOWN_FILE_RESULT=FAIL_UNSTABLE_REREAD label=$LABEL"
    return 1
  fi
  if [ "$H1" != "$EXPECTED" ]; then
    say "KNOWN_FILE_GROUND_TRUTH=WARNING_STABLE_BUT_DOES_NOT_MATCH_GITHUB label=$LABEL"
    say 'This can be transfer-path corruption; stability across rereads is the storage-relevant result here.'
    return 0
  fi
  say "KNOWN_FILE_RESULT=PASS label=$LABEL"
  return 0
}
check_existing_ground_truth(){
  say '--- GITHUB GROUND-TRUTH FILES: repeated reread ---'
  G="$VOL/GitHub-SSD-Test"
  FAILS=0
  for S in A B local-rewrite; do
    check_known_file "$G/llvm-aarch64-zst.$S" '0f9d0308a93b76318eae633806eddbec098fb96f27a706fed5ada399f9e391b5' '425456048' "llvm-aarch64-zst.$S" || FAILS=$((FAILS+1))
    check_known_file "$G/llvm-aarch64-xz.$S" 'c8cd61f6624accf0d0f9f4519ddcc97745c6a865205bb43f364b6aaf9c50a31e' '763828684' "llvm-aarch64-xz.$S" || FAILS=$((FAILS+1))
    check_known_file "$G/llvm-x86_64-xz.$S" 'c54ac8146b420fe72e11e6fdd56498d6818011ad23267196b6ab37b5ac9264c3' '901304424' "llvm-x86_64-xz.$S" || FAILS=$((FAILS+1))
  done
  say "GROUND_TRUTH_FAILS=$FAILS"
  [ "$FAILS" -eq 0 ]
}

check_tahoe_stability(){
  T="$VOL/Tahoe-26.6.2-25G83/InstallAssistant.pkg.single"
  if [ ! -f "$T" ]; then
    say 'TAHOE_STABILITY=SKIP file_not_found'
    return 0
  fi
  say '--- 18.4 GB TAHOE FILE: repeated full-file reread ---'
  S=$(file_size "$T")
  H1=$(sha_file "$T")
  sync
  sleep 2
  H2=$(sha_file "$T")
  sleep 2
  H3=$(sha_file "$T")
  say "TAHOE_BYTES=$S"
  say "TAHOE_SHA256_READ1=$H1"
  say "TAHOE_SHA256_READ2=$H2"
  say "TAHOE_SHA256_READ3=$H3"
  if [ "$H1" = "$H2" ] && [ "$H1" = "$H3" ]; then
    say 'TAHOE_REREAD_STABILITY=PASS'
    return 0
  fi
  say 'TAHOE_REREAD_STABILITY=FAIL'
  return 1
}

make_seed(){
  rm -f "$SEED"
  dd if=/dev/urandom of="$SEED" bs=1048576 count=64 2>/dev/null
  [ "$(file_size "$SEED")" = '67108864' ] || return 1
}

write_pattern_file(){
  OUT=$1
  REPEATS=$2
  EXPECTED_BYTES=$3
  rm -f "$OUT" "$HASH_TMP"
  make_seed || return 1

  say "PATTERN_WRITE_START file=$OUT bytes=$EXPECTED_BYTES"
  (
    I=0
    while [ "$I" -lt "$REPEATS" ]; do
      cat "$SEED" || exit 10
      I=$((I+1))
    done
  ) | tee "$OUT" | sha_stdin > "$HASH_TMP"
  P0=${PIPESTATUS[0]} P1=${PIPESTATUS[1]} P2=${PIPESTATUS[2]}
  STREAM_HASH=$(cat "$HASH_TMP" 2>/dev/null | awk 'NR==1{print $1}')
  sync
  SIZE=$(file_size "$OUT")
  say "PATTERN_PIPE_STATUS generator=$P0 tee=$P1 sha=$P2"
  say "PATTERN_STREAM_SHA256=$STREAM_HASH"
  say "PATTERN_FILE_BYTES=$SIZE"
  if [ "$P0" -ne 0 ] || [ "$P1" -ne 0 ] || [ "$P2" -ne 0 ] || [ "$SIZE" != "$EXPECTED_BYTES" ] || [ -z "$STREAM_HASH" ]; then
    say 'PATTERN_WRITE_RESULT=FAIL_PIPE_OR_SIZE'
    return 1
  fi

  FILE_HASH=$(sha_file "$OUT")
  say "PATTERN_READBACK_SHA256=$FILE_HASH"
  if [ "$FILE_HASH" != "$STREAM_HASH" ]; then
    say 'PATTERN_WRITE_RESULT=FAIL_STREAM_VS_DISK'
    return 1
  fi
  say 'PATTERN_WRITE_RESULT=PASS'
  PATTERN_RESULT_HASH=$STREAM_HASH
  return 0
}

external_control(){
  EXT='/Volumes/RESCUE'
  [ -d "$EXT" ] || { say 'EXTERNAL_CONTROL=SKIP RESCUE_not_mounted'; return 0; }
  AVK=$(df -k "$EXT" 2>/dev/null | awk 'END{print $4}')
  case "$AVK" in ''|*[!0-9]*) say 'EXTERNAL_CONTROL=SKIP cannot_measure_free_space'; return 0;; esac
  # Need at least 12 GiB free to safely write a 4 GiB control file.
  if [ "$AVK" -lt 12582912 ]; then
    say "EXTERNAL_CONTROL=SKIP insufficient_free_kb=$AVK"
    return 0
  fi
  OUT="$EXT/.ssd-max-control.bin"
  say '--- EXTERNAL CONTROL: 4 GiB stream/write/read ---'
  write_pattern_file "$OUT" 64 4294967296 || { rm -f "$OUT"; say 'EXTERNAL_CONTROL=FAIL'; return 1; }
  H1=$PATTERN_RESULT_HASH
  sleep 2
  H2=$(sha_file "$OUT")
  say "EXTERNAL_CONTROL_REREAD_SHA256=$H2"
  rm -f "$OUT"
  sync
  if [ "$H1" = "$H2" ]; then say 'EXTERNAL_CONTROL=PASS'; return 0; fi
  say 'EXTERNAL_CONTROL=FAIL_REREAD'
  return 1
}

stress_fill_internal(){
  say '--- INTERNAL SSD FREE-SPACE STRESS ---'
  AVAIL_KB=$(df -k "$VOL" 2>/dev/null | awk 'END{print $4}')
  case "$AVAIL_KB" in ''|*[!0-9]*) say "STOP: invalid free-space value: $AVAIL_KB"; return 1;; esac

  # Leave 64 GiB free so APFS metadata still has substantial working room.
  RESERVE_KB=67108864
  CHUNK_KB=8388608
  if [ "$AVAIL_KB" -le "$RESERVE_KB" ]; then
    say "STRESS_FILL=SKIP available_kb=$AVAIL_KB reserve_kb=$RESERVE_KB"
    return 0
  fi
  N=$(( (AVAIL_KB - RESERVE_KB) / CHUNK_KB ))
  [ "$N" -gt 110 ] && N=110
  if [ "$N" -lt 1 ]; then
    say 'STRESS_FILL=SKIP no_full_chunk_fits'
    return 0
  fi

  say "AVAILABLE_KB_BEFORE=$AVAIL_KB"
  say "RESERVE_KB=$RESERVE_KB"
  say "CHUNK_BYTES=8589934592"
  say "PLANNED_CHUNKS=$N"
  say 'Each 8 GiB chunk uses a fresh 64 MiB random seed repeated through tee while SHA-256 is computed before disk reread.'

  rm -f "$MANIFEST"
  I=1
  while [ "$I" -le "$N" ]; do
    F=$(printf '%s/chunk-%03d.bin' "$ROOT" "$I")
    say '------------------------------------------------------------'
    say "CHUNK=$I/$N"
    write_pattern_file "$F" 128 8589934592 || { say "STRESS_FILL_RESULT=FAIL chunk=$I"; return 1; }
    printf '%s|%s|%s\n' "$F" "$PATTERN_RESULT_HASH" '8589934592' >> "$MANIFEST"
    say "MANIFEST_ADDED=$F"
    I=$((I+1))
  done

  say '--- SECOND COMPLETE REREAD PASS OF ALL STRESS FILES ---'
  FAILS=0
  COUNT=0
  while IFS='|' read F H S; do
    [ -n "$F" ] || continue
    COUNT=$((COUNT+1))
    ACT=$(sha_file "$F")
    SZ=$(file_size "$F")
    say "REREAD_PASS2 file=$F expected=$H actual=$ACT bytes=$SZ"
    if [ "$ACT" != "$H" ] || [ "$SZ" != "$S" ]; then
      say "REREAD_PASS2_RESULT=FAIL file=$F"
      FAILS=$((FAILS+1))
      break
    fi
  done < "$MANIFEST"
  say "REREAD_PASS2_COUNT=$COUNT"
  say "REREAD_PASS2_FAILS=$FAILS"
  [ "$FAILS" -eq 0 ] || return 1

  AVAIL_AFTER=$(df -k "$VOL" 2>/dev/null | awk 'END{print $4}')
  say "AVAILABLE_KB_AFTER=$AVAIL_AFTER"
  return 0
}

raw_read_sweep(){
  if [ -z "$WHOLE" ] || [ -z "$RAW" ] || [ ! -e "$RAW" ]; then
    say 'RAW_READ_SWEEP=SKIP physical_disk_not_resolved'
    return 0
  fi
  if ! diskutil info "/dev/$WHOLE" 2>/dev/null | grep -q 'Internal:.*Yes'; then
    say "RAW_READ_SWEEP=SKIP ${WHOLE}_not_confirmed_internal"
    return 0
  fi
  say '--- RAW WHOLE-DISK SEQUENTIAL READ SWEEP ---'
  say "RAW_DEVICE=$RAW"
  say 'This is read-only. SIGINFO progress is requested every 30 seconds.'
  dd if="$RAW" of=/dev/null bs=16777216 &
  DPID=$!
  while kill -0 "$DPID" 2>/dev/null; do
    sleep 30
    kill -INFO "$DPID" 2>/dev/null || true
  done
  wait "$DPID"
  RC=$?
  say "RAW_READ_SWEEP_EXIT=$RC"
  [ "$RC" -eq 0 ]
}

verify_manifest_pass(){
  LABEL=$1
  [ -f "$MANIFEST" ] || { say "MANIFEST_VERIFY_$LABEL=FAIL manifest_missing"; return 1; }
  FAILS=0
  COUNT=0
  while IFS='|' read F H S; do
    [ -n "$F" ] || continue
    COUNT=$((COUNT+1))
    if [ ! -f "$F" ]; then
      say "MANIFEST_VERIFY_$LABEL=FAIL missing=$F"
      FAILS=$((FAILS+1)); break
    fi
    ACT=$(sha_file "$F")
    SZ=$(file_size "$F")
    say "MANIFEST_VERIFY_$LABEL file=$F expected=$H actual=$ACT bytes=$SZ"
    if [ "$ACT" != "$H" ] || [ "$SZ" != "$S" ]; then
      say "MANIFEST_VERIFY_$LABEL=FAIL file=$F"
      FAILS=$((FAILS+1)); break
    fi
  done < "$MANIFEST"
  say "MANIFEST_VERIFY_${LABEL}_COUNT=$COUNT"
  say "MANIFEST_VERIFY_${LABEL}_FAILS=$FAILS"
  [ "$FAILS" -eq 0 ]
}

stage1(){
  say 'STAGE=1_PRE_REBOOT_HEAVY_STRESS'
  rm -f "$ROOT"/chunk-*.bin "$MANIFEST" "$MARKER" 2>/dev/null || true
  sync
  baseline || { say 'FINAL=FAIL_BASELINE_FILESYSTEM_OR_PARTITION_MAP'; return 1; }
  check_existing_ground_truth || { say 'FINAL=FAIL_GITHUB_GROUND_TRUTH_REREAD'; return 1; }
  check_tahoe_stability || { say 'FINAL=FAIL_LARGE_FILE_REREAD_UNSTABLE'; return 1; }
  external_control || { say 'FINAL=FAIL_EXTERNAL_CONTROL_SYSTEM_PATH_SUSPECT'; return 1; }
  stress_fill_internal || { say 'FINAL=FAIL_INTERNAL_WRITE_READ_STRESS'; return 1; }
  raw_read_sweep || { say 'FINAL=FAIL_RAW_WHOLE_DISK_READ'; return 1; }
  say '--- APFS VERIFY AFTER HEAVY STRESS ---'
  diskutil verifyVolume "$VOL"
  RC=$?
  say "POST_STRESS_VERIFY_VOLUME_EXIT=$RC"
  [ "$RC" -eq 0 ] || { say 'FINAL=FAIL_APFS_AFTER_STRESS'; return 1; }

  BID=$(boot_id)
  printf '%s\n' "$BID" > "$MARKER"
  sync
  say '============================================================'
  say 'STAGE1_RESULT=PASS'
  say 'ACTION=REBOOT_INTO_INTERNET_RECOVERY_THEN_RUN_THE_SAME_st.sh_COMMAND'
  say 'Do NOT delete SSD-MAX-DIAG files. Stage 2 will reread all of them after reboot.'
  return 0
}

stage2(){
  say 'STAGE=2_POST_REBOOT_PERSISTENCE'
  OLD_BOOT=$(awk 'NR==1{print;exit}' "$MARKER" 2>/dev/null)
  NOW_BOOT=$(boot_id)
  say "STAGE1_BOOT_ID=$OLD_BOOT"
  say "CURRENT_BOOT_ID=$NOW_BOOT"
  if [ -n "$OLD_BOOT" ] && [ "$OLD_BOOT" = "$NOW_BOOT" ]; then
    say 'POST_REBOOT_CHECK=NOT_YET_REBOOTED'
    say 'ACTION=REBOOT_INTO_INTERNET_RECOVERY_AND_RUN_THE_SAME_COMMAND'
    return 0
  fi

  say '--- APFS VERIFY BEFORE POST-REBOOT REREAD ---'
  diskutil verifyVolume "$VOL"
  RC=$?
  say "POST_REBOOT_VERIFY_VOLUME_EXIT=$RC"
  [ "$RC" -eq 0 ] || { say 'FINAL=FAIL_APFS_AFTER_REBOOT'; return 1; }

  check_existing_ground_truth || { say 'FINAL=FAIL_GITHUB_FILES_CHANGED_AFTER_REBOOT'; return 1; }
  check_tahoe_stability || { say 'FINAL=FAIL_TAHOE_FILE_UNSTABLE_AFTER_REBOOT'; return 1; }

  verify_manifest_pass 'POSTREBOOT_1' || { say 'FINAL=FAIL_STRESS_FILES_AFTER_REBOOT'; return 1; }
  say '--- SECOND POST-REBOOT FULL REREAD PASS ---'
  verify_manifest_pass 'POSTREBOOT_2' || { say 'FINAL=FAIL_SECOND_POSTREBOOT_REREAD'; return 1; }

  raw_read_sweep || { say 'FINAL=FAIL_RAW_READ_AFTER_REBOOT'; return 1; }

  say '--- FINAL APFS VERIFY ---'
  diskutil verifyVolume "$VOL"
  RC=$?
  say "FINAL_VERIFY_VOLUME_EXIT=$RC"
  [ "$RC" -eq 0 ] || { say 'FINAL=FAIL_FINAL_APFS_VERIFY'; return 1; }

  say '============================================================'
  say 'FINAL=PASS_MAX_NONDESTRUCTIVE_STORAGE_TEST'
  say 'Interpretation: no logical-address corruption was detected across repeated writes, full rereads, reboot persistence, raw sequential read, and APFS verification.'
  say 'NEXT=DESTRUCTIVE_WHOLE_DEVICE_WRITE_READ_TEST_FOR_MAXIMUM_CONFIDENCE'
  return 0
}

if [ -f "$MARKER" ]; then
  stage2
  exit $?
else
  stage1
  exit $?
fi
