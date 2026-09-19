#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
D_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P) || exit 3
. "$D_ROOT/diagnostics/v2/core.sh"
. "$D_ROOT/diagnostics/v2/profile.sh"
. "$D_ROOT/diagnostics/v2/net.sh"

d_memory_budget(){
  local mode=$1 total free cap wanted pg=''
  case "$P_RAM" in ''|*[!0-9]*) return 3;;esac
  total=$((P_RAM/1048576)); [ "$total" -ge 2048 ] || return 3
  cap=$((total*3/4)); [ "$cap" -le 49152 ] || cap=49152
  # Keep at least 4 GiB for the OS on large machines, even with an explicit request.
  if [ "$total" -gt 8192 ] && [ "$cap" -gt $((total-4096)) ];then cap=$((total-4096));fi
  free=$(vm_stat 2>/dev/null | awk '
    NR==1{for(i=1;i<=NF;i++)if($i=="of")p=$(i+1)}
    /^Pages free:/{gsub(/\./,"",$3);f=$3}
    /^Pages inactive:/{gsub(/\./,"",$3);a=$3}
    END{if(p>0&&f>=0)printf "%.0f",(f+a)*p/1048576}')
  case "$free" in ''|*[!0-9]*) cap=$((total/2));;*) free=$((free*3/4)); [ "$cap" -le "$free" ] || cap=$free;;esac
  [ "$cap" -le 49152 ] || cap=49152
  [ "$cap" -ge 64 ] || return 3
  case "$mode" in quick) wanted=2048;;map) wanted=8192;;full) wanted=$cap;;esac
  if [ -n "${MACDIAG_RAM_MIB:-}" ];then
    d_num "$MACDIAG_RAM_MIB" 64 49152 || return 3
    wanted=$((10#$MACDIAG_RAM_MIB))
    # Do not silently reduce a user-requested size and call that full coverage.
    [ "$wanted" -le "$cap" ] || return 3
  else [ "$wanted" -le "$cap" ] || wanted=$cap;fi
  D_RAM_MIB=$((wanted/32*32)); [ "$D_RAM_MIB" -ge 64 ]
}
d_ram(){
  local mode=$1 rc out="$D_WORK/ram-engine.log" rounds=1 hold=1
  d_memory_budget "$mode" || { d_result INCONCLUSIVE 3 MEMORY_BUDGET 'Не хватает доступной памяти или некорректен запрошенный объём.' 'Insufficient available memory or invalid requested size.'; return 3; }
  d_log "RAM_REQUEST mode=$mode mib=$D_RAM_MIB boot_epoch=$(d_boot)"
  [ "$mode" != map ] || rounds=3
  [ "$mode" != full ] || hold=3
  if ! d_build "$D_ROOT/diagnostics/v2/ram_native.c" "$D_WORK/ram-native" "$D_WORK/ram-build.log" -std=c11 -O2 -Wall -Wextra -Werror;then
    if [ "$mode" = quick ];then
      d_exec 300 "$out" perl "$D_ROOT/diagnostics/v2/ram_screen.pl" 256;rc=$?
      if [ "$rc" -eq 2 ];then d_result FAIL 2 INTERPRETER_DATA_MISMATCH 'Скрининг сообщил о несовпадении. Нужен независимый нативный тест; компонент не определён.' 'Interpreter screening reported a mismatch. Confirm with a native test; the component is not identified.';return 2;fi
    fi
    d_result INCONCLUSIVE 3 NATIVE_RAM_UNAVAILABLE 'Нативный тест не собран. Нужна полная macOS с установленными Command Line Tools. Скрининг Recovery не закрывает приёмку.' 'Native tester unavailable. Use full macOS with installed Command Line Tools. Recovery screening cannot complete acceptance.';return 3
  fi
  d_exec 14400 "$out" "$D_WORK/ram-native" "$D_RAM_MIB" "$rounds" "$mode" "$hold";rc=$?
  d_engine_result "$rc" "$out" ENGINE_COMPLETE=RAM_PASS;rc=$?
  case "$rc" in
    0) d_result PASS 0 RAM_SCOPE_COMPLETE 'Весь запланированный объём userspace-проверки пройден. Смотрите mlock и ограничения покрытия в журнале.' 'Planned userspace memory checks completed. Review mlock and coverage limits in the log.';;
    2) d_result FAIL 2 RAM_DATA_MISMATCH 'Записанные и считанные значения различаются. Подтвердите независимым тестом; это не локализация DRAM-чипа.' 'Written and read values differ. Confirm independently; this does not identify a DRAM chip.';;
    130) d_result CANCELLED 130 INTERRUPTED 'Проверка прервана.' 'Test interrupted.';;
    *) d_result INCONCLUSIVE 3 RAM_ENGINE_INCOMPLETE 'Тест не завершён: проверьте timeout, OOM, сигнал и журнал.' 'Test incomplete: inspect timeout, OOM, signal and logs.';;
  esac
}
d_storage(){
  local target=${MACDIAG_STORAGE_DIR:-} size=${MACDIAG_FILE_MIB:-4096} rc
  case "$target" in /*) :;;*) d_result INCONCLUSIVE 3 STORAGE_DIRECTORY_REQUIRED 'Укажите существующий каталог: MACDIAG_STORAGE_DIR. Системный диск не выбирается автоматически.' 'Set MACDIAG_STORAGE_DIR to an existing directory. The system disk is not selected automatically.';return 3;;esac
  d_num "$size" 1 65536 || return 3
  [ -d "$target" ] && [ -w "$target" ] || return 3
  target=$(cd "$target" && pwd -P) || return 3
  case "$target" in /dev|/dev/*) return 3;;esac
  d_log "FILE_TEST_TARGET=$target REQUEST_MIB=$size RAW_WRITE=DISABLED"
  d_log 'RU: Будет создан новый тестовый файл, затем закрыт и дважды перечитан. Существующие файлы не перезаписываются.'
  d_log 'EN: A new test file will be created, closed and read twice. Existing files are not overwritten.'
  d_confirm WRITE-TEST-FILE || { d_result CANCELLED 130 NO_FILE_WRITE_CONSENT 'Запись тестового файла не разрешена.' 'No consent to create a test file.';return 130; }
  d_build "$D_ROOT/diagnostics/v2/storage_file.c" "$D_WORK/storage-native" "$D_WORK/storage-build.log" -std=c11 -O2 -Wall -Wextra -Werror || { d_result INCONCLUSIVE 3 STORAGE_BUILD 'Не удалось собрать файловый тест.' 'Could not build the file tester.';return 3; }
  d_exec 7200 "$D_WORK/storage-engine.log" "$D_WORK/storage-native" "$target" "$size";rc=$?
  d_engine_result "$rc" "$D_WORK/storage-engine.log" ENGINE_COMPLETE=STORAGE_FILE_PASS;rc=$?
  case "$rc" in
    0) d_result PASS 0 ALLOCATED_FILE_ONLY 'Файловая запись и две проверки пройдены. Это не проверка всего SSD и не испытание потери питания.' 'File write and two readbacks passed. This is not full-device or power-loss testing.';;
    2) d_result FAIL 2 FILE_IO_OR_DATA_ERROR 'Ошибка файлового I/O или несовпадение данных. Возможны накопитель, RAM, ОС или соединение; смотрите журнал.' 'File I/O failure or data mismatch. Storage, RAM, OS or connection may be involved; inspect the log.';;
    130) d_result CANCELLED 130 INTERRUPTED 'Тест прерван; новый тестовый файл может остаться.' 'Interrupted; the newly created test file may remain.';;
    *) d_result INCONCLUSIVE 3 STORAGE_INCOMPLETE 'Файловый тест не завершён. Смотрите место, права, компиляцию и timeout.' 'File test incomplete. Check space, permissions, compilation and timeout.';;
  esac
}
d_cpu(){
  local workers rc
  workers=$(sysctl -n hw.logicalcpu 2>/dev/null)
  d_num "$workers" 1 256 || workers=2
  [ "$workers" -le 16 ] || workers=16
  d_hash_ready || return 3
  d_exec 1800 "$D_WORK/cpu-engine.log" /bin/bash "$D_ROOT/diagnostics/v2/cpu_worker.sh" "$D_WORK" "$workers" 4;rc=$?
  d_engine_result "$rc" "$D_WORK/cpu-engine.log" ENGINE_COMPLETE=CPU_PASS;rc=$?
  case "$rc" in
    0) d_result PASS 0 CPU_HASH_SCOPE 'SHA-256 под параллельной нагрузкой совпал с эталоном; отдельные уровни кэша и все инструкции CPU не сертифицированы.' 'Parallel SHA-256 matched the reference; individual cache levels and all CPU instructions are not certified.';;
    2) d_result FAIL 2 CPU_HASH_MISMATCH 'Неверный вычисленный результат. Проверяйте CPU/RAM/ПО независимо.' 'Incorrect computed result. Independently investigate CPU/RAM/software.';;
    130) return 130;;*) d_result INCONCLUSIVE 3 CPU_ENGINE 'Вычислительный тест не завершён.' 'Compute test incomplete.';;
  esac
}
d_gpu(){
  local size=${MACDIAG_VRAM_MIB:-512} rc
  d_num "$size" 128 2048 || return 3
  d_build "$D_ROOT/diagnostics/v2/metal_vram.m" "$D_WORK/metal-native" "$D_WORK/metal-build.log" -fobjc-arc -mmacosx-version-min=10.15 -framework Foundation -framework Metal || { d_result INCONCLUSIVE 3 GPU_BUILD 'Metal-тестер не собран. Старый бинарник не запускается.' 'Metal build failed. No stale executable will be run.';return 3; }
  d_exec 1800 "$D_WORK/metal-engine.log" "$D_WORK/metal-native" "$size";rc=$?
  d_engine_result "$rc" "$D_WORK/metal-engine.log" ENGINE_COMPLETE=GPU_PASS;rc=$?
  case "$rc" in
    0) d_result PASS 0 METAL_DATA_PATH 'Выбранный объём Metal-буферов прошёл проверку. Readback также зависит от системной RAM; всю VRAM тест не охватывает.' 'Selected Metal buffers passed. Readback also depends on system RAM; not all VRAM is covered.';;
    2) d_result FAIL 2 GPU_DATA_MISMATCH 'Несовпадение GPU/readback-данных; точный узел не установлен.' 'GPU/readback data mismatch; the exact component is unconfirmed.';;
    130) return 130;;*) d_result INCONCLUSIVE 3 GPU_RUNTIME 'Metal не завершил проверку. Ошибка драйвера, timeout или нехватка ресурсов не равны диагнозу VRAM.' 'Metal did not complete. Driver error, timeout or resource limits are not a VRAM diagnosis.';;
  esac
}
d_download(){
  local rc limit=${MACDIAG_DOWNLOAD_MAX_MIB:-512}
  d_num "$limit" 1 512 || return 3
  d_exec 14400 "$D_WORK/download-engine.log" /bin/bash "$D_ROOT/diagnostics/v2/download_worker.sh" "$D_WORK" "$limit";rc=$?
  d_engine_result "$rc" "$D_WORK/download-engine.log" ENGINE_COMPLETE=DOWNLOAD_PASS;rc=$?
  case "$rc" in
    0) d_result PASS 0 DOWNLOAD_SCOPE 'Запланированные передачи прошли проверки HTTP, длины и SHA-256. Range — отдельный GET, не полноценная докачка файла.' 'Planned transfers passed HTTP, length and SHA-256 checks. Range is a separate GET, not full resume reassembly.';;
    2) d_result FAIL 2 DOWNLOAD_OBSERVATION 'Зафиксирована ошибка передачи или целостности. Это не автоматический диагноз Wi-Fi/RAM.' 'Transfer or integrity failure observed. This is not an automatic Wi-Fi/RAM diagnosis.';;
    130) return 130;;*) d_result INCONCLUSIVE 3 DOWNLOAD_COVERAGE 'Часть эталонов недоступна или тест не завершён; резервные результаты сохранены отдельно.' 'Some fixtures are unavailable or the test is incomplete; fallback results are retained separately.';;
  esac
}
d_network(){
  local rc
  d_exec 600 "$D_WORK/network-engine.log" /bin/bash "$D_ROOT/diagnostics/v2/network_worker.sh" "$D_WORK";rc=$?
  d_engine_result "$rc" "$D_WORK/network-engine.log" ENGINE_COMPLETE=NETWORK_PASS;rc=$?
  case "$rc" in
    0) d_result PASS 0 HTTPS_SMALL_PROBES 'Малые HTTPS-запросы пройдены; установочный образ Apple не проверен.' 'Small HTTPS probes passed; an Apple installation image was not verified.';;
    2) d_result FAIL 2 HTTPS_PATH 'Наблюдался сбой HTTPS. Сравните другую сеть; конкретный аппаратный дефект не установлен.' 'HTTPS failure observed. Compare another network; no specific hardware defect is established.';;
    130) d_result CANCELLED 130 INTERRUPTED 'Тест прерван.' 'Test interrupted.';;
    *) d_result INCONCLUSIVE 3 HTTPS_INCOMPLETE 'Проверка HTTPS не завершена или endpoint недоступен.' 'HTTPS check incomplete or an endpoint is unavailable.';;
  esac
}
d_observe(){
  local mode=$1 ok=0 rc
  if [ "$mode" = power ];then
    if command -v pmset >/dev/null 2>&1;then d_exec 30 "$D_WORK/power.log" pmset -g batt;[ "$?" -ne 0 ] || ok=1;fi
    if command -v powermetrics >/dev/null 2>&1;then d_exec 30 "$D_WORK/metrics.log" powermetrics -n 3 -i 1000 || :;fi
  elif [ "$mode" = display ];then
    d_exec 60 "$D_WORK/displays.log" system_profiler SPDisplaysDataType;[ "$?" -ne 0 ] || ok=1
    d_log 'VISUAL_PANEL_CHECK=MANUAL screenshot_correlation=HEURISTIC_NOT_COMPONENT_PROOF'
  else
    d_exec 30 "$D_WORK/platform.log" /bin/bash -c 'uname -a; sw_vers; sysctl hw.model hw.memsize hw.logicalcpu; diskutil list';[ "$?" -ne 0 ] || ok=1
    d_exec 60 "$D_WORK/hardware.log" system_profiler SPHardwareDataType || :
    d_exec 30 "$D_WORK/reports-list.log" /bin/bash -c 'find /Library/Logs/DiagnosticReports ! -name DiagnosticReports -prune -type f -print 2>/dev/null | head -n 30' || :
  fi
  [ "$ok" -eq 1 ] || { d_result INCONCLUSIVE 3 OBSERVATION_UNAVAILABLE 'Не удалось собрать сведения.' 'Could not collect observations.';return 3; }
  d_result OBSERVATION 5 COLLECTION_ONLY 'Сведения собраны. Это не аппаратный PASS и не независимая проверка питания/экрана.' 'Observations collected. Not a hardware PASS or independent power/display verification.'
}
d_checklist(){
  cat > "$D_WORK/MANUAL_REVIEW_RU_EN.md" <<'CHECK'
# Приёмка после ремонта / Post-repair review
AUTO TESTS DO NOT CERTIFY REPAIR / Автотесты не удостоверяют качество ремонта.

- [ ] Записать, что ремонтировали/заменяли. / Record repaired/replaced components.
- [ ] Проверить модель, объём RAM, SSD и ОС по акту ремонта. / Match delivered configuration.
- [ ] Сохранить код Apple Diagnostics и независимый результат RAM-теста. / Save independent diagnostic results.
- [ ] Повторить память после полного выключения и новой загрузки; сравнить журналы. / Repeat RAM after shutdown and a new boot.
- [ ] Сон/пробуждение, перезагрузка, питание от сети и батареи. / Sleep/wake, reboot, AC and battery.
- [ ] Экран, внешний монитор, клавиши, звук, камера, используемые порты и Wi-Fi. / Display, peripherals and ports.
- [ ] Проверить новые panic/watchdog/аварийные отключения, не считать отсутствие отчёта доказательством исправности. / Review new crashes; missing logs are not proof of health.
- [ ] Просмотреть каждый FAIL/INCONCLUSIVE и все ограничения mlock/cache/объёма. / Review every failure, incomplete stage and coverage limitation.

Не загружать журналы публично без проверки серийных номеров и персональных данных.
Do not publish logs before reviewing serial numbers and personal data.
CHECK
  d_log "MANUAL_REVIEW=$D_WORK/MANUAL_REVIEW_RU_EN.md"
}
d_selftest(){
  local rc file bad=0
  /bin/bash "$D_ROOT/diagnostics/v2/verify.sh" "$D_ROOT" || bad=1
  for file in "$D_ROOT"/diagnostics/v2/*.sh;do /bin/bash -n "$file" || bad=1;done
  for file in "$D_ROOT"/diagnostics/v2/*.pl;do perl -c "$file" || bad=1;done
  d_hash_ready || bad=1
  [ "$bad" -eq 0 ] || { d_result INCONCLUSIVE 3 TOOLKIT_INVALID 'Пакет или инструменты не прошли самопроверку. Аппаратные тесты заблокированы.' 'Package/tools failed self-check. Hardware tests are blocked.';return 3; }
  d_result PASS 0 TOOLKIT_STATIC_AND_HASH_ONLY 'Пакет, синтаксис и контрольный хэш проверены. Это не испытание оборудования.' 'Package, syntax and reference hash checked. Not a hardware test.'
}
d_stage(){
  local mode=$1 rc output="$D_WORK/stage-$1.log" state fifo logger lrc
  d_log "STAGE_START=$mode"
  fifo="$D_WORK/stage-$mode.pipe"
  mkfifo "$fifo" || { D_LAST=3; return 0; }
  tee "$output" < "$fifo" & logger=$!
  MACDIAG_REPORT_DIR="$D_WORK" /bin/bash "$D_ROOT/diagnostics/v2/run.sh" "$mode" > "$fifo" 2>&1 &
  D_CHILD=$!;wait "$D_CHILD";rc=$?;D_CHILD=''
  wait "$logger";lrc=$?;rm -f "$fifo"
  [ "$lrc" -eq 0 ] || rc=3
  state=$(awk '/^RESULT=/{s=$1} END{print s}' "$output")
  [ -n "$state" ] || rc=3
  # Exit 0 is accepted only with a final exact PASS state.
  if [ "$rc" -eq 0 ] && [ "$state" != RESULT=PASS ];then rc=3;fi
  printf '%s\t%s\t%s\t%s\n' "$mode" "$rc" "$state" "$output" >> "$D_WORK/results.tsv" || rc=3
  d_log "STAGE_END=$mode code=$rc state=$state"
  D_LAST=$rc
  return 0
}
d_gate(){
  local rc=$1 reason=$2
  case "$rc" in
    2) d_result FAIL 2 "$reason" 'Предшествующий тест сообщил об ошибке. Зависимые проверки остановлены; конкретный компонент не установлен.' 'A prerequisite test reported failure. Dependent tests stopped; component attribution is unconfirmed.';;
    130|143) d_result CANCELLED 130 "$reason" 'Проверка прервана.' 'Test interrupted.';;
    *) d_result INCONCLUSIVE 3 "$reason" 'Предшествующая проверка не завершена. Зависимые тесты не запущены.' 'Prerequisite check incomplete. Dependent tests were not started.';;
  esac
}
d_suite(){
  local type=$1 mode rc codes=()
  printf 'test\texit_code\tstate\tlog\n' > "$D_WORK/results.tsv"
  d_checklist
  d_stage selftest; if [ "$D_LAST" -ne 0 ];then d_gate 3 TOOLKIT_GATE;return 3;fi
  d_stage hardware
  d_stage power
  d_stage ram-quick;codes+=("$D_LAST")
  if [ "$D_LAST" -ne 0 ];then d_gate "$D_LAST" RAM_GATE;return "$?";fi
  if [ "$type" = acceptance ];then
    d_stage ram-full;codes+=("$D_LAST")
    if [ "$D_LAST" -ne 0 ];then d_gate "$D_LAST" RAM_FULL_GATE;return "$?";fi
  fi
  d_stage cpu; codes+=("$D_LAST")
  if [ "$D_LAST" -ne 0 ];then d_gate "$D_LAST" CPU_GATE;return "$?";fi
  for mode in gpu network download;do d_stage "$mode";codes+=("$D_LAST");if [ "$D_LAST" -eq 130 ];then d_gate 130 INTERRUPTED;return 130;fi;done
  if [ "$type" = acceptance ];then d_stage storage;codes+=("$D_LAST");fi
  d_stage display
  d_aggregate "${codes[@]}";rc=$?
  if [ "$rc" -eq 2 ];then d_result FAIL 2 SUITE_OBSERVATION 'Один или несколько тестов сообщили об ошибке; смотрите отдельные журналы, не назначайте виновный чип по сводке.' 'One or more tests reported failure; review stage logs, not a presumed chip diagnosis.'
  elif [ "$rc" -eq 130 ];then d_result CANCELLED 130 SUITE_INTERRUPTED 'Комплекс прерван.' 'Suite interrupted.'
  elif [ "$rc" -ne 0 ];then d_result INCONCLUSIVE 3 SUITE_INCOMPLETE 'Часть обязательных тестов не завершена. Общий PASS не выдаётся.' 'Some required stages are incomplete. No overall PASS is issued.'
  else d_result INCONCLUSIVE 3 AUTO_PASSED_MANUAL_REVIEW_REQUIRED 'Автоматические этапы пройдены. Приёмка ремонта требует ручного списка, независимого теста и повтора после выключения.' 'Automatic stages passed. Repair acceptance still requires manual review, an independent test and a new-boot repeat.';fi
}
d_main(){
  local mode=${1:-selftest} rc
  d_init "$mode" || return 3
  d_need perl awk grep tee curl mkfifo || return 3
  p_detect
  p_apply "${P_REQUEST_MODEL:-auto}" "${P_REQUEST_OS:-auto}" "${P_REQUEST_ENV:-auto}" || { d_result INCONCLUSIVE 3 PROFILE_MISMATCH 'Профиль противоречит обнаруженной системе.' 'Profile contradicts the detected system.';return 3; }
  p_show | tee -a "$D_LOG"
  p_allow "$mode" || { d_result INCONCLUSIVE 3 PROFILE_OR_ENVIRONMENT 'Для режима нужна полная macOS Intel с подходящим профилем; Recovery поддерживает только ограниченные проверки.' 'This mode needs an eligible full Intel macOS; Recovery supports limited checks only.';return 3; }
  case "$mode" in
    ram-quick) d_ram quick;;ram-full) d_ram full;;ram-map) d_ram map;;
    storage) d_storage;;cpu) d_cpu;;gpu) d_gpu;;download) d_download;;network) d_network;;
    hardware|power|display) d_observe "$mode";;selftest) d_selftest;;
    safe|acceptance) d_suite "$mode";;checklist) d_checklist;d_result OBSERVATION 5 CHECKLIST_ONLY 'Создан ручной список.' 'Manual checklist created.';;
    *) d_result INCONCLUSIVE 3 UNKNOWN_MODE 'Неизвестный режим.' 'Unknown mode.';;
  esac
  rc=$?
  d_log "RUN_FINISHED code=$rc report=$D_WORK"
  if [ "${D_LOG_FAILED:-0}" -ne 0 ] && [ "$rc" -eq 0 ];then
    printf 'RESULT=INCONCLUSIVE code=3 reason=LOG_WRITE_FAILURE\n';rc=3
  fi
  return "$rc"
}
if [ "${BASH_SOURCE[0]}" = "$0" ];then d_main "$@";exit "$?";fi
