#!/bin/bash
# Bash 3.2 library. Selecting a profile never installs an OS or changes hardware.
# Recovery detection is conservative and heuristic, not a security boundary.
DP_VERSION=MODEL_OS_PROFILE_V1

dp_path_exists(){ [ -e "$1" ]; }
dp_tool(){ command -v "$1" >/dev/null 2>&1; }
dp_os_key(){
  case "$1" in
    10.15|10.15.*) printf catalina;;
    11|11.*) printf big_sur;; 12|12.*) printf monterey;;
    13|13.*) printf ventura;; 14|14.*) printf sonoma;;
    15|15.*) printf sequoia;; 26|26.*) printf tahoe;;
    *) printf other;;
  esac
}
dp_detect(){
  DP_KERNEL=$(uname -s 2>/dev/null); DP_ARCH=$(uname -m 2>/dev/null)
  DP_MODEL=unknown; DP_CPU=unknown; DP_RAM_BYTES=unknown
  DP_OS_VERSION=unknown; DP_OS_BUILD=unknown; DP_TRANSLATED=unknown
  DP_ENV=unknown; DP_ENV_EVIDENCE=none; DP_OS_KEY=other
  DP_PERL=no; DP_SHA=no; DP_METAL=no; DP_COMPILER=no
  DP_DEFAULT_MODEL=limited
  [ "$DP_KERNEL" = Darwin ] || return 0
  local vendor arm root_info
  DP_MODEL=$(sysctl -n hw.model 2>/dev/null); [ -n "$DP_MODEL" ] || DP_MODEL=unknown
  DP_RAM_BYTES=$(sysctl -n hw.memsize 2>/dev/null)
  case "$DP_RAM_BYTES" in ''|*[!0-9]*) DP_RAM_BYTES=unknown;; esac
  DP_TRANSLATED=$(sysctl -n sysctl.proc_translated 2>/dev/null)
  case "$DP_TRANSLATED" in 0|1) ;; *) DP_TRANSLATED=unknown;; esac
  arm=$(sysctl -n hw.optional.arm64 2>/dev/null)
  vendor=$(sysctl -n machdep.cpu.vendor 2>/dev/null)
  if [ "$DP_ARCH" = arm64 ] || [ "$arm" = 1 ] || [ "$DP_TRANSLATED" = 1 ]; then
    DP_CPU=apple_silicon; DP_DEFAULT_MODEL=apple_observation
  elif [ "$DP_ARCH" = x86_64 ] && [ "$vendor" = GenuineIntel ]; then
    DP_CPU=intel; DP_DEFAULT_MODEL=intel_generic
    case "$DP_MODEL" in MacBookPro16,1|MacBookPro16,4) DP_DEFAULT_MODEL=a2141;; esac
  fi
  DP_OS_VERSION=$(sw_vers -productVersion 2>/dev/null)
  DP_OS_BUILD=$(sw_vers -buildVersion 2>/dev/null)
  [ -n "$DP_OS_VERSION" ] || DP_OS_VERSION=unknown
  [ -n "$DP_OS_BUILD" ] || DP_OS_BUILD=unknown
  DP_OS_KEY=$(dp_os_key "$DP_OS_VERSION")
  root_info=$(LC_ALL=C diskutil info / 2>/dev/null)
  # Never infer Recovery from root UID, a missing Finder, or a user selection alone.
  if dp_path_exists /System/Installation/CDIS; then
    case "$root_info" in
      *'OS X Base System'*|*'macOS Base System'*)
        DP_ENV=recovery; DP_ENV_EVIDENCE=cdis_and_base_system_root;;
    esac
  elif dp_path_exists /System/Library/CoreServices/Finder.app && dp_path_exists /var/db/.AppleSetupDone; then
    DP_ENV=full; DP_ENV_EVIDENCE=finder_and_setup_marker
  fi
  dp_tool perl && DP_PERL=yes
  if dp_tool sha256sum || dp_tool shasum; then DP_SHA=yes; fi
  dp_path_exists /System/Library/Frameworks/Metal.framework && DP_METAL=yes
  # clang on macOS can be a toolchain-install stub; presence alone is insufficient.
  if [ "$DP_ENV" = full ] && dp_tool xcode-select && xcode-select -p >/dev/null 2>&1; then
    if dp_tool xcrun && xcrun -f clang >/dev/null 2>&1; then DP_COMPILER=yes; fi
  fi
  return 0
}
dp_block(){
  printf 'PROFILE_STATE=INCONCLUSIVE reason=%s\n' "$1"
  printf 'RU: Профиль не разрешает этот запуск. Это не признак поломки Mac.\n'
  printf 'EN: This run is blocked by the profile; this is not a Mac hardware failure.\n'
  printf 'NEXT_RU: Сверьте модель и загруженную ОС; используйте автоопределение или ограниченный профиль.\n'
  printf 'NEXT_EN: Check the actual model and running OS; use automatic detection or the limited profile.\n'
  return 3
}
dp_apply(){
  local model_req os_req env_req
  model_req=${1:-auto}; os_req=${2:-auto}; env_req=${3:-auto}
  DP_VALID=no
  case "$model_req" in auto|a2141|intel_generic|apple_observation|limited) ;; *) dp_block INVALID_MODEL; return 3;; esac
  case "$os_req" in auto|catalina|big_sur|monterey|ventura|sonoma|sequoia|tahoe|other) ;; *) dp_block INVALID_OS; return 3;; esac
  case "$env_req" in auto|recovery|full|limited) ;; *) dp_block INVALID_ENVIRONMENT; return 3;; esac
  DP_SELECTED_MODEL=$model_req
  [ "$model_req" = auto ] && DP_SELECTED_MODEL=$DP_DEFAULT_MODEL
  case "$DP_SELECTED_MODEL" in
    a2141)
      [ "$DP_CPU" = intel ] || { dp_block MODEL_CPU_MISMATCH; return 3; }
      case "$DP_MODEL" in MacBookPro16,1|MacBookPro16,4) ;; *) dp_block MODEL_ID_MISMATCH; return 3;; esac;;
    intel_generic) [ "$DP_CPU" = intel ] || { dp_block INTEL_NOT_DETECTED; return 3; };;
    apple_observation) [ "$DP_CPU" = apple_silicon ] || { dp_block APPLE_SILICON_NOT_DETECTED; return 3; };;
  esac
  if [ "$os_req" != auto ] && [ "$os_req" != other ] && [ "$os_req" != "$DP_OS_KEY" ]; then
    dp_block OS_VERSION_MISMATCH; return 3
  fi
  DP_SELECTED_OS=$os_req; [ "$os_req" = auto ] && DP_SELECTED_OS=$DP_OS_KEY
  DP_SELECTED_ENV=$env_req; [ "$env_req" = auto ] && DP_SELECTED_ENV=$DP_ENV
  if [ "$env_req" != auto ] && [ "$env_req" != limited ] && [ "$DP_ENV" != unknown ] && [ "$env_req" != "$DP_ENV" ]; then
    dp_block ENVIRONMENT_MISMATCH; return 3
  fi
  # Selecting Recovery when detection is unknown records a claim, not elevated permission.
  DP_STORAGE=no
  if [ "$DP_KERNEL" = Darwin ] && [ "$DP_SELECTED_MODEL" = a2141 ] &&
     [ "$DP_ENV" = recovery ] && [ "$DP_SELECTED_ENV" = recovery ] &&
     [ "$DP_OS_KEY" != other ] && [ "$DP_SELECTED_OS" != other ]; then DP_STORAGE=candidate_only; fi
  DP_GPU=probe_only
  if [ "$DP_ENV" = full ] && [ "$DP_SELECTED_ENV" = full ] &&
     [ "$DP_METAL" = yes ] && [ "$DP_COMPILER" = yes ] &&
     [ "$DP_CPU" = intel ] && [ "$DP_SELECTED_MODEL" != limited ] &&
     [ "$DP_SELECTED_OS" != other ]; then DP_GPU=prerequisites_present; fi
  DP_VALID=yes
  MACDIAG_MODEL_REQUEST=$model_req; MACDIAG_OS_REQUEST=$os_req; MACDIAG_ENV_REQUEST=$env_req
  export MACDIAG_MODEL_REQUEST MACDIAG_OS_REQUEST MACDIAG_ENV_REQUEST
  return 0
}
dp_show(){
  printf '\n=== RU: Модель и загруженная среда ===\n'
  printf 'Модель: %s | CPU: %s | Архитектура процесса: %s\n' "$DP_MODEL" "$DP_CPU" "$DP_ARCH"
  printf 'macOS: %s | Сборка: %s | Режим: %s\n' "$DP_OS_VERSION" "$DP_OS_BUILD" "$DP_ENV"
  printf 'Это версия работающей среды, НЕ выбранного установщика или ОС на другом томе.\n'
  printf '=== EN: Model and running environment ===\n'
  printf 'MODEL=%s CPU=%s PROCESS_ARCH=%s ROSETTA=%s RAM_BYTES=%s\n' "$DP_MODEL" "$DP_CPU" "$DP_ARCH" "$DP_TRANSLATED" "$DP_RAM_BYTES"
  printf 'RUNNING_MACOS=%s BUILD=%s ENV=%s EVIDENCE=%s\n' "$DP_OS_VERSION" "$DP_OS_BUILD" "$DP_ENV" "$DP_ENV_EVIDENCE"
  printf 'PROFILE_VERSION=%s MODEL_PROFILE=%s OS_PROFILE=%s ENV_PROFILE=%s\n' "$DP_VERSION" "$DP_SELECTED_MODEL" "$DP_SELECTED_OS" "$DP_SELECTED_ENV"
  printf 'PERL=%s SHA_TOOL=%s METAL_FRAMEWORK=%s CLANG_TOOLCHAIN=%s\n' "$DP_PERL" "$DP_SHA" "$DP_METAL" "$DP_COMPILER"
  printf 'STORAGE_POLICY=%s GPU_POLICY=%s PROFILE_VALID=%s\n' "$DP_STORAGE" "$DP_GPU" "$DP_VALID"
  printf 'RU: Профиль не запускает тесты; наличие утилиты не означает PASS оборудования.\n'
  printf 'EN: A profile does not run tests; tool availability is not hardware PASS.\n'
}
dp_allow(){
  local script
  script=$1
  [ "$DP_VALID" = yes ] || { dp_block INVALID_PROFILE; return 3; }
  case "$script" in
    toolkit_selftest.sh) return 0;;
  esac
  [ "$DP_KERNEL" = Darwin ] || { dp_block NON_MACOS_ENVIRONMENT; return 3; }
  case "$script" in
    hardware_probe.sh|power_thermal_test.sh|network_test.sh|download_test.sh) return 0;;
    ssd_test.sh|full_all_suite.sh)
      [ "$DP_STORAGE" = candidate_only ] || { dp_block STORAGE_PROFILE_NOT_APPROVED; return 3; }
      printf 'RU: Модель подходит только для дальнейших проверок SSD; это НЕ разрешение на стирание.\n'
      printf 'EN: Model eligibility only; further device checks and explicit erase consent are required.\n'
      return 0;;
  esac
  [ "$DP_CPU" = intel ] && [ "$DP_SELECTED_MODEL" != limited ] &&
  [ "$DP_SELECTED_ENV" != limited ] && [ "$DP_SELECTED_OS" != other ] || {
    dp_block TEST_NOT_VALIDATED_FOR_PROFILE; return 3;
  }
  case "$script" in
    ram_quick_test.sh|ram_full_test.sh|ram_map.sh)
      [ "$DP_PERL" = yes ] || { dp_block PERL_NOT_AVAILABLE; return 3; };;
    cpu_test.sh) [ "$DP_SHA" = yes ] || { dp_block SHA_TOOL_NOT_AVAILABLE; return 3; };;
    gpu_test.sh|display_video_test.sh|full_safe_suite.sh) ;; # Scripts still probe their own prerequisites.
    *) dp_block UNKNOWN_TEST; return 3;;
  esac
  return 0
}
dp_read_reply(){
  DP_REPLY=''
  # No read timeouts: older Recovery shells differ. EOF never grants permission.
  if ( : </dev/tty ) 2>/dev/null; then
    IFS= read -r DP_REPLY </dev/tty
  elif [ -t 0 ]; then IFS= read -r DP_REPLY
  else return 1; fi
}
dp_choose(){
  local mr orq er
  printf '\nRU: Выбор модели. EN: Model profile.\n'
  printf '0/Enter AUTO; 1 A2141 (MacBookPro16,1/16,4); 2 Generic Intel; 3 Apple silicon (limited); 4 Limited\n> '
  dp_read_reply || { dp_block NO_INTERACTIVE_INPUT; return 3; }
  case "$DP_REPLY" in ''|0) mr=auto;;1) mr=a2141;;2) mr=intel_generic;;3) mr=apple_observation;;4) mr=limited;;*) dp_block INVALID_MODEL_SELECTION; return 3;;esac
  printf 'RU: Загруженная ОС, не целевой установщик. EN: Running OS, not installation target.\n'
  printf '0/Enter AUTO; 1 Catalina; 2 Big Sur; 3 Monterey; 4 Ventura; 5 Sonoma; 6 Sequoia; 7 Tahoe; 8 Other/limited\n> '
  dp_read_reply || { dp_block NO_INTERACTIVE_INPUT; return 3; }
  case "$DP_REPLY" in ''|0) orq=auto;;1) orq=catalina;;2) orq=big_sur;;3) orq=monterey;;4) orq=ventura;;5) orq=sonoma;;6) orq=sequoia;;7) orq=tahoe;;8) orq=other;;*) dp_block INVALID_OS_SELECTION; return 3;;esac
  printf 'RU: Среда. EN: Environment. 0/Enter AUTO; 1 Recovery; 2 Full macOS; 3 Limited\n> '
  dp_read_reply || { dp_block NO_INTERACTIVE_INPUT; return 3; }
  case "$DP_REPLY" in ''|0) er=auto;;1) er=recovery;;2) er=full;;3) er=limited;;*) dp_block INVALID_ENV_SELECTION; return 3;;esac
  dp_apply "$mr" "$orq" "$er" || return 3
  dp_show
}
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  dp_detect
  dp_apply auto auto auto || exit 3
  dp_show
  printf 'RESULT=PROFILE_DETECTED_NOT_HARDWARE_TEST\n'
fi
