#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Bash 3.2; no hardware diagnosis is inferred from an exit code alone.
export LC_ALL=C
umask 077
D_VERSION=0.3.0-rc1
D_CHILD=''
d_num(){
  case ${1:-} in ''|*[!0-9]*) return 1;; esac
  [ ${#1} -le 9 ] || return 1
  # Decimal conversion prevents leading zeroes from becoming octal in arithmetic.
  [ "$((10#$1))" -ge "$2" ] && [ "$((10#$1))" -le "$3" ]
}
d_sha(){
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"
  elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$@"
  else return 3; fi
}
d_hash_ready(){
  local got p=()
  printf abc | d_sha > "$D_WORK/hash-check"
  p=("${PIPESTATUS[@]}")
  [ "${p[0]}" -eq 0 ] && [ "${p[1]}" -eq 0 ] || return 3
  read -r got _ < "$D_WORK/hash-check"
  [ "$got" = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad ]
}
d_log(){
  printf '%s\n' "$*"
  printf '%s\n' "$*" >> "$D_LOG" || { D_LOG_FAILED=1; return 3; }
}
d_result(){
  local state=$1 code=$2 reason=$3 ru=$4 en=$5
  D_STATE=$state; D_REASON=$reason
  d_log "RESULT=$state code=$code reason=$reason component_attribution=UNCONFIRMED"
  d_log "RU: $ru"
  d_log "EN: $en"
  d_log 'NEXT_RU: Сохраните журнал. FAIL описывает наблюдение, не конкретную неисправную микросхему; PASS ограничен выполненным объёмом.'
  d_log 'NEXT_EN: Keep the report. FAIL is an observation, not a chip diagnosis; PASS covers only the completed scope.'
  if [ "${D_LOG_FAILED:-0}" -ne 0 ] && [ "$code" -eq 0 ];then
    D_STATE=INCONCLUSIVE;D_REASON=LOG_WRITE_FAILURE
    printf 'RESULT=INCONCLUSIVE code=3 reason=LOG_WRITE_FAILURE\n'
    return 3
  fi
  return "$code"
}
d_cancel(){
  trap - INT TERM HUP
  if [ -n "$D_CHILD" ]; then kill -TERM "$D_CHILD" 2>/dev/null || :; wait "$D_CHILD" 2>/dev/null || :; fi
  d_result CANCELLED 130 USER_OR_SIGNAL 'Тест прерван; успешное завершение не подтверждено.' 'Interrupted; successful completion is not established.'
  exit 130
}
d_init(){
  local name=$1 base
  case "$name" in ''|*[!a-zA-Z0-9_-]*) return 3;; esac
  base=${MACDIAG_REPORT_DIR:-}
  if [ -z "$base" ]; then
    if [ -d /Volumes/RESCUE ] && [ -w /Volumes/RESCUE ]; then base=/Volumes/RESCUE
    elif [ -n "${HOME:-}" ] && [ -d "$HOME" ] && [ -w "$HOME" ]; then base="$HOME/MacDiag-Reports"
    else base=/tmp; fi
  fi
  mkdir -p "$base" || return 3
  base=$(cd "$base" && pwd -P) || return 3
  D_WORK=$(mktemp -d "$base/macdiag-${name}.XXXXXXXX") || return 3
  D_LOG="$D_WORK/session.log"; : > "$D_LOG" || return 3
  D_STATE=INCONCLUSIVE; D_REASON=NOT_COMPLETED; D_LOG_FAILED=0
  trap d_cancel INT TERM HUP
  d_log "TOOLKIT_VERSION=$D_VERSION TEST=$name REPORT_DIR=$D_WORK SNAPSHOT=${MACDIAG_SNAPSHOT:-LOCAL_UNPINNED}"
  d_log 'RU: Пишутся журналы и служебные файлы. /tmp и swap могут находиться на SSD. Имя RESCUE не доказывает, что диск внешний.'
  d_log 'EN: Logs and scratch files are written. /tmp and swap may use SSD. The RESCUE name does not establish external-device identity.'
}
d_need(){
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || { d_result INCONCLUSIVE 3 "MISSING_$c" "Недоступна команда $c." "Missing command $c."; return 3; }
  done
}
d_confirm(){
  local expected=$1 answer=''
  printf 'RU: Введите %s. EN: Type %s: ' "$expected" "$expected"
  if ! { exec 3</dev/tty; } 2>/dev/null; then return 1; fi
  IFS= read -r answer <&3; local rc=$?; exec 3<&-
  [ "$rc" -eq 0 ] && [ "$answer" = "$expected" ]
}
d_boot(){
  sysctl -n kern.boottime 2>/dev/null | awk -F '[=,]' '/sec[ ]*=/ {gsub(/[[:space:]]/,"",$2); if($2 ~ /^[0-9]+$/) print $2; exit}'
}
d_exec(){
  local limit=$1 out=$2 rc; shift 2
  # Supervisor starts a separate process group and terminates all descendants.
  perl "$D_ROOT/diagnostics/v2/supervise.pl" "$limit" "$out" "$@" &
  D_CHILD=$!; wait "$D_CHILD"; rc=$?; D_CHILD=''
  return "$rc"
}
d_engine_result(){
  local rc=$1 out=$2 marker=$3
  case "$rc" in
    0) if grep -Fqx "$marker" "$out"; then return 0; else return 3; fi;;
    2) return 2;; 130|143) return 130;; *) return 3;;
  esac
}
d_compiler(){
  D_CC=''
  if [ "$(uname -s)" = Darwin ]; then
    xcode-select -p >/dev/null 2>&1 || return 3
    D_CC=$(xcrun -f clang 2>/dev/null) || return 3
  else D_CC=$(command -v cc) || return 3; fi
  [ -n "$D_CC" ] && [ -x "$D_CC" ]
}
d_build(){
  local src=$1 dest=$2 log=$3; shift 3
  [ ! -e "$dest" ] || return 3
  d_compiler || return 3
  d_exec 180 "$log" "$D_CC" "$@" "$src" -o "$dest" || return 3
  [ -f "$dest" ] && [ -x "$dest" ]
}
d_aggregate(){
  # A failure is not cleared by a later success. Observation never means PASS.
  local rc fail=0 incomplete=0 cancelled=0
  for rc in "$@"; do
    case "$rc" in 0) :;; 2) fail=1;; 130|143) cancelled=1;; *) incomplete=1;; esac
  done
  [ "$fail" -eq 0 ] || return 2
  [ "$cancelled" -eq 0 ] || return 130
  [ "$incomplete" -eq 0 ] || return 3
  [ "$#" -gt 0 ] || return 3
  return 0
}
