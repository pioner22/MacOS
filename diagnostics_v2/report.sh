#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Text reports only; no automatic upload, repair verdict, or unverified PASS.
next_step(){
  case "$1" in
    *COMPILER*|*BUILD*|*CLANG*|*TOOLCHAIN*)
      say 'RU: Нужна полная macOS и установленные Command Line Tools. Ошибка сборки не доказывает дефект оборудования.'
      say 'EN: Use full macOS with Command Line Tools. A build error is not a hardware diagnosis.';;
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
      say 'RU: Проверьте фактически загруженную ОС и профиль. В Recovery нативная приёмка этой версии недоступна.'
      say 'EN: Check the running OS and profile. Native acceptance in this version is unavailable in Recovery.';;
    *GPU*)
      say 'RU: Сохраните журнал сборки и Metal. Этот тест охватывает путь GPU/драйвер/RAM, а не отдельную микросхему VRAM.'
      say 'EN: Keep the build and Metal logs. This tests the GPU/driver/RAM path, not an isolated VRAM chip.';;
    *FILE*|*IO_PATH*)
      say 'RU: Сохраните engine.log и оставленный тестовый файл. Проверьте том, свободное место, кабель и независимый RAM-тест.'
      say 'EN: Preserve engine.log and any retained test file. Check the volume, free space, cable and independent RAM results.';;
    *)
      say 'RU: PASS относится только к выполненному этапу. Для приёмки нужны независимый RAM-тест, повтор после выключения и ручная проверка.'
      say 'EN: PASS covers only the completed stage. Acceptance needs independent RAM testing, a cold-boot repeat and manual checks.';;
  esac
}
report_render(){
  local final stage state reason location name found
  final=${1:-RUNNING}
  [ -n "${SESSION:-}" ] && [ -f "$SESSION/summary.tsv" ] || return 3
  {
    printf '# Mac Hardware Diagnostics %s — RU / EN\n\n' "$DIAG_VERSION"
    printf 'Состояние / State: **%s**\n\n' "$final"
    printf 'Режим / Mode: `%s`  \nРевизия / Code revision: `%s`\n\n' "${MODE:-unknown}" "${MACDIAG_CODE_REF:-LOCAL_UNPINNED}"
    printf 'Начало UTC / Started UTC: %s  \nОбновлено UTC / Updated UTC: %s\n\n' "${SESSION_STARTED:-unknown}" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'Это отчёт о выполненных проверках, не сертификат исправности.\nThis reports completed checks, not whole-machine certification.\n\n'
    printf '```text\n';cat "$SESSION/profile.txt" 2>/dev/null;printf '\n```\n\n'
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
    printf '\n## Действия / Next steps\n\n'
    while IFS=$'\t' read -r stage state reason location;do
      [ -n "$stage" ] || continue
      printf '\n### %s — %s\n\n' "$stage" "$state"
      [ ! -f "$location/explanation.txt" ] || cat "$location/explanation.txt"
      next_step "$reason"
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
session_exit(){
  local code final
  code=$1
  trap - EXIT INT TERM HUP
  [ -n "${SESSION:-}" ] || return "$code"
  final=${SESSION_FINAL_STATE:-INCONCLUSIVE}
  case "$code" in 129|130|143) final=INTERRUPTED;;esac
  # A known failure remains visible even when subsequent work was interrupted.
  if [ -f "$SESSION/summary.tsv" ] && grep -q $'\tFAIL\t' "$SESSION/summary.tsv";then
    [ "$final" = INTERRUPTED ] || final=FAIL
  fi
  printf 'FINISHED\t%s\t%s\n' "$final" "$code" > "$SESSION/session.state" || code=3
  report_render "$final" || { say 'REPORT_WRITE_FAILED / Не удалось сохранить отчёт';code=3; }
  say "FINAL_STATE=$final EXIT_CODE=$code"
  say "REPORT=$SESSION/REPORT_RU_EN.md"
  say 'RU: Сохраните каталог отчёта целиком. EN: Keep the entire report directory.'
  sync
  exit "$code"
}
