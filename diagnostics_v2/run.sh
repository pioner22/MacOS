#!/bin/bash
# Prefer system utilities on Darwin, not unqualified Homebrew overrides.
if [ "$(/usr/bin/uname -s 2>/dev/null)" = Darwin ];then
  PATH=/usr/bin:/bin:/usr/sbin:/sbin;export PATH
fi
# SPDX-License-Identifier: GPL-3.0-or-later
ROOT=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd) || exit 3
. "$ROOT/common.sh"
. "$ROOT/profile.sh"
. "$ROOT/net.sh"
. "$ROOT/report.sh"
. "$ROOT/recovery.sh"
. "$ROOT/storage_readonly.sh"
selftest_main(){
  local f got size sha name bad=0 count=0 seen=" "
  select_hash || { unknown SHA256_KNOWN_ANSWER_FAILED; return 3; }
  for f in common.sh profile.sh net.sh report.sh recovery.sh storage_readonly.sh run.sh; do /bin/bash -n "$ROOT/$f" || bad=1; done
  if need perl;then
    if ! pf_probe 5 perl -MPOSIX -MIO::Select -MIO::Handle -MFcntl -MFile::Temp -MCwd -MErrno -e 'exit 0' > "$STEP_DIR/perl-prerequisites.log" 2>&1;then
      cat "$STEP_DIR/perl-prerequisites.log"
      unknown PERL_SELFTEST_DEPENDENCIES_UNAVAILABLE;return 3
    fi
  fi
  if need perl; then perl -c "$ROOT/count_stream.pl" || bad=1; perl -c "$ROOT/supervise.pl" || bad=1; perl -c "$ROOT/recovery_ram.pl" || bad=1; perl -c "$ROOT/recovery_file.pl" || bad=1; perl -c "$ROOT/storage_readonly.pl" || bad=1; else unknown PERL_UNAVAILABLE;return 3;fi
  if [ -f "$ROOT/manifest.tsv" ]; then
    while read -r sha size name; do
      case "$name" in common.sh|count_stream.pl|fixtures.txt|metal_vram.m|net.sh|profile.sh|ram_native.c|run.sh|storage_file.c|supervise.pl|report.sh|profiles.tsv|recovery.sh|recovery_ram.pl|recovery_file.pl|storage_readonly.sh|storage_readonly.pl) ;;*) bad=1;continue;;esac
      case "$seen" in *" $name "*) bad=1;;esac
      seen="$seen$name ";count=$((count+1))
      got=$(hash_file "$ROOT/$name") || bad=1
      [ "$got" = "$sha" ] && [ "$(wc -c < "$ROOT/$name" | tr -d ' ')" = "$size" ] || bad=1
    done < "$ROOT/manifest.tsv"
    [ "$count" -eq 17 ] || bad=1
  else unknown PACKAGE_MANIFEST_MISSING; return 3; fi
  [ "$bad" = 0 ] || { result FAIL 2 TOOLKIT_SELFTEST_FAILED 'Ошибка файлов комплекта, не диагноз ноутбука.' 'Toolkit file validation failed, not a hardware diagnosis.';return 2; }
  say 'SCOPE=PACKAGE_HASHES_SHELL_PERL_SYNTAX_AND_SHA_KNOWN_ANSWER not_hardware_certification=1'
  passed TOOLKIT_CHECKED
}
ram_main(){
  local mode mib cap total rc bin hold rounds planned
  mode=$1
  if [ "${RAM_BACKEND:-unavailable}" = perl_screen ];then recovery_ram_main "$mode";return $?;fi
  profile_validate && [ "${RAM_BACKEND:-unavailable}" = native_candidate ] || { unknown NATIVE_RAM_RUNTIME_UNAVAILABLE;return 3; }
  total=$((RAM_BYTES/1048576));cap=$((total*3/4))
  case "$mode" in full) mib=49152;hold=1;rounds=1;;map) mib=8192;hold=3;rounds=2;;*) mib=8192;hold=1;rounds=1;;esac
  [ "$mib" -le "$cap" ] || mib=$cap
  planned=$((mib/32*32))
  coverage_record "$planned" 0 0 "$total" BUDGET_PENDING || return 3
  mib=$(native_budget "$mib") || { unknown MEMORY_BUDGET_UNAVAILABLE_OR_LOW;return 3; }
  mib=$((mib/32*32)); [ "$mib" -ge 32 ] || { unknown RAM_SIZE_INVALID;return 3; }
  coverage_record "$planned" "$mib" 0 "$total" INCOMPLETE || return 3
  say "RAM_PLAN mode=$mode planned_mib=$planned target_mib=$mib installed_mib=$total reserve_mib=$((total-mib))"
  [ "$mib" -eq "$planned" ] || say 'COVERAGE_REDUCED: RU: Уменьшенный тест не даст RAM PASS. EN: A reduced test cannot pass the RAM plan.' 
  say 'RU: Требуется закрепление mlock. При отказе тест не нагружает память; повторите с нужными правами после закрытия приложений.'
  say 'EN: mlock is required. If locking fails, no stress starts; retry with sufficient privileges after closing applications.'
  bin="$STEP_DIR/ram_native"
  compile_c "$ROOT/ram_native.c" "$bin" || { unknown NATIVE_COMPILER_UNAVAILABLE_OR_FAILED;return 3; }
  "$bin" --selftest || { unknown NATIVE_SELFTEST_FAILED;return 3; }
  capture 14410 "$bin" "$mib" "$rounds" "$mode" "$hold" 14400;rc=$?
  case "$rc" in 129|130|143) return "$rc";;esac
  case "$rc" in
    0) grep -qx 'ENGINE_COMPLETE=RAM_PASS' "$STEP_DIR/engine.log" || { unknown RAM_COMPLETION_MISSING;return 3; }
      coverage_record "$planned" "$mib" "$mib" "$total" COMPLETED || return 3
      [ "$mib" -eq "$planned" ] || { unknown RAM_COVERAGE_REDUCED;return 3; }
      passed RAM_ALLOCATION_VERIFIED;;
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
  local round w pid rc workers rounds=4 bad=0 incomplete=0
  local -a pids
  workers=$(sysctl -n hw.logicalcpu);valid_uint "$workers" 1 256 || return 3
  [ "$workers" -le 16 ] || workers=16
  if [ "$ENVIRONMENT" != full ];then rounds=1;[ "$workers" -le 2 ] || workers=2;fi
  say "CPU_PLAN workers=$workers rounds=$rounds bytes_per_worker=268435456 cache_isolation=NOT_CLAIMED"
  for ((round=1;round<=rounds;round++)); do
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
  [ "${CPU_BACKEND:-unavailable}" = sha_path ] && need perl && select_hash || { unknown CPU_PREREQUISITES_MISSING;return 3; }
  capture 1800 /bin/bash "$ROOT/run.sh" --engine cpu "$STEP_DIR";rc=$?
  case "$rc" in 129|130|143) return "$rc";;esac
  case "$rc" in 0) grep -qx 'ENGINE_COMPLETE=CPU_PASS' "$STEP_DIR/engine.log" || { unknown CPU_COMPLETION_MISSING;return 3; };passed CPU_HASH_EXECUTION_PATH;;2)fault CPU_RAM_EXECUTION_PATH_MISMATCH;;*)unknown CPU_PROCESS_OR_RESOURCE_LIMIT;;esac
}
gpu_main(){
  local compiler bin rc
  intel_full && [ -d /System/Library/Frameworks/Metal.framework ] && need xcrun && xcode-select -p >/dev/null 2>&1 || { unknown GPU_REQUIRES_FULL_MACOS_AND_TOOLCHAIN;return 3; }
  compiler=$(xcrun -f clang) || { unknown CLANG_NOT_AVAILABLE;return 3; }
  bin="$STEP_DIR/metal_vram";rm -f "$bin"
  supervise 120 "$compiler" -fobjc-arc -Wall -Wextra -mmacosx-version-min=10.15 -framework Foundation -framework Metal "$ROOT/metal_vram.m" -o "$bin" > "$STEP_DIR/compile.log" 2>&1
  rc=$?;cat "$STEP_DIR/compile.log"
  [ "$rc" -eq 0 ] && [ -x "$bin" ] || { rm -f "$bin";unknown GPU_CURRENT_BUILD_FAILED;return 3; }
  capture 1810 "$bin" 256;rc=$?
  case "$rc" in 129|130|143) return "$rc";;esac
  case "$rc" in 0) grep -qx 'ENGINE_COMPLETE=GPU_PASS' "$STEP_DIR/engine.log" || { unknown GPU_COMPLETION_MISSING;return 3; };passed GPU_256MIB_PER_DEVICE_PATH_CHECK;;2)fault GPU_DRIVER_VRAM_RAM_PATH_FAILURE;;*)unknown GPU_INCOMPLETE_OR_TIMEOUT;;esac
}
file_main(){
  local mode path mib bin rc location
  mode=$1
  if [ "$mode" = storage ] && [ "${FILE_BACKEND:-}" = perl_file_screen ];then recovery_file_main;return $?;fi
  profile_validate && [ "${FILE_BACKEND:-unavailable}" = native_candidate ] || { unknown FILE_RUNTIME_UNAVAILABLE;return 3; }
  if [ "$mode" = bridge ];then
    path=${BRIDGE_TARGET:-/Volumes/RESCUE};mib=40960
    [ "$RAM_BYTES" -ge 68719476736 ] || { unknown BRIDGE_REQUIRES_64GIB_RAM;return 3; }
    [ "$(native_budget 40960)" = 40960 ] || { unknown BRIDGE_MEMORY_BUDGET_TOO_LOW;return 3; }
  else path=${FILE_TARGET:-};mib=1024;fi
  [ -n "$path" ] && [ -d "$path" ] && [ -w "$path" ] || { unknown SELECT_WRITABLE_TEST_DIRECTORY;return 3; }
  [ "${FILE_CONSENT:-}" = TEST-FILES ] || { unknown FILE_WRITE_NOT_AUTHORIZED;return 3; }
  target_preflight "$path" || return 3;path=$TARGET_CANONICAL
  if [ "$mode" = bridge ];then
    [ "${TARGET_INFO_RC:-3}" -eq 0 ] && [ "${TARGET_DEVICE_LOCATION:-unknown}" = External ] || {
      unknown EXTERNAL_TARGET_NOT_CONFIRMED;return 3;
    }
  fi
  say "FILE_TEST_TARGET=$path TEST_MIB=$mib rounds=2 mode=$mode raw_devices=NEVER"
  cat "$STEP_DIR/target-diskutil.txt"
  bin="$STEP_DIR/storage_file";compile_c "$ROOT/storage_file.c" "$bin" || { unknown FILE_ENGINE_BUILD_FAILED;return 3; }
  MACDIAG_STOP_GRACE=30 capture 14440 "$bin" "$mode" "$mib" 2 "$path" 14400;rc=$?
  [ "$rc" = 0 ] || record_leftover_file "$STEP_DIR"
  case "$rc" in 129|130|143) return "$rc";;esac
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
      hardware) if [ "${CAP_SUPERVISOR:-no}" = yes ] && need system_profiler; then supervise 60 system_profiler SPHardwareDataType SPDisplaysDataType; case $? in 129|130|143) return 130;;esac;fi;;
      power) need pmset && pmset -g batt || :;;
    esac
  done
  if [ "${CAP_DISKUTIL:-no}" = yes ];then pf_probe 8 diskutil list;fi
  result OBSERVED 5 INVENTORY_ONLY 'Сведения собраны; это не тест исправности.' 'Inventory collected; this is not a health test.'
}
power_main(){
  need pmset && pmset -g batt || :
  need pmset && pmset -g therm || :
  if [ "${CAP_SUPERVISOR:-no}" = yes ] && need powermetrics;then supervise 15 powermetrics -n 3 -i 1000; case $? in 129|130|143) return 130;;esac;fi
  result OBSERVED 5 POWER_OBSERVATION_ONLY 'Наблюдение не доказывает исправность питания и не заменяет измерения платы.' 'Observations do not certify power circuitry or replace board measurements.'
}
manual_main(){
  say 'MANUAL_CHECKLIST=Apple_Diagnostics,cold_boot_repeat,sleep_wake,AC_battery,display,WiFi,USB_ports,repair_report'
  result PENDING_MANUAL 6 MANUAL_AND_COLD_BOOT_REQUIRED 'Нужны независимый тест памяти и повтор после полного выключения; отдельно проверить экран, сон, батарею и порты.' 'Independent RAM validation and another cold boot are required; check display, sleep, battery and ports separately.'
}
raw_blocked(){ result BLOCKED 7 LEGACY_RAW_QUARANTINED 'Старый разрушительный движок сохранён, но отключён до отдельного аудита. Для приёмки используйте файловый тест 17.' 'Legacy destructive engine is retained but quarantined pending its own audit. Use file test 17 for acceptance.'; }
consent_files(){
  say "FILE_BACKEND=${FILE_BACKEND:-unavailable} NATIVE_MIB=1024 FALLBACK_MIB=256"
  printf 'RU: Каталог для отдельного тестового файла (native 1 ГиБ; Perl 256 МиБ) (Enter = домашний; 0 = пропустить).\nEN: Directory for a new test file (native 1 GiB; Perl 256 MiB) (Enter = home; 0 = skip).\n> '
  read_reply || return 3; [ "$REPLY" != 0 ] || return 3
  if [ "$ENVIRONMENT" != full ] && [ -z "$REPLY" ];then
    say 'RU: В Recovery укажите существующий каталог /Volumes/ИМЯ; новый том не создаётся. EN: Recovery needs an existing /Volumes/NAME directory.';return 3
  fi
  FILE_TARGET=${REPLY:-$HOME}
  FILE_TARGET=$(canonical_target "$FILE_TARGET") || { say 'FILE_TARGET_INVALID / Недопустимый каталог';return 3; }
  printf 'TARGET=%s\nRU: Будут созданы и проверены только временные тестовые файлы. Введите TEST-FILES.\nEN: Only new temporary test files will be created and verified. Type TEST-FILES.\n> ' "$FILE_TARGET"
  read_reply && [ "$REPLY" = TEST-FILES ] || return 3
  FILE_CONSENT=TEST-FILES
}
acceptance_main(){
  local kind state
  kind=$1
  if [ "$ENVIRONMENT" != full ] || [ "${RAM_BACKEND:-}" = perl_screen ];then recovery_suite "$kind";return $?;fi
  printf '%s\n' TOOLKIT HARDWARE POWER RAM_QUICK > "$SESSION/plan.txt" || return 3
  [ "$kind" = safe ] || printf '%s\n' RAM_FULL >> "$SESSION/plan.txt" || return 3
  printf '%s\n' CPU GPU NETWORK DOWNLOAD >> "$SESSION/plan.txt" || return 3
  [ "$kind" = safe ] || printf '%s\n' STORAGE_FILE >> "$SESSION/plan.txt" || return 3
  printf '%s\n' MANUAL >> "$SESSION/plan.txt" || return 3
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
  run_step NETWORK network_supervised || return $?
  run_step DOWNLOAD download_supervised || return $?
  [ "$LAST_STATE" != FAIL ] || { finish_suite;return $?; }
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
  SESSION_FINAL_STATE=$state
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
    printf '\nMac Hardware Diagnostics %s — единая версия / unified build\n' "$DIAG_VERSION"
    say "RU: Сценарии выбраны по возможностям. EN: Scenarios follow detected capabilities."
    say "RAM=$RAM_BACKEND CPU=$CPU_BACKEND FILE=$FILE_BACKEND GPU=$GPU_BACKEND"
    cat <<'MENU'
 1  SSD RAW / Стирание всего диска — ЗАБЛОКИРОВАНО / BLOCKED
 2  RAM QUICK / Память: native до 8 ГиБ / Perl-screen до 256 МиБ
 3  RAM EXTENDED / Расширенная: native до 48 ГиБ / Perl-screen до 1 ГиБ
 4  RAM MAP / Только native; в Perl недоступна / native only, NOT chip addresses
 5  CPU / Проверка вычислений SHA / SHA execution test
 6  GPU / Видеопамять: 256 МиБ на устройство / per device, experimental
 7  DISPLAY / Экран — ручная проверка / manual checklist
 8  NETWORK / Соединение HTTPS, DNS, TLS / connectivity
 9  DOWNLOAD / Скачивание, размер, SHA-256, Range / integrity
10  POWER / Питание: только наблюдение / observation only
11  HARDWARE / Сведения об оборудовании / inventory
12  SAFE SUITE / Короткий комплекс, без файлового SSD-теста / short suite
13  LEGACY RAW / Старый разрушающий комплекс — BLOCKED
14  SELFTEST / Проверка самого комплекта, НЕ железа / toolkit only
15  MODEL / OS / Выбор модели и ЗАГРУЖЕННОЙ ОС / running OS
16  POST-REPAIR / Приёмка после ремонта, БЕЗ стирания / NO erase
17  STORAGE FILE / Новый файл: native 1 ГиБ / Perl-screen 256 МиБ
18  RAM -> RESCUE / Отдельный тест 40 ГиБ / separate 40 GiB test
19  SUPPORT / Пакет обратной связи, ТОЛЬКО локально / NO upload
20  HDD/SSD READ-ONLY / Весь диск: ТОЛЬКО ЧТЕНИЕ, БЕЗ стирания / NO writes
 0  EXIT / Выход (также Enter / also Enter)
RU: Во время теста Ctrl+C останавливает запуск. Отчёт сохраняется отдельно.
EN: Ctrl+C stops the run. The report is stored separately.
MENU
    printf '> '
    read_reply || { say 'NO_INTERACTIVE_INPUT / Нет интерактивного ввода';return 3; }
    case "$REPLY" in
      0|'') MODE=exit;return 0;;1|13)MODE=raw;;2)MODE=ramquick;;3)MODE=ramfull;;4)MODE=rammap;;5)MODE=cpu;;6)MODE=gpu;;7)MODE=display;;8)MODE=network;;9)MODE=download;;10)MODE=power;;11)MODE=snapshot;;12)MODE=safe;;14)MODE=selftest;;
      15) if ! profile_choose;then say 'RU: Выбор отклонён; прежний профиль сохранён. EN: Selection rejected; previous profile retained.';fi;continue;;
      16)MODE=acceptance;;17)MODE=storage;;18)MODE=bridge;;19)MODE=support;;20)MODE=readonly;;
      *)say 'UNKNOWN_SELECTION / Неизвестный пункт: введите число 0–20.';continue;;
    esac
    return 0
  done
}
# Long transfers get the same process-group cancellation as native workloads.
network_supervised(){
  local rc
  if [ "${CAP_SUPERVISOR:-no}" != yes ];then network_main;return $?;fi
  capture 500 /bin/bash "$ROOT/run.sh" --engine network "$STEP_DIR"; rc=$?
  case "$rc" in 0|2|3) [ -f "$STEP_DIR/result.tsv" ] || { unknown NETWORK_RESULT_MISSING;return 3; };;129|130|143)return "$rc";;*)unknown NETWORK_ENGINE_INTERRUPTED;return 3;;esac
  return "$rc"
}
download_supervised(){
  local rc
  [ "${CAP_SUPERVISOR:-no}" = yes ] || { unknown DOWNLOAD_SUPERVISOR_UNAVAILABLE;return 3; }
  capture 14400 /bin/bash "$ROOT/run.sh" --engine download "$STEP_DIR"; rc=$?
  case "$rc" in 0|2|3) [ -f "$STEP_DIR/result.tsv" ] || { unknown DOWNLOAD_RESULT_MISSING;return 3; };;129|130|143)return "$rc";;*)unknown DOWNLOAD_ENGINE_INTERRUPTED;return 3;;esac
  return "$rc"
}
engine_main(){
  local mode=$1
  STEP_DIR=$2; export STEP_DIR
  [ -d "$STEP_DIR" ] && [ -w "$STEP_DIR" ] || return 3
  profile_detect
  [ "$KERNEL" = Darwin ] || return 3
  case "$mode" in
    cpu) [ "${CPU_BACKEND:-unavailable}" = sha_path ] && need perl && select_hash || return 3; cpu_stress;;
    network) network_main;; download) download_main;; *) return 3;;
  esac
}
main(){
  local base rc state
  case "${1:-}" in --version) say "VERSION=$DIAG_VERSION";return 0;;--engine) shift;engine_main "$@";return $?;;esac
  if [ -n "${MACDIAG_RELEASE_VERSION:-}" ] && [ "$MACDIAG_RELEASE_VERSION" != "$DIAG_VERSION" ];then unknown RELEASE_VERSION_MISMATCH; say 'RU: Версии загрузчика и пакета не совпадают. EN: Bootstrap and package versions differ.';return 3;fi
  profile_detect;profile_validate || { say 'RESULT=INCONCLUSIVE PROFILE_MISMATCH';return 3; }
  MODE=${1:-menu}
  base=/tmp
  if [ -n "${MACDIAG_REPORT_DIR:-}" ];then
    [ -d "$MACDIAG_REPORT_DIR" ] && [ -w "$MACDIAG_REPORT_DIR" ] || { say "REPORT_DIRECTORY_UNAVAILABLE";return 3; }
    base=$MACDIAG_REPORT_DIR
  elif [ "$ENVIRONMENT" = full ] && [ -n "${HOME:-}" ] && [ -d "$HOME" ];then
    base="$HOME/Library/Logs/MacHardwareDiagnostics";mkdir -p "$base" || base=/tmp
  elif [ -d /Volumes/RESCUE ] && [ -w /Volumes/RESCUE ];then base=/Volumes/RESCUE;fi
  SESSION=$(mktemp -d "$base/macdiag-v2.XXXXXX") || return 3
  STEP_DIR=$SESSION;export SESSION STEP_DIR
  SESSION_FINAL_STATE=;ACTIVE_STAGE_NAME=;ACTIVE_STAGE_DIR=;SESSION_EXECUTION_STATE=RUNNING
  SESSION_STARTED=$(date -u +%Y-%m-%dT%H:%M:%SZ)
  trap 'session_exit $?' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 129' HUP
  : > "$SESSION/summary.tsv" || return 3
  printf 'RUNNING\n' > "$SESSION/session.state" || return 3
  profile_show > "$SESSION/profile.txt" || return 3
  if [ -n "${PF_LOG:-}" ] && [ -f "$PF_LOG" ];then cp "$PF_LOG" "$SESSION/probes.log" || return 3;fi
  environment_record > "$SESSION/environment.tsv" || return 3
  printf '%b' "${CAP_ROWS:-}" > "$SESSION/capabilities.tsv" || return 3
  if [ -n "${MACDIAG_BOOT_LOG:-}" ] && [ -f "$MACDIAG_BOOT_LOG" ];then cp "$MACDIAG_BOOT_LOG" "$SESSION/bootstrap.log" || return 3;fi
  profile_show
  say "PROFILE_LOGS=$SESSION"
  case "$ENVIRONMENT:$base" in full:*) ;;*:/tmp) say 'RU: Журнал в /tmp исчезнет после перезагрузки Recovery. Скопируйте его на внешний том. EN: Recovery /tmp is volatile; preserve it on an external volume.';;esac
  if [ "$MODE" = menu ];then menu || return 3;fi
  cp "$SESSION/profile.txt" "$SESSION/profile.initial.txt" || return 3
  cp "$SESSION/environment.tsv" "$SESSION/environment.initial.tsv" || return 3
  profile_show > "$SESSION/profile.txt" || return 3
  environment_record > "$SESSION/environment.tsv" || return 3
  [ "$MODE" != exit ] || { SESSION_FINAL_STATE=OBSERVED;return 0; }
  say "SESSION_LOGS=$SESSION CODE_REF=${MACDIAG_CODE_REF:-LOCAL_UNPINNED}"
  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'exit 129' HUP
  if [ "$KERNEL" != Darwin ] && [ "$MODE" != selftest ];then unknown NON_MACOS_ENVIRONMENT;return 3;fi
  case "$MODE" in
    support)run_step SUPPORT support_main;;
    readonly)run_step STORAGE_READONLY readonly_main;;
    raw)run_step RAW raw_blocked;;
    selftest)run_step TOOLKIT selftest_main;;
    ramquick)run_step RAM_QUICK ram_main quick;;ramfull)run_step RAM_FULL ram_main full;;rammap)run_step RAM_MAP ram_main map;;
    cpu)run_step CPU cpu_main;;gpu)run_step GPU gpu_main;;
    network)run_step NETWORK network_supervised;;download)run_step DOWNLOAD download_supervised;;
    power)run_step POWER power_main;;snapshot)run_step HARDWARE snapshot_main;;display)run_step MANUAL manual_main;;
    storage)
      if consent_files;then run_step FILE file_main storage
      else run_step FILE unknown FILE_TEST_NOT_AUTHORIZED;fi;;
    bridge)
      BRIDGE_TARGET=/Volumes/RESCUE
      say 'TARGET=/Volumes/RESCUE TEST_MIB=40960'
      say 'RU: Отдельный тест займёт 40 ГиБ RAM и создаст новый файл на внешнем RESCUE. Введите RAM-BRIDGE.'
      say 'EN: This separate test locks 40 GiB RAM and creates a new file on external RESCUE. Type RAM-BRIDGE.'
      if ! read_reply || [ "$REPLY" != RAM-BRIDGE ];then run_step FILE unknown BRIDGE_NOT_AUTHORIZED;return 3;fi
      FILE_CONSENT=TEST-FILES
      run_step FILE file_main bridge;;
    acceptance|safe)acceptance_main "$MODE";rc=$?;return "$rc";;
    *)unknown UNKNOWN_MODE;return 3;;
  esac
  rc=$?;[ "$rc" -eq 0 ] || { printf 'INTERRUPTED\n' > "$SESSION/session.state";return "$rc"; }
  SESSION_FINAL_STATE=$LAST_STATE
  case "$LAST_STATE" in PASS)rc=0;;FAIL)rc=2;;OBSERVED)rc=5;;PENDING_MANUAL)rc=6;;BLOCKED)rc=7;;*)rc=3;;esac
  say "FINAL_STATE=$LAST_STATE LOGS=$SESSION";return "$rc"
}
if [ "${BASH_SOURCE[0]}" = "$0" ];then main "$@";exit $?;fi
