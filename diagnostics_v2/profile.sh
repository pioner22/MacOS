#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Observations -> composable profile -> capability-gated plan. Bash 3.2.
# No profile claims physical health or real-Mac validation.
pf_has(){ command -v "$1" >/dev/null 2>&1; }
pf_path(){ [ -e "$1" ]; }
# Bound inventory probes without depending on Python, Perl, timeout or CLT.
# Run in a subshell so caller signal handlers are never replaced.
pf_probe() (
  seconds=$1;shift
  if [ -n "${PF_LOG:-}" ];then "$@" </dev/null 2>>"$PF_LOG" &
  else "$@" </dev/null & fi
  child=$!
  (
    timer=''
    trap '[ -z "$timer" ] || kill -TERM "$timer" 2>/dev/null; [ -z "$timer" ] || wait "$timer" 2>/dev/null; exit 0' INT TERM HUP
    sleep "$seconds" & timer=$!;wait "$timer";timer=''
    kill -TERM "$child" 2>/dev/null
    sleep 1 & timer=$!;wait "$timer";timer=''
    kill -KILL "$child" 2>/dev/null
  ) </dev/null >/dev/null 2>&1 & guard=$!
  trap 'kill -TERM "$child" "$guard" 2>/dev/null; exit 130' INT TERM HUP
  wait "$child";rc=$?
  kill -TERM "$guard" 2>/dev/null;wait "$guard" 2>/dev/null
  if [ -n "${PF_LOG:-}" ];then printf 'PROBE command=%s rc=%s limit_seconds=%s\n' "$*" "$rc" "$seconds" >> "$PF_LOG";fi
  exit "$rc"
)
pf_os_key(){
  case "$1" in
    10.13|10.13.*) printf high_sierra;;10.14|10.14.*)printf mojave;;10.15|10.15.*)printf catalina;;
    11|11.*)printf big_sur;;12|12.*)printf monterey;;13|13.*)printf ventura;;14|14.*)printf sonoma;;
    15|15.*)printf sequoia;;26|26.*)printf tahoe;;*)printf other;;esac
}
profile_detect(){
  local arm vendor rootinfo safe single c path status v
  PF_LOG=$(mktemp /tmp/macdiag-probes.XXXXXX) || PF_LOG=
  KERNEL=$(uname -s 2>/dev/null); ARCH=$(uname -m 2>/dev/null)
  MODEL=unknown;CPU=unknown;OS_VERSION=unknown;OS_BUILD=unknown;OS_KEY=other;RAM_BYTES=0
  ENVIRONMENT=unknown;ENV_EVIDENCE=none;HW_PROFILE=unknown;ROSETTA=unknown
  CPU_NAME=unknown;CONSOLE=headless;PRIVILEGE=user;PAGE_SIZE=unknown;T2_STATUS=not_probed
  [ "${EUID:-1}" = 0 ] && PRIVILEGE=root
  if [ -n "${SSH_TTY:-}${SSH_CONNECTION:-}" ];then CONSOLE=ssh
  elif ( : </dev/tty ) 2>/dev/null;then CONSOLE=tty
  elif [ -t 0 ];then CONSOLE=tty;fi
  # Only the type of console is recorded, never SSH_CONNECTION or environment dumps.
  if [ "$KERNEL" = Darwin ];then
    MODEL=$(pf_probe 3 sysctl -n hw.model 2>/dev/null);[ -n "$MODEL" ] || MODEL=unknown
    case "$MODEL" in *[!A-Za-z0-9,._-]*)MODEL=unknown;;esac
    RAM_BYTES=$(pf_probe 3 sysctl -n hw.memsize 2>/dev/null)
    case "$RAM_BYTES" in ''|*[!0-9]*) RAM_BYTES=0;;esac
    [ "${#RAM_BYTES}" -le 13 ] || RAM_BYTES=0
    ROSETTA=$(pf_probe 3 sysctl -n sysctl.proc_translated 2>/dev/null)
    case "$ROSETTA" in 0|1);;*)ROSETTA=unknown;;esac
    arm=$(pf_probe 3 sysctl -n hw.optional.arm64 2>/dev/null)
    vendor=$(pf_probe 3 sysctl -n machdep.cpu.vendor 2>/dev/null)
    if [ "$ARCH" = arm64 ] || [ "$arm" = 1 ] || [ "$ROSETTA" = 1 ];then CPU=apple_silicon;HW_PROFILE=apple_silicon
    elif [ "$ARCH" = x86_64 ] && [ "$vendor" = GenuineIntel ];then
      CPU=intel;HW_PROFILE=intel_generic
      case "$MODEL" in MacBookPro16,1|MacBookPro16,4)HW_PROFILE=a2141;T2_STATUS=model_expected_not_measured;;esac
    fi
    CPU_NAME=$(pf_probe 3 sysctl -n machdep.cpu.brand_string 2>/dev/null);[ -n "$CPU_NAME" ] || CPU_NAME=$CPU
    PAGE_SIZE=$(pf_probe 3 sysctl -n hw.pagesize 2>/dev/null)
    case "$PAGE_SIZE" in ''|*[!0-9]*)PAGE_SIZE=unknown;;esac
    OS_VERSION=$(pf_probe 3 sw_vers -productVersion 2>/dev/null);[ -n "$OS_VERSION" ] || OS_VERSION=unknown
    OS_BUILD=$(pf_probe 3 sw_vers -buildVersion 2>/dev/null);[ -n "$OS_BUILD" ] || OS_BUILD=unknown
    OS_KEY=$(pf_os_key "$OS_VERSION")
    rootinfo=$(pf_probe 8 diskutil info / 2>/dev/null)
    # CDIS alone is insufficient, and root UID never implies Recovery.
    if pf_path /System/Installation/CDIS;then
      case "$rootinfo" in *'Base System'*)ENVIRONMENT=recovery;ENV_EVIDENCE=cdis_and_base_system;;
        *)ENVIRONMENT=installer_or_recovery;ENV_EVIDENCE=cdis_without_root_confirmation;;esac
    elif pf_path /System/Library/CoreServices/Finder.app && pf_path /var/db/.AppleSetupDone;then
      ENVIRONMENT=full;ENV_EVIDENCE=finder_and_setup_marker
      safe=$(pf_probe 3 sysctl -n kern.safeboot 2>/dev/null)
      if [ "$safe" = 1 ];then ENVIRONMENT=safe;ENV_EVIDENCE=kern_safeboot;fi
    fi
  fi
  MODEL_PROFILE=${MODEL_PROFILE:-auto};OS_PROFILE=${OS_PROFILE:-auto};ENV_PROFILE=${ENV_PROFILE:-auto}
  profile_capabilities
  profile_resolve
}
profile_capabilities(){
  local c path state compiler
  CAP_PERL=no;CAP_SUPERVISOR=no;CAP_NATIVE=no;CAP_SHA=no;CAP_CURL=no;CAP_FILE_PERL=no
  CAP_CLANG='';CAP_METAL=no;CAP_DISKUTIL=no;CAP_ROWS=''
  for c in perl curl openssl shasum sha256sum diskutil ioreg system_profiler vm_stat pmset caffeinate xcode-select xcrun;do
    path=$(command -v "$c" 2>/dev/null);state=missing
    [ -z "$path" ] || state=present_unprobed
    case "$c" in
      perl) if [ -n "$path" ] && pf_probe 3 "$path" -e 'exit((pack("V",0x12345678) eq "\x78\x56\x34\x12")?0:1)' >/dev/null 2>&1;then CAP_PERL=yes;state=working;fi;;
      curl) if [ -n "$path" ] && pf_probe 3 "$path" -q --version >/dev/null 2>&1;then CAP_CURL=yes;state=working;fi;;
      diskutil) [ -z "$path" ] || CAP_DISKUTIL=yes;;
    esac
    CAP_ROWS="${CAP_ROWS}${c}\t${state}\n"
  done
  if [ "$CAP_PERL" = yes ];then
    pf_probe 3 perl -MPOSIX -MIO::Select -MIO::Handle -e 'exit 0' >/dev/null 2>&1 && CAP_SUPERVISOR=yes
    pf_probe 3 perl -MFcntl=O_NOFOLLOW -MFile::Temp=tempfile -MCwd=abs_path -MIO::Handle -e 'exit 0' >/dev/null 2>&1 && CAP_FILE_PERL=yes
  fi
  if declare -F select_hash >/dev/null && select_hash;then CAP_SHA=yes;fi
  # Discover a real installed toolchain, never invoke an install stub or download one.
  if [ "$KERNEL" = Darwin ] && pf_has xcode-select && pf_probe 3 xcode-select -p >/dev/null 2>&1;then
    compiler=$(pf_probe 5 xcrun -f clang 2>/dev/null)
    if [ -n "$compiler" ] && [ -x "$compiler" ] && pf_probe 5 "$compiler" --version >/dev/null 2>&1;then
      CAP_CLANG=$compiler;CAP_NATIVE=candidate
    fi
  fi
  pf_path /System/Library/Frameworks/Metal.framework && CAP_METAL=present
}
profile_resolve(){
  local table id hw env policy
  PROFILE_TEMPLATE=unknown;PROFILE_POLICY=observe
  table="${ROOT:-$COMMON_ROOT}/profiles.tsv"
  if [ -f "$table" ];then
    while IFS=$'\t' read -r id hw env policy;do
      case "$id" in ''|\#*)continue;;esac
      [ "$hw" = "$HW_PROFILE" ] || [ "$hw" = any ] || continue
      [ "$env" = "$ENVIRONMENT" ] || [ "$env" = any ] || continue
      case "$policy" in adaptive|screen|observe);;*)continue;;esac
      PROFILE_TEMPLATE=$id;PROFILE_POLICY=$policy;break
    done < "$table"
  fi
  [ "${MODEL_PROFILE:-auto}" != limited ] && [ "${ENV_PROFILE:-auto}" != limited ] || PROFILE_POLICY=observe
  PROFILE_ID="$PROFILE_TEMPLATE.$OS_KEY.$ARCH.$CONSOLE"
  PROFILE_VALIDATION=SOFTWARE_TESTED_REAL_HARDWARE_PENDING
  RAM_BACKEND=unavailable;FILE_BACKEND=unavailable;CPU_BACKEND=unavailable;GPU_BACKEND=inventory
  if [ "$KERNEL" = Darwin ] && [ "$PROFILE_POLICY" != observe ] && [ "$CAP_SUPERVISOR" = yes ];then
    if [ "$PROFILE_POLICY" = adaptive ] && [ "$CAP_NATIVE" = candidate ] && [ "$CPU" = intel ] && [ "$OS_KEY" != other ];then
      RAM_BACKEND=native_candidate;FILE_BACKEND=native_candidate
    elif [ "$CAP_PERL" = yes ];then
      RAM_BACKEND=perl_screen
      [ "$CAP_FILE_PERL" != yes ] || FILE_BACKEND=perl_file_screen
    fi
    [ "$CAP_SHA" != yes ] || CPU_BACKEND=sha_path
    if [ "$ENVIRONMENT" = full ] && [ "$CPU" = intel ] && [ "$CAP_NATIVE" = candidate ] && [ "$CAP_METAL" = present ];then GPU_BACKEND=metal_candidate;fi
  fi
}
profile_validate(){
  case "$MODEL_PROFILE" in auto|limited);;a2141)[ "$CPU" = intel ] || return 3;case "$MODEL" in MacBookPro16,1|MacBookPro16,4);;*)return 3;;esac;;intel)[ "$CPU" = intel ] || return 3;;apple_silicon)[ "$CPU" = apple_silicon ] || return 3;;*)return 3;;esac
  case "$OS_PROFILE" in auto|other);;*)[ "$OS_PROFILE" = "$OS_KEY" ] || return 3;;esac
  case "$ENV_PROFILE" in auto|limited);;*)[ "$ENV_PROFILE" = "$ENVIRONMENT" ] || return 3;;esac
}
profile_show(){
  printf '\nVERSION=%s MODEL=%s CPU=%s ARCH=%s RAM_BYTES=%s\n' "$DIAG_VERSION" "$MODEL" "$CPU" "$ARCH" "$RAM_BYTES"
  printf 'CPU_NAME=%s T2_STATUS=%s\n' "${CPU_NAME:-unknown}" "${T2_STATUS:-not_probed}"
  printf 'RUNNING_OS=%s BUILD=%s ENVIRONMENT=%s EVIDENCE=%s\n' "$OS_VERSION" "$OS_BUILD" "$ENVIRONMENT" "${ENV_EVIDENCE:-unknown}"
  printf 'PROFILE_ID=%s POLICY=%s VALIDATION=%s\n' "${PROFILE_ID:-unknown}" "${PROFILE_POLICY:-observe}" "${PROFILE_VALIDATION:-unknown}"
  printf 'SHELL=Bash-%s CONSOLE=%s PRIVILEGE=%s ROSETTA=%s PAGE_SIZE=%s\n' "$BASH_VERSION" "${CONSOLE:-unknown}" "${PRIVILEGE:-unknown}" "${ROSETTA:-unknown}" "${PAGE_SIZE:-unknown}"
  printf 'TOOLS perl=%s supervisor=%s sha256=%s curl=%s compiler=%s\n' "${CAP_PERL:-no}" "${CAP_SUPERVISOR:-no}" "${CAP_SHA:-no}" "${CAP_CURL:-no}" "${CAP_NATIVE:-no}"
  printf 'BACKENDS ram=%s cpu=%s file=%s gpu=%s\n' "${RAM_BACKEND:-unavailable}" "${CPU_BACKEND:-unavailable}" "${FILE_BACKEND:-unavailable}" "${GPU_BACKEND:-inventory}"
  say 'RU: Профиль выбран по наблюдениям. Recovery не требует установленной ОС. Ограниченный скрининг не подтверждает всю RAM/SSD.'
  say 'EN: Profile selected from observations. Recovery needs no installed OS. Limited screening does not certify all RAM/storage.'
  say 'RU: Internet/local Recovery не различаются достоверно. Отсутствие инструмента — ограничение, не поломка.'
  say 'EN: Internet/local Recovery are not reliably distinguished. Missing tools are limitations, not hardware failures.'
}
profile_choose(){
  local mp op ep
  say 'MODEL / Модель: 0 AUTO; 1 A2141; 2 Intel generic; 3 Apple silicon; 4 Limited'
  read_reply || return 3
  case "$REPLY" in 0|'')mp=auto;;1)mp=a2141;;2)mp=intel;;3)mp=apple_silicon;;4)mp=limited;;*)return 3;;esac
  say 'RUNNING OS / Загруженная ОС: 0 AUTO; 1 Catalina; 2 Big Sur; 3 Monterey; 4 Ventura; 5 Sonoma; 6 Sequoia; 7 Tahoe; 8 Other'
  read_reply || return 3
  case "$REPLY" in 0|'')op=auto;;1)op=catalina;;2)op=big_sur;;3)op=monterey;;4)op=ventura;;5)op=sonoma;;6)op=sequoia;;7)op=tahoe;;8)op=other;;*)return 3;;esac
  say 'ENV / Среда: 0 AUTO; 1 Recovery; 2 Full macOS; 3 Limited'
  read_reply || return 3
  case "$REPLY" in 0|'')ep=auto;;1)ep=recovery;;2)ep=full;;3)ep=limited;;*)return 3;;esac
  if ( MODEL_PROFILE=$mp;OS_PROFILE=$op;ENV_PROFILE=$ep;profile_validate );then
    MODEL_PROFILE=$mp;OS_PROFILE=$op;ENV_PROFILE=$ep;profile_resolve
  else say 'PROFILE_MISMATCH: RU: Выбор противоречит наблюдениям. EN: Selection contradicts observations.';return 3;fi
}
intel_full(){ profile_validate && [ "$KERNEL" = Darwin ] && [ "$CPU" = intel ] && [ "$ENVIRONMENT" = full ] && [ "$MODEL_PROFILE" != limited ] && [ "$ENV_PROFILE" != limited ] && [ "$OS_PROFILE" != other ] && [ "$OS_KEY" != other ]; }
