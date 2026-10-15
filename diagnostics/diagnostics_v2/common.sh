#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Bash 3.2. No eval, sudo, device writes or automatic repairs.
export LC_ALL=C
umask 077
COMMON_ROOT=$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd) || return 3
DIAG_VERSION=2.0.0-rc8
say(){ printf '%s\n' "$*"; }
valid_uint(){ case "$1" in ''|*[!0-9]*|0[0-9]*) return 1;; esac; [ "${#1}" -le 9 ] && [ "$1" -ge "$2" ] && [ "$1" -le "$3" ]; }
result(){
  local state code reason ru en
  state=$1; code=$2; reason=$3; ru=$4; en=$5
  printf 'RESULT=%s\nREASON=%s\nRU: %s\nEN: %s\n' "$state" "$reason" "$ru" "$en"
  if [ -n "${STEP_DIR:-}" ]; then
    printf '%s\t%s\t%s\n' "$state" "$code" "$reason" > "$STEP_DIR/result.tmp" &&
      mv "$STEP_DIR/result.tmp" "$STEP_DIR/result.tsv" || return 3
  fi
  if [ -n "${STEP_DIR:-}" ]; then
    printf 'RU: %s\nEN: %s\n' "$ru" "$en" > "$STEP_DIR/explanation.txt" || return 3
  fi
  return "$code"
}
unknown(){ result INCONCLUSIVE 3 "$1" 'Проверка не завершена; это не аппаратный диагноз. Сохраните лог и устраните указанное ограничение.' 'Incomplete test, not a hardware diagnosis. Preserve the log and resolve the reported limitation.'; }
fault(){ result FAIL 2 "$1" 'Обнаружена ошибка проверяемого пути. Сохраните лог; конкретный компонент ещё не установлен.' 'A tested-path failure was observed. Preserve the log; the faulty component is not yet identified.'; }
passed(){ result PASS 0 "$1" 'Проверенный этап завершён без обнаруженных ошибок. Это не гарантия исправности всего ноутбука.' 'The tested stage completed without detected errors, not a whole-machine guarantee.'; }
need(){ command -v "$1" >/dev/null 2>&1; }
select_hash(){
  if [ -n "${REGISTRY_STATUS:-}" ] && declare -F rg_has >/dev/null && [ "$REGISTRY_STATUS" = VALID ];then
    rg_has sha256 || return 1
    SHA_CMD=("${DIAG_SHA_CMD[@]}");return 0
  fi
  local tool got
  SHA_CMD=()
  for tool in sha256sum shasum openssl; do
    need "$tool" || continue
    case "$tool" in shasum) SHA_CMD=(shasum -a 256);;openssl) SHA_CMD=(openssl dgst -sha256 -r);;*) SHA_CMD=(sha256sum);;esac
    got=$(printf abc | "${SHA_CMD[@]}") || continue
    if [ "${got%% *}" = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad ]; then return 0; fi
  done
  SHA_CMD=(); return 1
}
hash_file(){ local out; out=$("${SHA_CMD[@]}" "$1") || return 1; printf '%s\n' "${out%% *}"; }
read_reply(){
  REPLY=''
  if ( : </dev/tty ) 2>/dev/null; then IFS= read -r REPLY </dev/tty
  elif [ -t 0 ]; then IFS= read -r REPLY
  else return 1; fi
}
# Supervisor owns a private process group and does not remove caller traps.
supervise(){
  local seconds logfile
  seconds=$1; shift
  need perl || return 3
  logfile=$(mktemp "$STEP_DIR/supervisor.XXXXXX") || return 3
  "${DIAG_PERL:-perl}" "$COMMON_ROOT/supervise.pl" "$seconds" "$logfile" "$@"
}
compile_c(){
  local source out compiler
  source=$1; out=$2
  compiler=''
  if [ "$(uname -s)" = Darwin ]; then
    need xcode-select && xcode-select -p >/dev/null 2>&1 || return 3
    compiler=${CAP_CLANG:-$(xcrun -f clang 2>/dev/null)}; [ -n "$compiler" ] || return 3
  else compiler=$(command -v cc) || return 3; fi
  rm -f "$out"
  supervise 120 "$compiler" -std=c11 -O2 -Wall -Wextra "$source" -o "$out" > "$STEP_DIR/compile.log" 2>&1 || {
    cat "$STEP_DIR/compile.log"; rm -f "$out"; return 3;
  }
  [ ! -s "$STEP_DIR/compile.log" ] || cat "$STEP_DIR/compile.log"
  [ -f "$out" ] && [ -x "$out" ]
}
# Emit a checked child result. An unstructured exit 0 can never pass a suite.
run_step(){
  local name dir rc state declared reason extra ps
  name=$1; shift
  case "$name" in ''|*[!A-Z0-9_]*) return 3;;esac
  dir=$(mktemp -d "$SESSION/${name}.XXXXXX") || return 3
  printf '%s\tRUNNING\n' "$name" > "$SESSION/current-stage.tsv" || return 3
  # Keep the started stage available to main's EXIT finalizer. A tty trap can
  # run before the pipeline's post-processing, so it must not become NOT_RUN.
  ACTIVE_STAGE_NAME=$name; ACTIVE_STAGE_DIR=$dir
  printf '%s\t%s\n' "$name" "$dir" > "$SESSION/active-stage.tsv" || return 3
  # No unbounded global sync on a suspect device. Per-engine durability is reported.
  say "STEP_START=$name LOG=$dir/output.log"
  ( STEP_DIR=$dir; STAGE_ID=$name; export STEP_DIR STAGE_ID
    trap 'exit 130' INT
    trap 'exit 143' TERM
    trap 'exit 129' HUP
    if declare -F registry_gate >/dev/null;then
      registry_gate "$name" && "$@"
    else "$@";fi
  ) 2>&1 | tee -i "$dir/output.log"
  ps=("${PIPESTATUS[@]}"); rc=${ps[0]:-3}
  state=INCONCLUSIVE; reason=MISSING_RESULT; declared=3; extra=''
  if [ -f "$dir/result.tsv" ] && awk -F '\t' 'NR==1 && NF==3 && $1!="" && $2!="" && $3!="" {ok=1} END{exit (NR==1 && ok)?0:1}' "$dir/result.tsv"; then
    IFS=$'\t' read -r state declared reason extra < "$dir/result.tsv"
  fi
  case "$state:$declared" in PASS:0|FAIL:2|INCONCLUSIVE:3|OBSERVED:5|PENDING_MANUAL:6|BLOCKED:7) ;;
    *) state=INCONCLUSIVE; reason=INVALID_RESULT_CONTRACT; declared=3;; esac
  case "$reason" in ''|*[!A-Z0-9_]*) state=INCONCLUSIVE; reason=INVALID_REASON;; esac
  [ -z "${extra:-}" ] || { state=INCONCLUSIVE; reason=EXTRA_RESULT_FIELDS; }
  if [ "$rc" -ne "$declared" ]; then state=INCONCLUSIVE; reason=PROCESS_EXIT_WITHOUT_MATCHING_RESULT; fi
  if [ "${ps[1]:-1}" -ne 0 ]; then state=INCONCLUSIVE; reason=LOG_WRITE_FAILED; fi
  case "$rc" in 129|130|143) state=INCONCLUSIVE; reason=INTERRUPTED;; esac
  if [ "$state" = INCONCLUSIVE ] && [ -f "$dir/result.tsv" ] && awk -F '\t' 'NR==1 && NF==3 && $1=="FAIL" && $2=="2" && $3~/^[A-Z0-9_]+$/ {ok=1} END{exit (NR==1 && ok)?0:1}' "$dir/result.tsv";then
    printf 'SECONDARY_REASON=%s PROCESS_EXIT=%s\n' "$reason" "$rc" > "$dir/termination.txt" || return 3
    state=FAIL;reason=$(awk -F '\t' 'NR==1{print $3}' "$dir/result.tsv")
  fi
  printf '%s\t%s\t%s\t%s\n' "$name" "$state" "$reason" "$dir" >> "$SESSION/summary.tsv" || return 3
  printf '%s\t%s\n' "$name" "$state" > "$SESSION/current-stage.tsv" || return 3
  # No unbounded global sync on a suspect device. Per-engine durability is reported.
  ACTIVE_STAGE_NAME=; ACTIVE_STAGE_DIR=
  LAST_STATE=$state; LAST_REASON=$reason
  say "STEP_END=$name STATE=$state REASON=$reason"
  if declare -F report_render >/dev/null;then report_render RUNNING || return 3;fi
  if declare -F next_step >/dev/null;then next_step "$reason" "$state";fi
  case "$rc" in 129|130|143) return "$rc";; esac
  return 0
}
suite_state(){
  # FAIL has priority over pending/manual/missing coverage.
  awk -F '\t' '
    $2=="FAIL" {bad=1}
    $2=="INCONCLUSIVE" || $2=="BLOCKED" || $2=="NOT_RUN" {unknown=1}
    $2=="PENDING_MANUAL" {manual=1}
    $2=="PASS" {pass++}
    END {if(bad) print "FAIL"; else if(unknown || !pass) print "INCONCLUSIVE"; else if(manual) print "PENDING_MANUAL"; else print "PASS"}
  ' "$1"
}

capture(){
  local seconds
  seconds=$1;shift
  need perl || return 3
  "${DIAG_PERL:-perl}" "$COMMON_ROOT/supervise.pl" "$seconds" "$STEP_DIR/engine.log" "$@"
}
