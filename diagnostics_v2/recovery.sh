#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Capability-selected fallbacks. A clean screen never becomes native acceptance.
native_budget(){
  local requested available reserve total stats
  requested=$1;total=$((RAM_BYTES/1048576));reserve=$((total/8))
  [ "$reserve" -ge 1024 ] || reserve=1024
  stats=$(pf_probe 5 vm_stat 2>/dev/null) || return 3
  available=$(printf '%s\n' "$stats" | awk '
    NR==1 {for(i=1;i<=NF;i++) if($i=="of") page=$(i+1)}
    /^Pages (free|inactive|speculative):/ {gsub(/[^0-9]/,"",$NF);n+=$NF;seen++}
    END {if(page>0 && seen>=1) printf "%.0f",n*page/1048576}')
  case "$available" in ""|*[!0-9]*)return 3;;esac
  available=$((available-reserve))
  [ "$available" -ge 32 ] || return 3
  [ "$requested" -le "$available" ] || requested=$available
  printf '%s\n' "$requested"
}
# A "completed_mib" value denotes a whole completed pattern set, not partial progress.
coverage_record(){
  local planned budget completed installed status
  planned=$1;budget=$2;completed=$3;installed=$4;status=$5
  printf 'planned_mib\t%s\nbudget_mib\t%s\ncompleted_mib\t%s\ninstalled_mib\t%s\nstatus\t%s\n' \
    "$planned" "$budget" "$completed" "$installed" "$status" > "$STEP_DIR/coverage.tmp" &&
    mv "$STEP_DIR/coverage.tmp" "$STEP_DIR/coverage.tsv"
}
canonical_target(){
  local path
  [ -n "$1" ] && [ -d "$1" ] || return 3
  path=$(CDPATH='' cd -P -- "$1" && pwd -P) || return 3
  case "$path" in /|/dev|/dev/*|*$'\t'*|*$'\n'*|*$'\r'*)return 3;;esac
  if [ "${ENVIRONMENT:-unknown}" != full ];then case "$path" in /Volumes/*);;*)return 3;;esac;fi
  printf '%s\n' "$path"
}
# Record the actual selected mount. /Volumes/name is not itself proof of a mount.
target_preflight(){
  local path info mount dfout
  path=$(canonical_target "$1") || { unknown FILE_TARGET_INVALID;return 3; }
  [ -w "$path" ] || { unknown FILE_TARGET_NOT_WRITABLE;return 3; }
  info=$(pf_probe 8 diskutil info "$path" 2>/dev/null);local info_rc=$?
  printf '%s\n' "$info" > "$STEP_DIR/target-diskutil.txt" || return 3
  mount=$(printf '%s\n' "$info" | awk -F: '/^[ \t]*Mount Point:/{sub(/^[^:]*:[ \t]*/,"");sub(/[ \t]+$/,"");print;exit}')
  if [ "${ENVIRONMENT:-unknown}" != full ];then
    [ "$info_rc" -eq 0 ] || { unknown RECOVERY_MOUNT_UNCONFIRMED;return 3; }
    case "$mount" in /Volumes/*);;*)unknown RECOVERY_MOUNT_UNCONFIRMED;return 3;;esac
    case "$path" in "$mount"|"$mount"/*);;*)unknown RECOVERY_MOUNT_UNCONFIRMED;return 3;;esac
  fi
  dfout=$(pf_probe 5 df -Pk "$path" 2>/dev/null) || { unknown FREE_SPACE_UNKNOWN;return 3; }
  printf '%s\n' "$dfout" > "$STEP_DIR/target-df.txt" || return 3
  printf 'canonical_path\t%s\nmount_point\t%s\nmetadata_exit\t%s\n' "$path" "${mount:-unknown}" "$info_rc" > "$STEP_DIR/target.tsv" || return 3
  TARGET_CANONICAL=$path
  say "TARGET_CANONICAL=$path MOUNT_POINT=${mount:-unknown}"
}
# Inspect only the exact name emitted by this engine. Never scan/delete by wildcard.
record_leftover_file(){
  local dir path
  dir=$1
  [ -f "$dir/engine.log" ] || return 0
  while IFS= read -r path;do
    case "${path##*/}" in .macdiag-test-*|macdiag-screen-*);;*)continue;;esac
    if [ -f "$path" ] && [ ! -L "$path" ];then
      printf 'LEFTOVER_TEST_FILE=%s\n' "$path" | tee -a "$dir/leftover-files.txt"
      say 'RU: Возможен оставшийся тестовый файл; не удалять без проверки. EN: A test file may remain; verify before removal.'
    fi
  done < <(sed -n 's/^TEST_FILE=//p' "$dir/engine.log")
}
recovery_ram_main(){
  local mode mib total rc
  mode=$1;total=$((RAM_BYTES/1048576))
  [ "$mode" != map ] || { unknown RAM_MAP_REQUIRES_NATIVE;return 3; }
  [ "${RAM_BACKEND:-unavailable}" = perl_screen ] && [ "$total" -ge 128 ] || { unknown RECOVERY_RAM_RUNTIME_UNAVAILABLE;return 3; }
  mib=256;[ "$mode" != full ] || mib=1024
  [ "$mib" -le "$((total/8))" ] || mib=$((total/8))
  # Hard cap remains 1 GiB; Perl virtual allocations are not equivalent to wired DRAM.
  say "RECOVERY_RAM_PLAN mode=$mode mib=$mib backend=perl_screen"
  coverage_record "$mib" "$mib" 0 "$total" SCREEN_PENDING || return 3
  capture 1810 perl "$ROOT/recovery_ram.pl" "$mib" 1;rc=$?
  case "$rc" in
    0) grep -qx 'ENGINE_COMPLETE=RAM_SCREEN_CLEAN' "$STEP_DIR/engine.log" || { unknown RECOVERY_SCREEN_INCOMPLETE;return 3; }
      coverage_record "$mib" "$mib" "$mib" "$total" SCREEN_ONLY || return 3
      result INCONCLUSIVE 3 RAM_SCREEN_CLEAN_NATIVE_PENDING 'Ограниченный скрининг завершён без несовпадений. Без mlock и нативного движка вся физическая RAM не проверена.' 'Limited screening found no mismatch. Without mlock/native verification, physical RAM acceptance is incomplete.';;
    2)fault RAM_DATA_PATH_MISMATCH_INDEPENDENT_CONFIRMATION_REQUIRED;;
    129|130|143)return "$rc";;*)unknown RECOVERY_SCREEN_INCOMPLETE;;
  esac
}
recovery_file_main(){
  local path rc free
  path=${FILE_TARGET:-}
  [ "${FILE_BACKEND:-}" = perl_file_screen ] && [ "${FILE_CONSENT:-}" = TEST-FILES ] && [ -d "$path" ] || { unknown RECOVERY_FILE_PREREQUISITE_OR_CONSENT;return 3; }
  # Recovery must name an existing mounted-volume directory; never default to /var/root.
  target_preflight "$path" || return 3;path=$TARGET_CANONICAL
  free=$(awk 'NR==2 {print $4}' "$STEP_DIR/target-df.txt")
  case "$free" in ''|*[!0-9]*)unknown FREE_SPACE_UNKNOWN;return 3;;esac
  [ "$free" -ge 1310720 ] || { unknown INSUFFICIENT_FREE_SPACE;return 3; }
  MACDIAG_STOP_GRACE=30 capture 945 perl "$ROOT/recovery_file.pl" "$path" 256;rc=$?
  [ "$rc" = 0 ] || record_leftover_file "$STEP_DIR"
  case "$rc" in
    0) grep -qx 'ENGINE_COMPLETE=FILE_SCREEN_CLEAN' "$STEP_DIR/engine.log" || { unknown FILE_COMPLETION_MISSING;return 3; }
      result INCONCLUSIVE 3 FILE_SCREEN_CLEAN_CACHE_UNPROVEN '256 МиБ записаны и дважды сверены. Исключение дискового кэша и проверка всего SSD не выполнены.' '256 MiB written and verified twice. Cache exclusion and whole-device verification are not established.';;
    2)fault FILE_OR_RAM_IO_PATH_FAILURE_NOT_COMPONENT_DIAGNOSIS;;
    129|130|143)return "$rc";;*)unknown FILE_RESOURCES_CACHE_CONTROLS_OR_INTERRUPTION;;
  esac
}
recovery_suite(){
  local kind=${1:-acceptance}
  printf '%s\n' TOOLKIT HARDWARE POWER RAM_SCREEN > "$SESSION/plan.txt" || return 3
  [ "$kind" = safe ] || printf '%s\n' RAM_EXTENDED >> "$SESSION/plan.txt" || return 3
  printf '%s\n' CPU NETWORK DOWNLOAD >> "$SESSION/plan.txt" || return 3
  [ "$kind" = safe ] || printf '%s\n' STORAGE_FILE >> "$SESSION/plan.txt" || return 3
  printf '%s\n' MANUAL >> "$SESSION/plan.txt" || return 3
  run_step TOOLKIT selftest_main || return $?
  [ "$LAST_STATE" = PASS ] || { finish_suite;return $?; }
  run_step HARDWARE snapshot_main || return $?
  run_step POWER power_main || return $?
  run_step RAM_SCREEN ram_main quick || return $?
  [ "$LAST_STATE" != FAIL ] || { finish_suite;return $?; }
  if [ "$kind" != safe ];then
    run_step RAM_EXTENDED ram_main full || return $?
    [ "$LAST_STATE" != FAIL ] || { finish_suite;return $?; }
  fi
  # Limited/missing RAM verification does NOT authorize destructive work or hardware verdicts.
  say 'DEPENDENT_RESULT_ATTRIBUTION=UNCONFIRMED_RAM_BASELINE'
  run_step CPU cpu_main || return $?
  [ "$LAST_STATE" != FAIL ] || { finish_suite;return $?; }
  run_step NETWORK network_supervised || return $?
  run_step DOWNLOAD download_supervised || return $?
  if [ "$kind" != safe ];then
    if consent_files;then run_step STORAGE_FILE file_main storage || return $?
    else run_step STORAGE_FILE unknown FILE_STAGE_NOT_AUTHORIZED || return $?;fi
  fi
  run_step MANUAL manual_main || return $?
  finish_suite
}
environment_record(){
  printf 'schema\t1\nversion\t%s\nmodel\t%s\ncpu\t%s\narch\t%s\nos\t%s\nbuild\t%s\nenvironment\t%s\nprofile\t%s\nconsole\t%s\nram_backend\t%s\nfile_backend\t%s\n' \
    "$DIAG_VERSION" "$MODEL" "$CPU" "$ARCH" "$OS_VERSION" "$OS_BUILD" "$ENVIRONMENT" "$PROFILE_ID" "$CONSOLE" "$RAM_BACKEND" "$FILE_BACKEND"
}
# Minimal allowlisted export. Raw logs, addresses, environment and paths are NOT copied.
support_export(){
  local src out rc
  src=$1
  [ -d "$src" ] && [ ! -L "$src/environment.tsv" ] && [ ! -L "$src/summary.tsv" ] || return 3
  [ -f "$src/environment.tsv" ] && [ -s "$src/summary.tsv" ] || { unknown SUPPORT_NO_RESULTS;return 3; }
  out=$(mktemp -d "$src/support-review.XXXXXX") || return 3
  awk -F '\t' 'NF==2 && $1 ~ /^(schema|version|model|cpu|arch|os|build|environment|profile|console|ram_backend|file_backend)$/ && length($2)<=120 && $2 ~ /^[A-Za-z0-9,._-]+$/ {print $1 "\t" $2}' "$src/environment.tsv" > "$out/environment.tsv" || return 3
  awk -F '\t' 'NF==4 && length($1)<=40 && length($3)<=120 && $1 ~ /^[A-Z0-9_]+$/ && $2 ~ /^(PASS|FAIL|INCONCLUSIVE|OBSERVED|BLOCKED|PENDING_MANUAL|NOT_RUN)$/ && $3 ~ /^[A-Z0-9_]+$/ {print $1 "\t" $2 "\t" $3}' "$src/summary.tsv" > "$out/summary.tsv" || return 3
  [ -s "$out/summary.tsv" ] || { unknown SUPPORT_NO_VALID_RESULTS;return 3; }
  {
    printf '# Diagnostic feedback draft / Черновик обратной связи\n\n'
    printf 'REVIEW REQUIRED. Nothing has been uploaded. / Требуется просмотр. Ничего не отправлено.\n\n'
    printf '```text\n';cat "$out/environment.tsv" "$out/summary.tsv";printf '```\n\n'
    printf 'Describe expected/actual behavior after reviewing identifiers. Attach raw logs only through an agreed private channel.\n'
    printf 'Опишите ожидаемое и фактическое поведение после проверки сведений. Полные журналы — только по согласованному закрытому каналу.\n'
    printf '\nhttps://github.com/pioner22/MacOS/issues/new\n'
  } > "$out/ISSUE_DRAFT.md" || return 3
  printf 'No upload. No credentials. Raw logs excluded. Review before sharing.\nНет отправки, токенов и сырых логов. Проверьте содержимое перед публикацией.\n' > "$out/REVIEW_REQUIRED.txt"
  if need tar;then tar -czf "$out.tar.gz" -C "$out" environment.tsv summary.tsv ISSUE_DRAFT.md REVIEW_REQUIRED.txt || return 3;fi
  say "SUPPORT_EXPORT=$out"
  result OBSERVED 5 SUPPORT_SAVED_NOT_SENT 'Подготовлены только разрешённые поля. Просмотрите пакет; отправки в GitHub или на сервер не было.' 'Only allowlisted fields were exported. Review the package; nothing was sent to GitHub or a server.'
}
support_main(){
  local src candidate recent=''
  for candidate in "${SESSION%/*}"/macdiag-v2.*;do
    [ "$candidate" != "$SESSION" ] && [ -d "$candidate" ] && [ ! -L "$candidate" ] &&
      [ -s "$candidate/summary.tsv" ] && [ ! -L "$candidate/summary.tsv" ] || continue
    if [ -z "$recent" ] || [ "$candidate/summary.tsv" -nt "$recent/summary.tsv" ];then recent=$candidate;fi
  done
  say "SUPPORT_DEFAULT_PREVIOUS=${recent:-NONE}"
  printf 'RU: Каталог отчёта (Enter = показанный предыдущий, НЕ новый пустой).\nEN: Report directory (Enter = previous shown above, NOT empty new run).\n> '
  read_reply || { unknown SUPPORT_DIRECTORY_NOT_SELECTED;return 3; }
  src=${REPLY:-$recent};[ -n "$src" ] || { unknown SUPPORT_NO_PREVIOUS_SESSION;return 3; }
  support_export "$src"
}
