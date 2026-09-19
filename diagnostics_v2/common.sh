#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Bash 3.2. No eval, sudo, device writes or automatic repairs.
export LC_ALL=C
umask 077
DIAG_VERSION=2.0.0-rc1
say(){ printf '%s\n' "$*"; }
valid_uint(){ case "$1" in ''|*[!0-9]*) return 1;; esac; [ "${#1}" -le 9 ] && [ "$1" -ge "$2" ] && [ "$1" -le "$3" ]; }
result(){
  local state code reason ru en
  state=$1; code=$2; reason=$3; ru=$4; en=$5
  printf 'RESULT=%s\nREASON=%s\nRU: %s\nEN: %s\n' "$state" "$reason" "$ru" "$en"
  if [ -n "${STEP_DIR:-}" ]; then
    printf '%s\t%s\t%s\n' "$state" "$code" "$reason" > "$STEP_DIR/result.tmp" &&
      mv "$STEP_DIR/result.tmp" "$STEP_DIR/result.tsv" || return 3
  fi
  return "$code"
}
unknown(){ result INCONCLUSIVE 3 "$1" 'Проверка не завершена; это не аппаратный диагноз. Сохраните лог и устраните указанное ограничение.' 'Incomplete test, not a hardware diagnosis. Preserve the log and resolve the reported limitation.'; }
fault(){ result FAIL 2 "$1" 'Обнаружена ошибка проверяемого пути. Сохраните лог; конкретный компонент ещё не установлен.' 'A tested-path failure was observed. Preserve the log; the faulty component is not yet identified.'; }
passed(){ result PASS 0 "$1" 'Проверенный этап завершён без обнаруженных ошибок. Это не гарантия исправности всего ноутбука.' 'The tested stage completed without detected errors, not a whole-machine guarantee.'; }
need(){ command -v "$1" >/dev/null 2>&1; }
select_hash(){
  local tool got
  SHA_CMD=()
  for tool in sha256sum shasum; do
    need "$tool" || continue
    if [ "$tool" = shasum ]; then SHA_CMD=(shasum -a 256); else SHA_CMD=(sha256sum); fi
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
# Kill only descendants of a child we started. The parent is not reaped until done.
kill_children(){
  local parent sig child
  parent=$1; sig=$2
  for child in $(ps -axo pid=,ppid= | awk -v p="$parent" '$2==p{print $1}'); do
    kill_children "$child" "$sig"
  done
  kill -"$sig" "$parent" 2>/dev/null || :
}
supervise(){
  local seconds pid watcher rc
  seconds=$1; shift
  rm -f "$STEP_DIR/timed-out"
  "$@" & pid=$!
  (
    local n=0
    while [ "$n" -lt "$seconds" ]; do
      kill -0 "$pid" 2>/dev/null || exit 0
      sleep 1; n=$((n+1))
      [ $((n%10)) -ne 0 ] || sync
    done
    : > "$STEP_DIR/timed-out"
    kill_children "$pid" TERM
    sleep 3
    kill_children "$pid" KILL
  ) & watcher=$!
  trap 'kill_children "$pid" TERM; kill_children "$watcher" TERM; wait "$pid" 2>/dev/null; return 130' INT
  trap 'kill_children "$pid" TERM; kill_children "$watcher" TERM; wait "$pid" 2>/dev/null; return 143' TERM HUP
  wait "$pid"; rc=$?
  kill_children "$watcher" TERM
  wait "$watcher" 2>/dev/null || :
  trap - INT TERM HUP
  [ ! -e "$STEP_DIR/timed-out" ] || return 124
  return "$rc"
}
compile_c(){
  local source out compiler
  source=$1; out=$2
  compiler=''
  if [ "$(uname -s)" = Darwin ]; then
    need xcode-select && xcode-select -p >/dev/null 2>&1 || return 3
    compiler=$(xcrun -f clang 2>/dev/null) || return 3
  else compiler=$(command -v cc) || return 3; fi
  rm -f "$out"
  "$compiler" -std=c11 -O2 -Wall -Wextra -Werror "$source" -o "$out" > "$STEP_DIR/compile.log" 2>&1 || {
    cat "$STEP_DIR/compile.log"; rm -f "$out"; return 3;
  }
  [ -f "$out" ] && [ -x "$out" ]
}
# Emit a checked child result. An unstructured exit 0 can never pass a suite.
run_step(){
  local name dir rc state declared reason extra ps
  name=$1; shift
  dir=$(mktemp -d "$SESSION/${name}.XXXXXX") || return 3
  printf '%s\tRUNNING\n' "$name" > "$SESSION/current-stage.tsv"
  sync
  say "STEP_START=$name LOG=$dir/output.log"
  ( STEP_DIR=$dir; export STEP_DIR; "$@" ) 2>&1 | tee "$dir/output.log"
  ps=("${PIPESTATUS[@]}"); rc=${ps[0]:-3}
  state=INCONCLUSIVE; reason=MISSING_RESULT; declared=3; extra=''
  if [ -f "$dir/result.tsv" ] && [ "$(wc -l < "$dir/result.tsv" | tr -d ' ')" = 1 ]; then
    IFS=$'\t' read -r state declared reason extra < "$dir/result.tsv"
  fi
  case "$state:$declared" in PASS:0|FAIL:2|INCONCLUSIVE:3|OBSERVED:5|PENDING_MANUAL:6|BLOCKED:7) ;;
    *) state=INCONCLUSIVE; reason=INVALID_RESULT_CONTRACT; declared=3;; esac
  case "$reason" in ''|*[!A-Z0-9_]*) state=INCONCLUSIVE; reason=INVALID_REASON;; esac
  [ -z "${extra:-}" ] || { state=INCONCLUSIVE; reason=EXTRA_RESULT_FIELDS; }
  if [ "$rc" -ne "$declared" ]; then state=INCONCLUSIVE; reason=PROCESS_EXIT_WITHOUT_MATCHING_RESULT; fi
  if [ "${ps[1]:-1}" -ne 0 ]; then state=INCONCLUSIVE; reason=LOG_WRITE_FAILED; fi
  case "$rc" in 130|143) state=INCONCLUSIVE; reason=INTERRUPTED;; esac
  printf '%s\t%s\t%s\t%s\n' "$name" "$state" "$reason" "$dir" >> "$SESSION/summary.tsv" || return 3
  printf '%s\t%s\n' "$name" "$state" > "$SESSION/current-stage.tsv"
  sync
  LAST_STATE=$state; LAST_REASON=$reason
  say "STEP_END=$name STATE=$state REASON=$reason"
  case "$rc" in 130|143) return "$rc";; esac
  return 0
}
suite_state(){
  # FAIL has priority over pending/manual/missing coverage.
  awk -F '\t' '
    $2=="FAIL" {bad=1}
    $2=="INCONCLUSIVE" || $2=="BLOCKED" {unknown=1}
    $2=="PENDING_MANUAL" {manual=1}
    $2=="PASS" {pass++}
    END {if(bad) print "FAIL"; else if(unknown || !pass) print "INCONCLUSIVE"; else if(manual) print "PENDING_MANUAL"; else print "PASS"}
  ' "$1"
}

capture(){
  local -a capture_status
  supervise "$@" 2>&1 | tee "$STEP_DIR/engine.log"
  capture_status=("${PIPESTATUS[@]}")
  [ "${capture_status[1]:-1}" -eq 0 ] || return 3
  return "${capture_status[0]:-3}"
}
