#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Experimental audited dispatcher. Legacy raw writers are not called.
MACDIAG_ROOT=${MACDIAG_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)}
export MACDIAG_ROOT
. "$MACDIAG_ROOT/diagnostics/core.sh" || exit 3

compiler() {
    if [ "$(uname -s)" = Darwin ]; then
        command -v xcode-select >/dev/null 2>&1 && xcode-select -p >/dev/null 2>&1 || return 1
        xcrun -f clang 2>/dev/null
    else command -v cc; fi
}
compile_c() {
    local src=$1 bin=$2 cc rc
    cc=$(compiler) || return 3
    [ ! -e "$bin" ] || return 3
    "$cc" -std=c11 -O2 -Wall -Wextra -Werror "$src" -o "$bin" >> "$DIAG_LOG" 2>&1
    rc=$?
    [ "$rc" -eq 0 ] && [ -f "$bin" ] && [ -x "$bin" ]
}
engine_result() {
    local rc=$1 tee_rc=$2 marker=$3 output=$4
    [ "$rc" -ne 130 ] || { diag_result CANCELLED 130 USER_STOP 'Тест остановлен.' 'Test cancelled.'; return 130; }
    [ "$tee_rc" -eq 0 ] || {
        diag_result INCONCLUSIVE 3 LOG_WRITE_FAILURE 'Не удалось полностью записать лог.' 'Log write failed.'; return 3;
    }
    case "$rc" in
      0)
        grep -Fqx "$marker" "$output" || {
            diag_result INCONCLUSIVE 3 MISSING_COMPLETION_MARKER 'Нет подтверждения полного завершения.' 'Completion marker is absent.'; return 3;
        }
        diag_result PASS 0 TEST_COMPLETE 'В выполненном объёме ошибок не найдено. Это не гарантия исправности всего узла.' 'No errors in the completed scope. Not a guarantee of component health.';;
      2) diag_result FAIL 2 OBSERVED_DATA_PATH_FAILURE 'Обнаружено нарушение проверяемого условия. Неисправная микросхема этим не определена.' 'A checked condition failed. This does not identify a defective chip.';;
      130) diag_result CANCELLED 130 USER_STOP 'Тест остановлен.' 'Test cancelled.';;
      *) diag_result INCONCLUSIVE 3 ENGINE_OR_ENVIRONMENT_ERROR 'Ошибка движка, лимит времени или ограничение среды. Аппаратный вывод не делаем.' 'Engine error, time limit, or environment restriction. No hardware conclusion.';;
    esac
}
run_ram() {
    local mode=$1 total bytes max mib rounds hold rc p=() engine=() out
    if [ "$mode" = full ] && [ "${MACDIAG_FULL_ACK:-}" != YES ]; then
        diag_confirm BURNIN || { diag_result CANCELLED 130 NOT_CONFIRMED 'Нагрузка не подтверждена.' 'Stress test not confirmed.'; return 130; }
    fi
    bytes=$(sysctl -n hw.memsize 2>/dev/null)
    case "$bytes" in ''|*[!0-9]*)
      if [ -r /proc/meminfo ]; then bytes=$(awk '/MemTotal:/{printf "%.0f",$2*1024}' /proc/meminfo); else return 3; fi;;
    esac
    # Linux verification environment may be cgroup limited.
    if [ -r /sys/fs/cgroup/memory.max ]; then
        local cg; cg=$(cat /sys/fs/cgroup/memory.max)
        case "$cg" in ''|*[!0-9]*) :;; *) [ "$cg" -ge "$bytes" ] || bytes=$cg;; esac
    fi
    total=$((bytes/1048576)); max=$((total*3/4)); [ "$max" -le 49152 ] || max=49152
    mib=8192; rounds=1; hold=1
    if [ "$mode" = full ]; then mib=$max; rounds=2; hold=3
    elif [ "$mode" = map ]; then rounds=3; fi
    [ "$mib" -le "$max" ] || mib=$max
    mib=${MACDIAG_RAM_MIB:-$mib}
    diag_uint "$mib" 1 "$max" || return 3
    mib=$((10#$mib))
    diag_log "RAM_BUDGET installed_mib=$total requested_mib=$mib reserve_mib=$((total-mib)) boot_epoch=$(diag_boot_epoch)"
    out="$DIAG_RUN/ram.engine.log"
    case ${MACDIAG_RAM_ENGINE:-auto} in auto|native|perl) :;; *) return 3;; esac
    if [ "${MACDIAG_RAM_ENGINE:-auto}" != perl ] && compiler >/dev/null 2>&1; then
        compile_c "$MACDIAG_ROOT/diagnostics/ram_native.c" "$DIAG_RUN/ram-native" || return 3
        engine=("$DIAG_RUN/ram-native" "$mib" "$rounds" "$mode" "$hold")
    elif [ "${MACDIAG_RAM_ENGINE:-auto}" = native ]; then
        diag_result INCONCLUSIVE 3 NO_COMPILER 'Для независимого C-теста нужен готовый проверенный бинарник или компилятор.' 'Independent C testing requires a verified binary or compiler.'; return 3
    else
        diag_need perl || return 3
        engine=(perl "$MACDIAG_ROOT/diagnostics/ram_fallback.pl" "$mib" "$rounds" "$mode" "$hold")
        diag_log 'FALLBACK=PERL_SCREENING_ONLY INDEPENDENT_NATIVE_CONFIRMATION=PENDING'
    fi
    "${engine[@]}" 2>&1 | tee "$out" | tee -a "$DIAG_LOG"
    p=("${PIPESTATUS[@]}")
    [ "${p[1]}" -eq 0 ] || p[2]=1
    engine_result "${p[0]}" "${p[2]}" 'ENGINE_COMPLETE=RAM_PASS' "$out"
}
run_storage() {
    local dir=${MACDIAG_TARGET_DIR:-} mib=${MACDIAG_STORAGE_MIB:-256} out p=()
    diag_log 'STORAGE_POLICY=ALLOCATED_FILE_ONLY LEGACY_RAW_WRITE=BLOCKED'
    diag_log 'RU: Прежний destructive full-LBA движок не сертифицирован этой ревизией. Ни один сектор raw-устройства не перезаписывается.'
    diag_log 'EN: Legacy destructive full-LBA engine is not qualified by this revision. No raw-device sector is overwritten.'
    [ -n "$dir" ] || { diag_result BLOCKED 5 TARGET_DIRECTORY_REQUIRED 'Укажите MACDIAG_TARGET_DIR: существующий каталог на выбранном диске.' 'Set MACDIAG_TARGET_DIR to an existing directory on the chosen drive.'; return 5; }
    [ -d "$dir" ] && [ -w "$dir" ] && diag_uint "$mib" 1 8192 || return 3
    diag_log "FILE_TEST_DIRECTORY=$dir REQUESTED_MIB=$mib"
    diag_confirm FILETEST || { diag_result CANCELLED 130 NOT_CONFIRMED 'Запись не подтверждена.' 'File write not confirmed.'; return 130; }
    compile_c "$MACDIAG_ROOT/diagnostics/storage_file.c" "$DIAG_RUN/storage-file" || return 3
    out="$DIAG_RUN/storage.engine.log"
    "$DIAG_RUN/storage-file" "$dir" "$mib" 2>&1 | tee "$out" | tee -a "$DIAG_LOG"
    p=("${PIPESTATUS[@]}"); [ "${p[1]}" -eq 0 ] || p[2]=1
    engine_result "${p[0]}" "${p[2]}" 'ENGINE_COMPLETE=STORAGE_FILE_PASS' "$out"
}
run_cpu() {
    local workers round w pid rc fails=0 unavailable=0 out got p=() pids=()
    local expected=a6d72ac7690f53be6ae46ba88506bd97302a093f7108472bd9efc3cefda06484
    diag_need dd tee || return 3
    diag_hash_ready || return 3
    workers=$(sysctl -n hw.logicalcpu 2>/dev/null)
    case "$workers" in ''|*[!0-9]*) workers=2;; esac
    diag_uint "$workers" 1 4096 || workers=2
    [ "$workers" -le 16 ] || workers=16
    diag_log "CPU_SCOPE=PARALLEL_SHA256_EXECUTION workers=$workers cache_level_isolation=NO"
    for round in 1 2; do
        pids=()
        for ((w=0;w<workers;w++)); do
            (
                out="$DIAG_RUN/cpu-$round-$w.sha"
                dd if=/dev/zero bs=1048576 count=256 2>"$DIAG_RUN/cpu-$round-$w.stderr" | diag_sha > "$out"
                p=("${PIPESTATUS[@]}")
                [ "${p[0]}" -eq 0 ] && [ "${p[1]}" -eq 0 ] || exit 3
                read -r got _ < "$out"
                [ "$got" = "$expected" ] || exit 2
            ) &
            pids[${#pids[@]}]=$!
        done
        for pid in "${pids[@]}"; do
            wait "$pid"; rc=$?
            case "$rc" in 0) :;; 2) fails=1;; *) unavailable=1;; esac
        done
    done
    [ "$fails" -eq 0 ] || { diag_result FAIL 2 CPU_HASH_MISMATCH 'Не совпал результат вычислений. Причина CPU/RAM/ПО не локализована.' 'Execution result mismatch; CPU/RAM/software cause not isolated.'; return 2; }
    [ "$unavailable" -eq 0 ] || return 3
    diag_result PASS 0 CPU_SMOKE_COMPLETE 'Параллельные вычисления прошли. Это не полный тест CPU и уровней кэша.' 'Parallel computation passed. Not a full CPU/cache-level test.'
}
run_network() {
    local url n rc status out errors=0 unavailable=0
    diag_need curl || return 3
    . "$MACDIAG_ROOT/diagnostics/net.sh"
    for url in https://github.com/ https://raw.githubusercontent.com/pioner22/MacOS/main/README.md https://www.apple.com/library/test/success.html; do
        for n in 1 2 3; do
            out=$(curl -q -sSIL --proto '=https' --proto-redir '=https' --retry 0 --max-redirs 5 \
              --connect-timeout 15 --max-time 45 -o /dev/null \
              -w 'http=%{http_code} dns=%{time_namelookup} tcp=%{time_connect} tls=%{time_appconnect} ttfb=%{time_starttransfer} total=%{time_total}' "$url" 2>"$DIAG_RUN/probe.stderr")
            rc=$?; status=$(printf '%s' "$out" | sed -n 's/^http=\([0-9][0-9][0-9]\).*/\1/p')
            diag_log "PROBE endpoint=$url n=$n curl=$rc $out"
            if [ "$rc" -ne 0 ]; then diag_log "OBSERVED=$(net_reason "$rc")"; errors=1
            else case "$status" in 2[0-9][0-9]) :;; 401|403|404|429) unavailable=1;; *) errors=1;; esac; fi
        done
    done
    [ "$errors" -eq 0 ] || { diag_result FAIL 2 CONNECTION_OBSERVATION 'Есть ошибки соединения или ответа сервера. Сетевая карта этим не признана неисправной.' 'Connection/server failures observed. This does not diagnose a failed network adapter.'; return 2; }
    [ "$unavailable" -eq 0 ] || return 3
    diag_result PASS 0 HTTPS_PROBES 'Указанные HTTPS-запросы прошли. Большие пакеты Apple Installer не проверены.' 'Listed HTTPS probes passed. Large Apple Installer packages were not tested.'
}
run_download() {
    local max=${MACDIAG_DOWNLOAD_MAX_MIB:-32} rc
    diag_need curl perl awk cat || return 3
    diag_hash_ready || return 3
    case "$max" in 1|8|32|128|512) :;; *) return 3;; esac
    . "$MACDIAG_ROOT/diagnostics/net.sh"
    net_plan "$MACDIAG_ROOT/network-fixtures.tsv" "$max" 'https://github.com/pioner22/MacOS/releases/download/diagnostic-fixtures-v1'; rc=$?
    [ "$rc" -eq 0 ] || {
        if [ "$rc" -eq 2 ]; then diag_result FAIL 2 DOWNLOAD_OBSERVATION 'Есть ошибка передачи/целостности. RAM, сеть, сервер и ПО пока не разделены.' 'Transfer/integrity failure; RAM, network, server and software not isolated.'
        else diag_result INCONCLUSIVE 3 FIXTURE_OR_ENVIRONMENT_UNAVAILABLE 'Эталон недоступен или проверка неполна. Это не аппаратный FAIL.' 'Fixture unavailable or incomplete test. Not a hardware FAIL.'; fi
        return "$rc"
    }
    if [ "$max" = 512 ]; then
        net_stream RANGE_MID 'https://github.com/pioner22/MacOS/releases/download/diagnostic-fixtures-v1/nettest-512MiB.bin' \
          6b2bd172178b6e8a4d992581273e7962efe0ec8066e6204537fe27a34b7d940c 16777216 1 268435456 285212671 536870912
        rc=$?; [ "$rc" -eq 0 ] || return "$rc"
    else diag_log 'RANGE_TEST=NOT_REQUESTED'; fi
    diag_result PASS 0 DOWNLOAD_REQUESTED_SCOPE "Запрошенные размеры до $max MiB проверены. Resume со сборкой файла не тестировался." "Requested sizes through $max MiB verified. File-assembly resume was not tested."
}
run_observe() {
    local mode=$1 found=0
    case "$mode" in
      hardware)
        uname -a; command -v sw_vers >/dev/null 2>&1 && sw_vers
        if command -v sysctl >/dev/null 2>&1; then sysctl hw.model hw.memsize hw.logicalcpu 2>/dev/null; found=1; fi;;
      power)
        if command -v pmset >/dev/null 2>&1; then pmset -g batt; pmset -g therm; found=1; fi;;
      display)
        if command -v system_profiler >/dev/null 2>&1; then
            system_profiler SPDisplaysDataType 2>/dev/null | sed '/[Ss]erial/d; /UUID/d'; found=1
        fi;;
    esac
    [ "$found" -gt 0 ] || return 3
    diag_result OBSERVATION 6 INFORMATION_ONLY 'Собраны сведения, но исправность узла не установлена. Артефакт на скриншоте не даёт однозначной локализации.' 'Information collected, not a health verdict. Screenshot artifacts do not uniquely localize a fault.'
}
run_gpu() {
    local cc bin out p=() rc
    [ "$(uname -s)" = Darwin ] || return 3
    cc=$(compiler) || return 3
    bin="$DIAG_RUN/metal-vram"; out="$DIAG_RUN/gpu.engine.log"
    "$cc" -fobjc-arc -framework Foundation -framework Metal "$MACDIAG_ROOT/diagnostics/metal_vram.m" -o "$bin" >> "$DIAG_LOG" 2>&1
    rc=$?
    [ "$rc" -eq 0 ] && [ -f "$bin" ] && [ -x "$bin" ] || return 3
    "$bin" 2>&1 | tee "$out" | tee -a "$DIAG_LOG"
    p=("${PIPESTATUS[@]}"); [ "${p[1]}" -eq 0 ] || p[2]=1
    engine_result "${p[0]}" "${p[2]}" 'ENGINE_COMPLETE=GPU_PASS' "$out"
}
run_selftest() {
    local h bytes file got size rc count=0 p=() errors=0
    diag_need perl bash awk wc || return 3
    diag_hash_ready || return 3
    [ -s "$MACDIAG_ROOT/diagnostics/package.tsv" ] || {
        diag_result INCONCLUSIVE 3 MISSING_PACKAGE_MANIFEST 'Манифест отсутствует или пуст.' 'Package manifest is missing or empty.'; return 3;
    }
    while read -r h bytes file; do
        [ -n "$file" ] || continue
        count=$((count+1))
        [ -f "$MACDIAG_ROOT/$file" ] || { errors=1; continue; }
        diag_sha "$MACDIAG_ROOT/$file" > "$DIAG_RUN/sha"
        rc=$?; read -r got _ < "$DIAG_RUN/sha"
        size=$(wc -c < "$MACDIAG_ROOT/$file"); size=$((size+0))
        [ "$rc" -eq 0 ] && [ "$h" = "$got" ] && [ "$size" = "$bytes" ] || errors=1
        case "$file" in *.sh) /bin/bash -n "$MACDIAG_ROOT/$file" || errors=1;; *.pl) perl -c "$MACDIAG_ROOT/$file" || errors=1;; esac
    done < "$MACDIAG_ROOT/diagnostics/package.tsv"
    [ "$count" -gt 0 ] && [ "$errors" -eq 0 ] || { diag_result INCONCLUSIVE 3 PACKAGE_INVALID 'Пакет не прошёл проверку. Железо этим не тестировалось.' 'Package validation failed. This was not a hardware test.'; return 3; }
    diag_result PASS 0 SELFTEST_BOUNDED_SCOPE 'Хэши, размеры, синтаксис Bash/Perl и SHA-вектор верны. Это не доказательство всех алгоритмов.' 'Package hashes/sizes, Bash/Perl syntax and SHA vector passed. Not a proof of every algorithm.'
}
run_suite() {
    local full=$1 test rc failures=0 incomplete=0 observed=0
    for test in selftest hardware power ram-quick; do
        /bin/bash "$MACDIAG_ROOT/diagnostics/run.sh" "$test"; rc=$?
        diag_log "SUITE_TEST=$test code=$rc"
        case "$rc" in 0) :;; 6) observed=$((observed+1));;
          2) return 2;; 130) return 130;; *) return 3;; esac
    done
    if [ "$full" = full ]; then
        /bin/bash "$MACDIAG_ROOT/diagnostics/run.sh" ram-full; rc=$?
        [ "$rc" -eq 0 ] || return "$rc"
    fi
    for test in cpu gpu display network download; do
        /bin/bash "$MACDIAG_ROOT/diagnostics/run.sh" "$test"; rc=$?
        diag_log "SUITE_TEST=$test code=$rc"
        case "$rc" in 0) :;; 6) observed=$((observed+1)); incomplete=1;;
          2) failures=1; break;; 130) return 130;; *) incomplete=1;; esac
    done
    diag_log "SUITE_SCOPE=NONDESTRUCTIVE destructive_raw=DISABLED observations=$observed"
    [ "$failures" -eq 0 ] || return 2
    [ "$incomplete" -eq 0 ] || return 3
    diag_result PASS 0 SUITE_EXECUTED_SCOPE 'Выполненные проверки пройдены. Физическая матрица, весь SSD и вся RAM этим не сертифицированы.' 'Executed checks passed. Physical display, entire SSD and entire RAM are not certified.'
}
main() {
    local mode=${1:-menu} rc=3
    diag_init "$mode" || exit 3
    diag_need tee grep sed cat uname || exit 3
    case "$mode" in
      ram-quick) run_ram quick; rc=$?;; ram-full) run_ram full; rc=$?;; ram-map) run_ram map; rc=$?;;
      storage) run_storage; rc=$?;; cpu) run_cpu; rc=$?;; gpu) run_gpu; rc=$?;;
      network) run_network; rc=$?;; download) run_download; rc=$?;;
      hardware|power|display) run_observe "$mode"; rc=$?;;
      selftest) run_selftest; rc=$?;; safe|full) run_suite "$mode"; rc=$?;;
      *) diag_log 'ERROR=UNKNOWN_MODE'; rc=3;;
    esac
    if [ "$rc" -eq 3 ]; then
        diag_result INCONCLUSIVE 3 INCOMPLETE_EXECUTION 'Проверка не завершена полностью. Смотрите лог; не трактуйте это как неисправную микросхему.' 'Test incomplete. Inspect the log; do not infer a defective chip.' || :
    elif [ "$rc" -eq 2 ]; then
        diag_result FAIL 2 OBSERVED_FAILURE 'Нарушено проверяемое условие. Компонентная причина требует независимой проверки.' 'A checked condition failed. Component attribution requires independent verification.' || :
    fi
    diag_log "TEST_FINISHED=$mode code=$rc LOG=$DIAG_LOG"
    exit "$rc"
}
[ "${BASH_SOURCE[0]}" != "$0" ] || main "$@"
