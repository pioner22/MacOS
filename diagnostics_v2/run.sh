#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
ROOT=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd) || exit 3
. "$ROOT/common.sh"
. "$ROOT/profile.sh"
. "$ROOT/net.sh"
selftest_main(){
  local f got size sha name bad=0 count=0 seen=" "
  select_hash || { unknown SHA256_KNOWN_ANSWER_FAILED; return 3; }
  for f in common.sh profile.sh net.sh run.sh; do /bin/bash -n "$ROOT/$f" || bad=1; done
  if need perl; then perl -c "$ROOT/count_stream.pl" || bad=1; else unknown PERL_UNAVAILABLE;return 3;fi
  if [ -f "$ROOT/manifest.tsv" ]; then
    while read -r sha size name; do
      case "$name" in common.sh|count_stream.pl|fixtures.txt|metal_vram.m|net.sh|profile.sh|ram_native.c|run.sh|storage_file.c) ;;*) bad=1;continue;;esac
      case "$seen" in *" $name "*) bad=1;;esac
      seen="$seen$name ";count=$((count+1))
      got=$(hash_file "$ROOT/$name") || bad=1
      [ "$got" = "$sha" ] && [ "$(wc -c < "$ROOT/$name" | tr -d ' ')" = "$size" ] || bad=1
    done < "$ROOT/manifest.tsv"
    [ "$count" -eq 9 ] || bad=1
  else unknown PACKAGE_MANIFEST_MISSING; return 3; fi
  [ "$bad" = 0 ] || { result FAIL 2 TOOLKIT_SELFTEST_FAILED 'Ошибка файлов комплекта, не диагноз ноутбука.' 'Toolkit file validation failed, not a hardware diagnosis.';return 2; }
  say 'SCOPE=PACKAGE_HASHES_SHELL_PERL_SYNTAX_AND_SHA_KNOWN_ANSWER not_hardware_certification=1'
  passed TOOLKIT_CHECKED
}
ram_main(){
  local mode mib cap total rc bin hold rounds
  mode=$1
  intel_full || { unknown NATIVE_RAM_REQUIRES_SUPPORTED_FULL_INTEL_MACOS;return 3; }
  total=$((RAM_BYTES/1048576));cap=$((total*3/4))
  case "$mode" in full) mib=49152;hold=1;rounds=1;;map) mib=8192;hold=3;rounds=2;;*) mib=8192;hold=1;rounds=1;;esac
  [ "$mib" -le "$cap" ] || mib=$cap
  mib=$((mib/32*32)); [ "$mib" -ge 32 ] || { unknown RAM_SIZE_INVALID;return 3; }
  say "RAM_PLAN mode=$mode target_mib=$mib installed_mib=$total reserve_mib=$((total-mib))"
  say 'RU: Требуется закрепление mlock. При отказе тест не нагружает память; повторите с нужными правами после закрытия приложений.'
  say 'EN: mlock is required. If locking fails, no stress starts; retry with sufficient privileges after closing applications.'
  bin="$STEP_DIR/ram_native"
  compile_c "$ROOT/ram_native.c" "$bin" || { unknown NATIVE_COMPILER_UNAVAILABLE_OR_FAILED;return 3; }
  "$bin" --selftest || { unknown NATIVE_SELFTEST_FAILED;return 3; }
  capture 14410 "$bin" "$mib" "$rounds" "$mode" "$hold" 14400;rc=$?
  case "$rc" in 130|143) return "$rc";;esac
  case "$rc" in
    0) grep -qx 'ENGINE_COMPLETE=RAM_PASS' "$STEP_DIR/engine.log" || { unknown RAM_COMPLETION_MISSING;return 3; };passed RAM_ALLOCATION_VERIFIED;;
    2) fault RAM_DATA_PATH_MISMATCH_INDEPENDENT_CONFIRMATION_REQUIRED;;
    *) unknown RAM_INCOMPLETE_OR_RESOURCE_LIMIT;;
  esac
}
cpu_worker(){
  local n dir out p
  n=$1;dir=$2
  dd if=/dev/zero bs=1048576 count=256 2>"$dir/dd-$n.err" | perl "$ROOT/count_stream.pl" 268435456 "$dir/count-$n" | "${SHA_CMD[@]}" > "$dir/hash-$n"
  p=("${PIPESTATUS[@]}")
  [ "${p[0]}:${p[1]}:${p[2]}" = 0:0:0 ] || return 3
  [ "$(cat "$dir/count-$n")" = 268435456 ] || return 3
  out=$(awk '{print $1}' "$dir/hash-$n")
  [ "$out" = a6d72ac7690f53be6ae46ba88506bd97302a093f7108472bd9efc3cefda06484 ] || return 2
}
cpu_stress(){
  local round w pid rc workers bad=0 incomplete=0
  local -a pids
  workers=$(sysctl -n hw.logicalcpu);valid_uint "$workers" 1 256 || return 3
  [ "$workers" -le 16 ] || workers=16
  say "CPU_PLAN workers=$workers rounds=4 bytes_per_worker=268435456 cache_isolation=NOT_CLAIMED"
  for round in 1 2 3 4; do
    pids=()
    for ((w=0;w<workers;w++));do cpu_worker "$round-$w" "$STEP_DIR" & pids[${#pids[@]}]=$!;done
    for pid in "${pids[@]}";do wait "$pid";rc=$?;case "$rc" in 0);;2)bad=1;;*)incomplete=1;;esac;done
    say "CPU_ROUND=$round failed=$bad incomplete=$incomplete"
    [ "$bad" = 0 ] || return 2
    [ "$incomplete" = 0 ] || return 3
  done
  say 'ENGINE_COMPLETE=CPU_PASS'
}
cpu_main(){
  local rc
  intel_full && need perl && select_hash || { unknown CPU_PREREQUISITES_MISSING;return 3; }
  capture 1800 cpu_stress;rc=$?
  case "$rc" in 130|143) return "$rc";;esac
  case "$rc" in 0) grep -qx 'ENGINE_COMPLETE=CPU_PASS' "$STEP_DIR/engine.log" || { unknown CPU_COMPLETION_MISSING;return 3; };passed CPU_HASH_EXECUTION_PATH;;2)fault CPU_RAM_EXECUTION_PATH_MISMATCH;;*)unknown CPU_PROCESS_OR_RESOURCE_LIMIT;;esac
}
gpu_main(){
  local compiler bin rc
  intel_full && [ -d /System/Library/Frameworks/Metal.framework ] && need xcrun && xcode-select -p >/dev/null 2>&1 || { unknown GPU_REQUIRES_FULL_MACOS_AND_TOOLCHAIN;return 3; }
  compiler=$(xcrun -f clang) || { unknown CLANG_NOT_AVAILABLE;return 3; }
  bin="$STEP_DIR/metal_vram";rm -f "$bin"
  "$compiler" -fobjc-arc -Wall -Wextra -Werror -mmacosx-version-min=10.15 -framework Foundation -framework Metal "$ROOT/metal_vram.m" -o "$bin" > "$STEP_DIR/compile.log" 2>&1
  rc=$?;cat "$STEP_DIR/compile.log"
  [ "$rc" -eq 0 ] && [ -x "$bin" ] || { rm -f "$bin";unknown GPU_CURRENT_BUILD_FAILED;return 3; }
  capture 1810 "$bin" 256;rc=$?
  case "$rc" in 130|143) return "$rc";;esac
  case "$rc" in 0) grep -qx 'ENGINE_COMPLETE=GPU_PASS' "$STEP_DIR/engine.log" || { unknown GPU_COMPLETION_MISSING;return 3; };passed GPU_256MIB_PER_DEVICE_PATH_CHECK;;2)fault GPU_DRIVER_VRAM_RAM_PATH_FAILURE;;*)unknown GPU_INCOMPLETE_OR_TIMEOUT;;esac
}
file_main(){
  local mode path mib bin rc location
  mode=$1
  intel_full || { unknown FILE_TEST_REQUIRES_FULL_INTEL_MACOS;return 3; }
  if [ "$mode" = bridge ];then
    path=${BRIDGE_TARGET:-/Volumes/RESCUE};mib=40960
    [ "$RAM_BYTES" -ge 68719476736 ] || { unknown BRIDGE_REQUIRES_64GIB_RAM;return 3; }
    location=$(diskutil info "$path" 2>/dev/null | awk -F: '/^[ \t]*Device Location:/{gsub(/^[ \t]+|[ \t]+$/,"",$2);print $2;exit}')
    [ "$location" = External ] || { unknown EXTERNAL_TARGET_NOT_CONFIRMED;return 3; }
  else path=${FILE_TARGET:-};mib=1024;fi
  [ -n "$path" ] && [ -d "$path" ] && [ -w "$path" ] || { unknown SELECT_WRITABLE_TEST_DIRECTORY;return 3; }
  [ "${FILE_CONSENT:-}" = TEST-FILES ] || { unknown FILE_WRITE_NOT_AUTHORIZED;return 3; }
  say "FILE_TEST_TARGET=$path TEST_MIB=$mib rounds=2 mode=$mode raw_devices=NEVER"
  diskutil info "$path" 2>/dev/null || :
  bin="$STEP_DIR/storage_file";compile_c "$ROOT/storage_file.c" "$bin" || { unknown FILE_ENGINE_BUILD_FAILED;return 3; }
  capture 14410 "$bin" "$mode" "$mib" 2 "$path" 14400;rc=$?
  case "$rc" in 130|143) return "$rc";;esac
  case "$rc" in
    0) grep -qx 'ENGINE_COMPLETE=FILE_BYTES_VERIFIED' "$STEP_DIR/engine.log" && grep -qx 'MEDIA_CACHE_CONTROLS=APPLIED' "$STEP_DIR/engine.log" || { unknown FILE_COMPLETION_MISSING;return 3; };passed FILE_WRITE_AND_TWO_READBACKS;;
    2) fault FILE_OR_RAM_IO_PATH_FAILURE_NOT_COMPONENT_DIAGNOSIS;;
    *) unknown FILE_RESOURCES_CACHE_CONTROLS_OR_INTERRUPTION;;
  esac
}
snapshot_main(){
  local tool
  profile_show
  for tool in 'hardware' 'power';do
    case "$tool" in
      hardware) need system_profiler && supervise 60 system_profiler SPHardwareDataType SPDisplaysDataType || :;;
      power) need pmset && pmset -g batt || :;;
    esac
  done
  result OBSERVED 5 INVENTORY_ONLY 'Сведения собраны; это не тест исправности.' 'Inventory collected; this is not a health test.'
}
power_main(){
  need pmset && pmset -g batt || :
  need pmset && pmset -g therm || :
  if need powermetrics;then supervise 15 powermetrics -n 3 -i 1000 || :;fi
  result OBSERVED 5 POWER_OBSERVATION_ONLY 'Наблюдение не доказывает исправность питания и не заменяет измерения платы.' 'Observations do not certify power circuitry or replace board measurements.'
}
manual_main(){
  say 'MANUAL_CHECKLIST=Apple_Diagnostics,cold_boot_repeat,sleep_wake,AC_battery,display,WiFi,USB_ports,repair_report'
  result PENDING_MANUAL 6 MANUAL_AND_COLD_BOOT_REQUIRED 'Нужны независимый тест памяти и повтор после полного выключения; отдельно проверить экран, сон, батарею и порты.' 'Independent RAM validation and another cold boot are required; check display, sleep, battery and ports separately.'
}
raw_blocked(){ result BLOCKED 7 LEGACY_RAW_QUARANTINED 'Старый разрушительный движок сохранён, но отключён до отдельного аудита. Для приёмки используйте файловый тест 17.' 'Legacy destructive engine is retained but quarantined pending its own audit. Use file test 17 for acceptance.'; }
consent_files(){
  printf 'RU: Каталог для отдельного тестового файла 1 ГиБ (Enter = домашний).\nEN: Directory for a new 1 GiB test file (Enter = home).\n> '
  read_reply || return 3;FILE_TARGET=${REPLY:-$HOME}
  printf 'TARGET=%s\nRU: Будут созданы и проверены только временные тестовые файлы. Введите TEST-FILES.\nEN: Only new temporary test files will be created and verified. Type TEST-FILES.\n> ' "$FILE_TARGET"
  read_reply && [ "$REPLY" = TEST-FILES ] || return 3
  FILE_CONSENT=TEST-FILES
}
acceptance_main(){
  local kind state
  kind=$1
  run_step TOOLKIT selftest_main || return $?
  [ "$LAST_STATE" = PASS ] || { unknown TOOLKIT_GATE;return 3; }
  run_step HARDWARE snapshot_main || return $?
  run_step POWER power_main || return $?
  run_step RAM_QUICK ram_main quick || return $?
  if [ "$LAST_STATE" != PASS ];then finish_suite;return $?;fi
  if [ "$kind" != safe ];then
    run_step RAM_FULL ram_main full || return $?
    if [ "$LAST_STATE" != PASS ];then finish_suite;return $?;fi
  fi
  run_step CPU cpu_main || return $?
  if [ "$LAST_STATE" != PASS ];then finish_suite;return $?;fi
  run_step GPU gpu_main || return $?
  # Don't put sustained load on a machine with an observed GPU path failure.
  if [ "$LAST_STATE" = FAIL ];then finish_suite;return $?;fi
  run_step NETWORK network_main || return $?
  run_step DOWNLOAD download_main || return $?
  if [ "$kind" != safe ];then
    if consent_files;then run_step STORAGE_FILE file_main storage || return $?
    else run_step STORAGE_FILE unknown FILE_STAGE_NOT_AUTHORIZED || return $?;fi
  fi
  run_step MANUAL manual_main || return $?
  finish_suite
}
finish_suite(){
  local state
  state=$(suite_state "$SESSION/summary.tsv")
  say '--- SUMMARY / СВОДКА ---';cat "$SESSION/summary.tsv"
  case "$state" in
    FAIL) fault ACCEPTANCE_STAGE_FAILED;;
    INCONCLUSIVE) unknown ACCEPTANCE_INCOMPLETE;;
    PENDING_MANUAL) result PENDING_MANUAL 6 AUTOMATED_STAGES_PASSED_MANUAL_PENDING 'Автоматические этапы прошли; окончательная приёмка ожидает независимой и ручной проверки.' 'Automated stages passed; final acceptance awaits independent and manual checks.';;
    *) unknown FINAL_ACCEPTANCE_NOT_ESTABLISHED;;
  esac
}
menu(){
  while :;do
    profile_show
    cat <<'MENU'
 1  SSD raw (заблокирован / quarantined)
 2  RAM QUICK (native C, mlock)
 3  RAM FULL (134 patterns)
 4  RAM MAP (allocation offsets, NOT physical chips)
 5  CPU execution path
 6  GPU / VRAM (experimental Metal path, 256 MiB/device)
 7  DISPLAY / Ручная проверка экрана
 8  NETWORK / HTTPS
 9  DOWNLOAD / SHA-256 and Range
10  POWER / Наблюдение
11  HARDWARE / Сведения
12  SAFE SUITE / Быстрый комплекс без записи тестового файла
13  LEGACY RAW COMPLEX (заблокирован / quarantined)
14  TOOLKIT SELFTEST / Проверка комплекта
15  MODEL / RUNNING OS / Профиль
16  POST-REPAIR / Приёмка после ремонта, БЕЗ стирания
17  STORAGE FILE / Проверка нового файла, БЕЗ стирания
18  RAM -> external RESCUE / 40 GiB, отдельный тест
 0  EXIT / Выход
MENU
    printf '> ';read_reply || return 3
    case "$REPLY" in
      0|'')MODE=exit;return 0;;1|13)MODE=raw;;2)MODE=ramquick;;3)MODE=ramfull;;4)MODE=rammap;;5)MODE=cpu;;6)MODE=gpu;;7)MODE=display;;8)MODE=network;;9)MODE=download;;10)MODE=power;;11)MODE=snapshot;;12)MODE=safe;;14)MODE=selftest;;15)profile_choose;continue;;16)MODE=acceptance;;17)MODE=storage;;18)MODE=bridge;;*)continue;;esac
    return 0
  done
}
main(){
  local base rc state
  profile_detect;profile_validate || { say 'RESULT=INCONCLUSIVE PROFILE_MISMATCH';return 3; }
  MODE=${1:-menu}
  if [ "$MODE" = menu ];then menu || return 3;fi
  [ "$MODE" != exit ] || return 0
  base=/tmp
  if [ "$ENVIRONMENT" = full ] && [ -n "${HOME:-}" ] && [ -d "$HOME" ];then
    base="$HOME/Library/Logs/MacHardwareDiagnostics";mkdir -p "$base" || base=/tmp
  elif [ -d /Volumes/RESCUE ] && [ -w /Volumes/RESCUE ];then base=/Volumes/RESCUE;fi
  SESSION=$(mktemp -d "$base/macdiag-v2.XXXXXX") || return 3
  STEP_DIR=$SESSION;export SESSION STEP_DIR
  trap 'rc=$?; if [ -f "$SESSION/session.state" ] && [ "$(cat "$SESSION/session.state")" = RUNNING ];then printf "INCOMPLETE %s\n" "$rc" > "$SESSION/session.state";fi' EXIT
  : > "$SESSION/summary.tsv";printf 'RUNNING\n' > "$SESSION/session.state"
  profile_show > "$SESSION/profile.txt"
  say "SESSION_LOGS=$SESSION CODE_REF=${MACDIAG_CODE_REF:-LOCAL_UNPINNED}"
  trap 'printf "INTERRUPTED\n" > "$SESSION/session.state"; exit 130' INT
  trap 'printf "INTERRUPTED\n" > "$SESSION/session.state"; exit 143' TERM HUP
  if [ "$KERNEL" != Darwin ] && [ "$MODE" != selftest ];then unknown NON_MACOS_ENVIRONMENT;return 3;fi
  case "$MODE" in
    raw)run_step RAW raw_blocked;;
    selftest)run_step TOOLKIT selftest_main;;
    ramquick)run_step RAM_QUICK ram_main quick;;ramfull)run_step RAM_FULL ram_main full;;rammap)run_step RAM_MAP ram_main map;;
    cpu)run_step CPU cpu_main;;gpu)run_step GPU gpu_main;;
    network)run_step NETWORK network_main;;download)run_step DOWNLOAD download_main;;
    power)run_step POWER power_main;;snapshot)run_step HARDWARE snapshot_main;;display)run_step MANUAL manual_main;;
    storage)
      if consent_files;then run_step FILE file_main storage
      else unknown FILE_TEST_NOT_AUTHORIZED;return 3;fi;;
    bridge)
      BRIDGE_TARGET=/Volumes/RESCUE
      say 'TARGET=/Volumes/RESCUE TEST_MIB=40960'
      say 'RU: Отдельный тест займёт 40 ГиБ RAM и создаст новый файл на внешнем RESCUE. Введите RAM-BRIDGE.'
      say 'EN: This separate test locks 40 GiB RAM and creates a new file on external RESCUE. Type RAM-BRIDGE.'
      if ! read_reply || [ "$REPLY" != RAM-BRIDGE ];then unknown BRIDGE_NOT_AUTHORIZED;return 3;fi
      FILE_CONSENT=TEST-FILES
      run_step FILE file_main bridge;;
    acceptance|safe)acceptance_main "$MODE";rc=$?;printf 'FINISHED %s\n' "$rc" > "$SESSION/session.state";return "$rc";;
    *)unknown UNKNOWN_MODE;return 3;;
  esac
  rc=$?;[ "$rc" -eq 0 ] || { printf 'INTERRUPTED\n' > "$SESSION/session.state";return "$rc"; }
  printf 'FINISHED %s\n' "$LAST_STATE" > "$SESSION/session.state"
  case "$LAST_STATE" in PASS)rc=0;;FAIL)rc=2;;OBSERVED)rc=5;;PENDING_MANUAL)rc=6;;BLOCKED)rc=7;;*)rc=3;;esac
  say "FINAL_STATE=$LAST_STATE LOGS=$SESSION";return "$rc"
}
if [ "${BASH_SOURCE[0]}" = "$0" ];then main "$@";exit $?;fi
