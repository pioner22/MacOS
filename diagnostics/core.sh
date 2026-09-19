#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Bash 3.2-compatible common runtime. No implicit hardware verdicts.
export LC_ALL=C
umask 077

diag_init() {
    local name=$1 root=${MACDIAG_ROOT:-}
    case "$name" in ''|*[!A-Za-z0-9_-]*) return 3;; esac
    [ -n "$root" ] && [ -d "$root/diagnostics" ] || return 3
    DIAG_RUN=$(mktemp -d /tmp/macdiag-run.XXXXXXXX) || return 3
    DIAG_LOG="$DIAG_RUN/$name.log"
    : > "$DIAG_LOG" || return 3
    DIAG_NAME=$name
    trap 'diag_cancel' INT
    trap 'diag_cancel' TERM HUP
    diag_log "TEST=$name VERSION=0.2.0-audit LOG=$DIAG_LOG"
    diag_log 'RU: /tmp и swap могут использовать SSD. Отсутствие payload-файла не означает нулевую запись ОС.'
    diag_log 'EN: /tmp and swap may use SSD. No payload file does not mean zero OS writes.'
}
diag_log() {
    printf '%s\n' "$*"
    printf '%s\n' "$*" >> "$DIAG_LOG" || return 3
}
diag_cancel() {
    trap - INT TERM HUP
    [ -z "${DIAG_CHILD:-}" ] || kill -TERM "$DIAG_CHILD" 2>/dev/null || :
    printf 'RESULT=CANCELLED code=130\nRU: Остановлено. Это не аппаратный диагноз.\nEN: Cancelled. Not a hardware diagnosis.\n'
    exit 130
}
diag_result() {
    local state=$1 code=$2 reason=$3 ru=$4 en=$5
    diag_log "RESULT=$state code=$code reason=$reason attribution=UNCONFIRMED"
    diag_log "RU: $ru"
    diag_log "EN: $en"
    diag_log 'NEXT_RU: Сохраните лог. FAIL требует независимого подтверждения; PASS относится только к выполненным проверкам.'
    diag_log 'NEXT_EN: Preserve the log. Confirm FAIL independently; PASS covers only completed checks.'
    return "$code"
}
diag_need() {
    local c
    for c in "$@"; do
        command -v "$c" >/dev/null 2>&1 || {
            diag_result INCONCLUSIVE 3 "MISSING_TOOL_$c" "Нет команды $c." "Missing command $c."; return 3;
        }
    done
}
diag_sha() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$@"
    elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$@"
    else return 3; fi
}
diag_hash_ready() {
    local p=() got
    printf abc | diag_sha > "$DIAG_RUN/hash-selftest"
    p=("${PIPESTATUS[@]}")
    [ "${p[0]}" -eq 0 ] && [ "${p[1]}" -eq 0 ] || return 3
    read -r got _ < "$DIAG_RUN/hash-selftest"
    [ "$got" = ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad ]
}
diag_uint() {
    case ${1:-} in ''|*[!0-9]*) return 1;; esac
    [ ${#1} -le 8 ] || return 1
    [ "$1" -ge "$2" ] && [ "$1" -le "$3" ]
}
diag_confirm() {
    local token=$1 answer=''
    printf 'RU: Для подтверждения введите %s. EN: Type %s to confirm: ' "$token" "$token"
    if ! { exec 3</dev/tty; } 2>/dev/null; then return 1; fi
    IFS= read -r answer <&3; local rc=$?
    exec 3<&-
    [ "$rc" -eq 0 ] && [ "$answer" = "$token" ]
}
# The first sec field is seconds. A greedy '.*sec' expression instead matches usec.
diag_boot_epoch() {
    sysctl -n kern.boottime 2>/dev/null |
      awk -F '[=,]' '/sec[ ]*=/ {gsub(/[[:space:]]/,"",$2); if($2 ~ /^[0-9]+$/) print $2; exit}'
}
