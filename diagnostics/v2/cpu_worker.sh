#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
D_ROOT=$(cd "$(dirname "$0")/../.." && pwd -P) || exit 3
. "$D_ROOT/diagnostics/v2/core.sh"
D_WORK=$1; workers=$2; rounds=$3; D_LOG="$D_WORK/cpu-detail.log"
d_num "$workers" 1 16 && d_num "$rounds" 1 16 || exit 3
workers=$((10#$workers));rounds=$((10#$rounds))
expected=a6d72ac7690f53be6ae46ba88506bd97302a093f7108472bd9efc3cefda06484
bad=0; missing=0
for ((r=1;r<=rounds;r++));do
  pids=()
  for ((w=1;w<=workers;w++));do
    (
      dd if=/dev/zero bs=1048576 count=256 2> "$D_WORK/cpu-$r-$w.dd" | d_sha > "$D_WORK/cpu-$r-$w.sha"
      p=("${PIPESTATUS[@]}")
      [ "${p[0]}" -eq 0 ] && [ "${p[1]}" -eq 0 ] || exit 3
      read -r got _ < "$D_WORK/cpu-$r-$w.sha"
      [ "$got" = "$expected" ] || exit 2
    ) & pids+=("$!")
  done
  for pid in "${pids[@]}";do wait "$pid";rc=$?;case "$rc" in 0) :;;2) bad=1;;*) missing=1;;esac;done
  printf 'CPU_ROUND=%s workers=%s mismatch=%s incomplete=%s\n' "$r" "$workers" "$bad" "$missing"
  [ "$bad" -eq 0 ] && [ "$missing" -eq 0 ] || break
done
[ "$bad" -eq 0 ] || exit 2
[ "$missing" -eq 0 ] || exit 3
echo 'CPU_SCOPE=SHA256_EXECUTION_PATH not_individual_cache_or_AVX_certification'
echo 'ENGINE_COMPLETE=CPU_PASS'
