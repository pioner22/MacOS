#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Detection is conservative. Manual claims can restrict, never elevate a profile.
profile_detect(){
  KERNEL=$(uname -s); ARCH=$(uname -m)
  MODEL=unknown; CPU=unknown; OS_VERSION=unknown; OS_BUILD=unknown; ENVIRONMENT=unknown; RAM_BYTES=0; OS_KEY=other
  if [ "$KERNEL" = Darwin ]; then
    MODEL=$(sysctl -n hw.model 2>/dev/null)
    RAM_BYTES=$(sysctl -n hw.memsize 2>/dev/null)
    case "$RAM_BYTES" in ''|*[!0-9]*) RAM_BYTES=0;;esac
    OS_VERSION=$(sw_vers -productVersion); OS_BUILD=$(sw_vers -buildVersion)
    case "$OS_VERSION" in 10.15|10.15.*) OS_KEY=catalina;;11|11.*) OS_KEY=big_sur;;12|12.*) OS_KEY=monterey;;13|13.*) OS_KEY=ventura;;14|14.*) OS_KEY=sonoma;;15|15.*) OS_KEY=sequoia;;26|26.*) OS_KEY=tahoe;;esac
    if [ "$ARCH" = arm64 ] || [ "$(sysctl -n hw.optional.arm64 2>/dev/null)" = 1 ] || [ "$(sysctl -n sysctl.proc_translated 2>/dev/null)" = 1 ]; then CPU=apple_silicon
    elif [ "$ARCH" = x86_64 ] && [ "$(sysctl -n machdep.cpu.vendor 2>/dev/null)" = GenuineIntel ]; then CPU=intel; fi
    if [ -d /System/Installation/CDIS ]; then
      case "$(diskutil info / 2>/dev/null)" in *'Base System'*) ENVIRONMENT=recovery;;esac
    elif [ -d /System/Library/CoreServices/Finder.app ] && [ -e /var/db/.AppleSetupDone ]; then ENVIRONMENT=full; fi
  fi
  MODEL_PROFILE=${MODEL_PROFILE:-auto}; OS_PROFILE=${OS_PROFILE:-auto}; ENV_PROFILE=${ENV_PROFILE:-auto}
}
profile_validate(){
  case "$MODEL_PROFILE" in
    auto|limited) ;;
    a2141) [ "$CPU" = intel ] || return 3; case "$MODEL" in MacBookPro16,1|MacBookPro16,4) ;;*) return 3;;esac;;
    intel) [ "$CPU" = intel ] || return 3;;
    apple_silicon) [ "$CPU" = apple_silicon ] || return 3;;
    *) return 3;;
  esac
  case "$OS_PROFILE" in auto|other) ;;*) [ "$OS_PROFILE" = "$OS_KEY" ] || return 3;;esac
  case "$ENV_PROFILE" in auto|limited) ;;*) [ "$ENV_PROFILE" = "$ENVIRONMENT" ] || return 3;;esac
}
profile_show(){
  printf 'VERSION=%s MODEL=%s CPU=%s ARCH=%s RAM_BYTES=%s\n' "$DIAG_VERSION" "$MODEL" "$CPU" "$ARCH" "$RAM_BYTES"
  printf 'RUNNING_OS=%s BUILD=%s ENVIRONMENT=%s PROFILE=%s/%s/%s\n' "$OS_VERSION" "$OS_BUILD" "$ENVIRONMENT" "$MODEL_PROFILE" "$OS_PROFILE" "$ENV_PROFILE"
  say 'RU: Это загруженная среда, не целевой установщик. Готовность инструмента не означает исправность оборудования.'
  say 'EN: This is the running environment, not the installer target. Tool availability is not hardware PASS.'
}
profile_choose(){
  local mp op ep
  say 'MODEL: 0 AUTO; 1 A2141; 2 Intel generic; 3 Apple silicon limited; 4 Limited'
  read_reply || return 3
  case "$REPLY" in 0|'')mp=auto;;1)mp=a2141;;2)mp=intel;;3)mp=apple_silicon;;4)mp=limited;;*)return 3;;esac
  say 'RUNNING OS: 0 AUTO; 1 Catalina; 2 Big Sur; 3 Monterey; 4 Ventura; 5 Sonoma; 6 Sequoia; 7 Tahoe; 8 Other'
  read_reply || return 3
  case "$REPLY" in 0|'')op=auto;;1)op=catalina;;2)op=big_sur;;3)op=monterey;;4)op=ventura;;5)op=sonoma;;6)op=sequoia;;7)op=tahoe;;8)op=other;;*)return 3;;esac
  say 'ENVIRONMENT: 0 AUTO; 1 Recovery; 2 Full macOS; 3 Limited'
  read_reply || return 3
  case "$REPLY" in 0|'')ep=auto;;1)ep=recovery;;2)ep=full;;3)ep=limited;;*)return 3;;esac
  if ( MODEL_PROFILE=$mp; OS_PROFILE=$op; ENV_PROFILE=$ep; profile_validate ); then
    MODEL_PROFILE=$mp; OS_PROFILE=$op; ENV_PROFILE=$ep
  else say 'PROFILE_MISMATCH: RU: Выбор противоречит обнаруженной среде. EN: Selection contradicts detection.';return 3;fi
}
intel_full(){
  profile_validate && [ "$KERNEL" = Darwin ] && [ "$CPU" = intel ] &&
    [ "$ENVIRONMENT" = full ] && [ "$MODEL_PROFILE" != limited ] &&
    [ "$ENV_PROFILE" != limited ] && [ "$OS_PROFILE" != other ] && [ "$OS_KEY" != other ]
}
