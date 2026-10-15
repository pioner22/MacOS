#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Text reports only; no automatic upload, repair verdict, or unverified PASS.
next_step(){
  if [ "${2:-}" = PASS ];then
    say 'RU: Завершён только указанный этап и объём. Остальные проверки не заменены.'
    say 'EN: Only the stated stage and coverage completed; other checks are not replaced.'
    return 0
  fi
  case "$1" in
    READONLY_NOT_AUTHORIZED|READONLY_PROFILE_UNAVAILABLE|READONLY_TOOLS_UNAVAILABLE|READONLY_PERL_CAPABILITY_UNAVAILABLE|READONLY_DEVICE_LIST_UNAVAILABLE|READONLY_DEVICE_INVALID|READONLY_METADATA_UNAVAILABLE|READONLY_PHYSICAL_WHOLE_DISK_NOT_CONFIRMED|READONLY_METADATA_INVALID|READONLY_TARGET_CHANGED)
      say 'RU: Чтение накопителя не начиналось: нет подтверждения или не пройдена предварительная проверка. Данные на диске этим этапом не проверены.'
      say 'EN: Drive reading did not start: consent or preflight is missing. This stage did not test disk contents.';;
    READONLY_*)
      say 'RU: Проверено только чтение выбранных диапазонов. Смотрите раздел HDD/SSD READ ONLY, engine.log и read-target.tsv. Данные не исправлялись; при ошибке сохраните важные файлы, не запускайте повторную нагрузку.'
      say 'EN: Only selected-range readability was tested. See HDD/SSD READ ONLY, engine.log and read-target.tsv. No repair was performed; preserve valuable data and avoid repeated load after errors.';;
    *COVERAGE*|*BUDGET*|RAM_MAP_REQUIRES_NATIVE)
      say 'RU: См. coverage.tsv: исходный план не выполнен либо карта недоступна. Уменьшенный объём не даёт RAM PASS.'
      say 'EN: See coverage.tsv: the original plan is incomplete or mapping unavailable. Reduced coverage cannot pass the RAM plan.';;
    *UNAVAILABLE*|*INVALID*|*UNKNOWN*|*MISSING*|SUPPORT_NO_*)
      say 'RU: Не выполнены условия запуска. Смотрите причину и probes.log; аппаратная неисправность не установлена.'
      say 'EN: A prerequisite is unavailable. Inspect the reason and probes.log; no hardware diagnosis is established.';;
    *SCREEN_CLEAN*)
      say 'RU: Скрининг не нашёл несовпадений, но нативное полное покрытие не получено. INCONCLUSIVE здесь не означает поломку.'
      say 'EN: Screening found no mismatch but native coverage is missing. INCONCLUSIVE here does not mean faulty hardware.';;
    *COMPILER*|*BUILD*|*CLANG*|*TOOLCHAIN*)
      say 'RU: Нативному движку нужен рабочий совместимый компилятор или проверенный бинарник. В Recovery используйте доступный ограниченный скрининг. Ошибка сборки не доказывает дефект оборудования.'
      say 'EN: A native engine needs a compatible toolchain or verified binary; Recovery may offer limited screening. A build error is not a hardware diagnosis.';;
    *RESOURCE*|*RAM_INCOMPLETE*|*MLOCK*)
      say 'RU: Смотрите engine.log: mlock, нехватка ресурсов или тайм-аут. Закройте приложения; не считайте это битой RAM.'
      say 'EN: Inspect engine.log for mlock, resource limits or timeout. Close applications; do not diagnose faulty RAM from this alone.';;
    *INTERRUPT*)
      say 'RU: Тест остановлен. Незавершённые этапы не пройдены; повторный запуск — отдельный сеанс.'
      say 'EN: Test stopped. Unfinished stages are not passes; a retry is a separate session.';;
    *RAM_DATA*|*CPU_RAM*)
      say 'RU: Нагрузка остановлена. Сохраните журнал и подтвердите несовпадение независимым инструментом перед ремонтом платы.'
      say 'EN: Load stopped. Preserve the log and confirm the mismatch independently before board repair.';;
    *DOWNLOAD*|*HTTPS*|*REMOTE*)
      say 'RU: Проверьте HTTP/curl и наличие эталонного файла; повторите через другую сеть. Не назначайте виновным SSD или RAM по сетевой ошибке.'
      say 'EN: Check HTTP/curl and fixture availability; retry on another network. A network error alone does not identify SSD or RAM faults.';;
    *AUTHORIZ*|*CONSENT*)
      say 'RU: Запись не разрешена и не запускалась. Для файлового этапа нужен отдельный выбор каталога и подтверждение.'
      say 'EN: Writing was not authorized or started. File testing needs a selected directory and explicit consent.';;
    *FULL*MACOS*|*NON_MACOS*|*PROFILE*)
      say 'RU: Проверьте фактически загруженную ОС и профиль. Recovery выбирает сценарии по доступным инструментам; не подменяйте загруженную ОС целевым установщиком.'
      say 'EN: Check the running OS and profile. Recovery chooses capability-based scenarios; do not substitute an installer target for the running OS.';;
    *GPU*)
      say 'RU: Сохраните журнал сборки и Metal. Этот тест охватывает путь GPU/драйвер/RAM, а не отдельную микросхему VRAM.'
      say 'EN: Keep the build and Metal logs. This tests the GPU/driver/RAM path, not an isolated VRAM chip.';;
    *FILE*|*IO_PATH*)
      say 'RU: Сохраните engine.log и оставленный тестовый файл. Проверьте том, свободное место, кабель и независимый RAM-тест.'
      say 'EN: Preserve engine.log and any retained test file. Check the volume, free space, cable and independent RAM results.';;
    *)
      say 'RU: Ориентируйтесь на состояние и причину этого этапа. Неполный результат не является PASS; сведения не являются тестом железа.'
      say 'EN: Follow this stage state and reason. An incomplete result is not PASS; inventory is not a hardware test.';;
  esac
}
report_render(){
  local final stage state reason location name found
  final=${1:-RUNNING}
  [ -n "${SESSION:-}" ] && [ -f "$SESSION/summary.tsv" ] || return 3
  {
    printf '# Mac Hardware Diagnostics %s — RU / EN\n\n' "$DIAG_VERSION"
    printf 'Состояние / State: **%s**\n\n' "$final"
    printf 'Исполнение / Execution: **%s**\n\n' "${SESSION_EXECUTION_STATE:-RUNNING}"
    if [ "${MODE:-}" = selftest ];then
      printf 'Область: только программный комплект; оборудование не проверялось.\nScope: software toolkit only; hardware was not tested.\n\n'
    fi
    printf 'CLOCK_TRUST=UNVERIFIED: системное время не удостоверено / wall clock not authenticated.\n\n'
    printf 'После завершения: выход из программы; следующий запуск — новый сеанс.\nAfter completion: exit; the next launch starts a new session.\n\n'
    printf 'Режим / Mode: `%s`  \nРевизия / Code revision: `%s`\n\n' "${MODE:-unknown}" "${MACDIAG_CODE_REF:-LOCAL_UNPINNED}"
    printf 'Начало UTC / Started UTC: %s  \nОбновлено UTC / Updated UTC: %s\n\n' "${SESSION_STARTED:-unknown}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'Это отчёт о выполненных проверках, не сертификат исправности.\nThis reports completed checks, not whole-machine certification.\n\n'
    printf '```text\n';cat "$SESSION/profile.txt" 2>/dev/null;printf '\n```\n\n'
    if [ -f "$SESSION/capabilities.tsv" ];then
      printf '## Возможности среды / Environment capabilities\n\n```text\n'
      cat "$SESSION/capabilities.tsv";printf '```\n\n'
    fi
    if [ -f "$SESSION/dispatch-plan.tsv" ];then
      printf '## Совместимость / Compatibility — NOT test results\n\n```text\n'
      cat "$SESSION/registry-selection.txt" "$SESSION/tool-capabilities.tsv" "$SESSION/dispatch-plan.tsv"
      printf '\n```\n\n'
    fi
    printf '| Этап / Stage | Состояние / State | Причина / Reason |\n|---|---|---|\n'
    while IFS=$'\t' read -r stage state reason location;do
      [ -n "$stage" ] || continue
      printf '| %s | %s | %s |\n' "$stage" "$state" "$reason"
    done < "$SESSION/summary.tsv"
    if [ -f "$SESSION/plan.txt" ];then
      while IFS= read -r name;do
        [ -n "$name" ] || continue
        if ! awk -F '\t' -v n="$name" '$1==n{ok=1} END{exit ok?0:1}' "$SESSION/summary.tsv";then
          printf '| %s | NOT_RUN | Не выполнен / Not executed |\n' "$name"
        fi
      done < "$SESSION/plan.txt"
    fi
    printf '\n## Покрытие RAM / RAM coverage\n\n'
    printf 'completed_mib означает полностью завершённый набор шаблонов. Ноль при прерывании не означает отсутствия частичной работы.\ncompleted_mib counts a complete pattern set; zero on interruption does not mean no partial work.\n\n'
    while IFS=$'\t' read -r stage state reason location;do
      if [ -f "$location/coverage.tsv" ];then
        printf '\n### %s\n\n```text\n' "$stage"
        cat "$location/coverage.tsv";printf '```\n'
      fi
    done < "$SESSION/summary.tsv"
    while IFS=$'\t' read -r stage state reason location;do
      if [ "$stage" = STORAGE_READONLY ] && [ -f "$location/read-target.tsv" ];then
        printf '\n## HDD/SSD READ ONLY — только чтение\n\n'
        printf 'No test data are written. PASS only covers readability, not correctness of existing files, write ability or filesystem consistency.\n'
        printf 'PASS означает только чтение указанного объёма, не исправность всех узлов и не проверку записи. ОС и журналы могут писать отдельно.\n\n```text\n'
        cat "$location/read-target.tsv"
        if [ -f "$location/engine.log" ];then
          awk '/^READ_PROGRESS/{last=$0} /^(READONLY_(SCOPE|CLOCK|BEGIN|SUMMARY)|READ_(IO_ERROR|SEEK_ERROR|UNEXPECTED_EOF))/{print} END{if(last!="")print last}' "$location/engine.log" || :
        fi
        printf '```\n'
      fi
    done < "$SESSION/summary.tsv"
    printf '\n## Действия / Next steps\n\n'
    while IFS=$'\t' read -r stage state reason location;do
      [ -n "$stage" ] && [ "$state" != NOT_RUN ] || continue
      printf '\n### %s — %s\n\n' "$stage" "$state"
      # A child's earlier PASS description is not the final conclusion after
      # a crash, log error or signal. Keep the original file as private evidence.
      if [ -f "$location/explanation.txt" ] && [ -f "$location/result.tsv" ] &&
         awk -F '\t' -v s="$state" -v r="$reason" 'NR==1 && NF==3 && $1==s && $3==r {ok=1} END{exit (NR==1&&ok)?0:1}' "$location/result.tsv";then
        cat "$location/explanation.txt"
      else
        printf 'RU: Итог определён по завершению процесса и журналу; раннее сообщение движка не заменяет этот результат.\nEN: Final state follows process completion and logging; an earlier engine message does not override it.\n'
      fi
      next_step "$reason" "$state"
      [ ! -f "$location/leftover-files.txt" ] || cat "$location/leftover-files.txt"
      printf '\nЖурнал / Log: `%s/output.log`\n' "$location"
    done < "$SESSION/summary.tsv"
    printf '\n## Ограничения / Limits\n\n'
    printf 'NOT_RUN, INCONCLUSIVE и прерывание не являются PASS. FAIL обозначает ошибку проверяемого пути, не локализует микросхему.\n'
    printf 'NOT_RUN, INCONCLUSIVE and interruption are not passes. FAIL identifies a tested-path error, not a specific component.\n\n'
    printf 'Файловая проверка не охватывает весь SSD. GPU: 256 МиБ на устройство. Адрес RAM — смещение выделения, не адрес чипа.\n'
    printf 'File testing does not cover the entire SSD. GPU: 256 MiB per device. RAM offsets are allocation-relative, not chip addresses.\n\n'
    printf 'Логи могут содержать идентификаторы оборудования. Автоматическая отправка отсутствует. При потере питания возможна потеря конца журнала.\n'
    printf 'Logs may contain hardware identifiers. No automatic upload. Sudden power loss can lose buffered output.\n'
  } > "$SESSION/report.tmp" || return 3
  mv "$SESSION/report.tmp" "$SESSION/REPORT_RU_EN.md"
}
# Reconcile a stage that started but never reached run_step post-processing.
# No traps are replaced in run_step. This also covers signals sent only to main.
record_unfinished_stage(){
  local code name dir state reason
  code=$1; name=${ACTIVE_STAGE_NAME:-}; dir=${ACTIVE_STAGE_DIR:-}
  [ -n "$name" ] && [ -n "$dir" ] || return 0
  case "$name" in *[!A-Z0-9_]*) return 3;;esac
  case "$dir" in "$SESSION"/"$name".*) ;;*) return 3;;esac
  [ -d "$dir" ] || return 3
  if awk -F '\t' -v n="$name" '$1==n{found=1} END{exit found?0:1}' "$SESSION/summary.tsv";then return 0;fi
  state=INCONCLUSIVE; reason=PROCESS_EXIT_WITHOUT_MATCHING_RESULT
  case "$code" in 129|130|143) reason=INTERRUPTED;;esac
  # Preserve a structured failure already emitted by the stage, even when the
  # subsequent shell bookkeeping was interrupted. Never promote an aborted PASS.
  if [ -f "$dir/result.tsv" ] && awk -F '\t' '
      NR==1 && NF==3 && $1=="FAIL" && $2=="2" && $3~/^[A-Z0-9_]+$/ {ok=1}
      END {exit (NR==1 && ok)?0:1}' "$dir/result.tsv";then
    state=FAIL; reason=$(awk -F '\t' 'NR==1{print $3}' "$dir/result.tsv")
  fi
  printf '%s\t%s\t%s\t%s\n' "$name" "$state" "$reason" "$dir" >> "$SESSION/summary.tsv" || return 3
  printf '%s\t%s\n' "$name" "$state" > "$SESSION/current-stage.tsv" || return 3
  printf '%s\n' "STAGE_TERMINATION_CODE=$code" > "$dir/termination.txt" || return 3
  if declare -F record_leftover_file >/dev/null;then record_leftover_file "$dir";fi
  say "STEP_END=$name STATE=$state REASON=$reason"
  next_step "$reason" "$state"
  ACTIVE_STAGE_NAME=;ACTIVE_STAGE_DIR=
}
record_not_run(){
  local name
  [ -f "$SESSION/plan.txt" ] || return 0
  while IFS= read -r name;do
    case "$name" in ''|*[!A-Z0-9_]*) continue;;esac
    if ! awk -F '\t' -v n="$name" '$1==n{ok=1} END{exit ok?0:1}' "$SESSION/summary.tsv";then
      printf '%s\tNOT_RUN\tPLAN_NOT_EXECUTED\t-\n' "$name" >> "$SESSION/summary.tsv" || return 3
    fi
  done < "$SESSION/plan.txt"
}
session_exit(){
  local code original_code final report_ok=0 meta_ok=1
  code=$1; original_code=$1
  trap - EXIT INT TERM HUP
  [ -n "${SESSION:-}" ] || return "$code"
  record_unfinished_stage "$code" || { say 'STAGE_FINALIZATION_FAILED';code=3; }
  record_not_run || { say 'PLAN_FINALIZATION_FAILED';code=3; }
  SESSION_EXECUTION_STATE=FINISHED
  case "$original_code" in 129|130|143) SESSION_EXECUTION_STATE=INTERRUPTED;;esac
  final=${SESSION_FINAL_STATE:-INCONCLUSIVE}
  case "$original_code" in 129|130|143) final=INTERRUPTED;;esac
  # Stale success must not survive a failure in post-processing.
  if [ "$code" -ne 0 ] && [ "$final" = PASS ];then final=INCONCLUSIVE;fi
  if [ -f "$SESSION/summary.tsv" ] && grep -q $'\tFAIL\t' "$SESSION/summary.tsv";then final=FAIL;fi
  printf 'execution\t%s\nexit_code\t%s\noriginal_exit_code\t%s\n' "$SESSION_EXECUTION_STATE" "$code" "$original_code" > "$SESSION/execution.tsv" || meta_ok=0
  printf 'FINISHED\t%s\t%s\n' "$final" "$code" > "$SESSION/session.state" || meta_ok=0
  if [ "$meta_ok" -eq 1 ] && report_render "$final";then
    report_ok=1
  else
    # Do not leave PASS/0 in status files while exiting with a report failure.
    code=3
    [ "$final" = FAIL ] || final=INCONCLUSIVE
    say 'REPORT_WRITE_FAILED / Не удалось завершить сохранение отчёта'
    printf 'execution\t%s\nexit_code\t3\noriginal_exit_code\t%s\nreport_state\tERROR\n' "$SESSION_EXECUTION_STATE" "$original_code" > "$SESSION/execution.tsv" || :
    printf 'FINISHED\t%s\t3\n' "$final" > "$SESSION/session.state" || :
    # A partial or earlier RUNNING report must never masquerade as the final one.
    if [ -f "$SESSION/REPORT_RU_EN.md" ];then
      mv "$SESSION/REPORT_RU_EN.md" "$SESSION/REPORT_INCOMPLETE_RU_EN.md" || :
    fi
  fi
  say "FINAL_STATE=$final EXIT_CODE=$code"
  if [ "$report_ok" -eq 1 ];then say "REPORT=$SESSION/REPORT_RU_EN.md"
  else say "REPORT=UNAVAILABLE EVIDENCE_DIRECTORY=$SESSION";fi
  say 'RU: Храните полный каталог локально. Для передачи используйте очищенный SUPPORT; полные логи могут раскрыть личные сведения.'
  say 'EN: Keep the full directory private. Share reviewed SUPPORT output; raw logs may contain private identifiers.'
  say 'SESSION_END_ACTION=EXIT'
  say 'RU: Сеанс завершён; автоматического возврата в меню нет. Следующий тест — новый запуск постоянной команды.'
  say 'EN: Session ended; no automatic menu return. Start the permanent command again for another test.' 
  exit "$code"
}
