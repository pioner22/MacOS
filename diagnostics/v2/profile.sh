#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# A manual profile may restrict policy, never override observed facts.
p_os(){
  case "$1" in 10.15|10.15.*) echo catalina;;11|11.*) echo big_sur;;12|12.*) echo monterey;;13|13.*) echo ventura;;14|14.*) echo sonoma;;15|15.*) echo sequoia;;26|26.*) echo tahoe;;*) echo other;;esac
}
p_detect(){
  P_MODEL=unknown; P_CPU=unknown; P_OS=unknown; P_BUILD=unknown; P_ENV=unknown; P_RAM=0
  P_KERNEL=$(uname -s); P_ARCH=$(uname -m); P_TRANSLATED=0
  [ "$P_KERNEL" = Darwin ] || return 0
  P_MODEL=$(sysctl -n hw.model 2>/dev/null); P_RAM=$(sysctl -n hw.memsize 2>/dev/null)
  case "$P_RAM" in ''|*[!0-9]*) P_RAM=0;;esac
  P_TRANSLATED=$(sysctl -n sysctl.proc_translated 2>/dev/null)
  local arm vendor root
  arm=$(sysctl -n hw.optional.arm64 2>/dev/null); vendor=$(sysctl -n machdep.cpu.vendor 2>/dev/null)
  if [ "$P_ARCH" = arm64 ] || [ "$arm" = 1 ] || [ "$P_TRANSLATED" = 1 ]; then P_CPU=apple_silicon
  elif [ "$P_ARCH" = x86_64 ] && [ "$vendor" = GenuineIntel ]; then P_CPU=intel;fi
  P_OS=$(sw_vers -productVersion); P_BUILD=$(sw_vers -buildVersion)
  root=$(LC_ALL=C diskutil info / 2>/dev/null)
  if [ -e /System/Installation/CDIS ]; then
    case "$root" in *'Base System'*) P_ENV=recovery;;esac
  elif [ -d /System/Library/CoreServices/Finder.app ] && [ -e /var/db/.AppleSetupDone ];then P_ENV=full;fi
}
p_apply(){
  local model=${1:-auto} os=${2:-auto} env=${3:-auto}
  P_VALID=no
  case "$model" in auto|a2141|intel|limited) :;;*) return 3;;esac
  case "$os" in auto|catalina|big_sur|monterey|ventura|sonoma|sequoia|tahoe|other) :;;*) return 3;;esac
  case "$env" in auto|full|recovery|limited) :;;*) return 3;;esac
  if [ "$model" = a2141 ];then
    [ "$P_CPU" = intel ] || return 3
    case "$P_MODEL" in MacBookPro16,1|MacBookPro16,4) :;;*) return 3;;esac
  elif [ "$model" = intel ];then [ "$P_CPU" = intel ] || return 3;fi
  [ "$os" = auto ] || [ "$os" = other ] || [ "$os" = "$(p_os "$P_OS")" ] || return 3
  [ "$env" = auto ] || [ "$env" = limited ] || [ "$env" = "$P_ENV" ] || return 3
  P_REQUEST_MODEL=$model; P_REQUEST_OS=$os; P_REQUEST_ENV=$env; P_VALID=yes
  export P_REQUEST_MODEL P_REQUEST_OS P_REQUEST_ENV
}
p_show(){
  printf '\nMODEL=%s CPU=%s ARCH=%s RAM_BYTES=%s\n' "$P_MODEL" "$P_CPU" "$P_ARCH" "$P_RAM"
  printf 'RUNNING_OS=%s BUILD=%s ENV=%s PROFILE_VALID=%s\n' "$P_OS" "$P_BUILD" "$P_ENV" "$P_VALID"
  printf 'RU: Версия загруженной среды, не устанавливаемой ОС. RAW-запись отключена.\n'
  printf 'EN: Running environment, not installation target. RAW writes are disabled.\n'
}
p_allow(){
  [ "$P_VALID" = yes ] || return 3
  case "$1" in selftest) return 0;;esac
  [ "$P_KERNEL" = Darwin ] || return 3
  case "$1" in hardware|power|network|download|display|checklist) return 0;;esac
  [ "$P_CPU" = intel ] && [ "$P_REQUEST_MODEL" != limited ] && [ "$P_REQUEST_ENV" != limited ] && [ "$P_REQUEST_OS" != other ] || return 3
  case "$1" in ram-quick) return 0;;esac
  [ "$P_ENV" = full ] && [ "$(p_os "$P_OS")" != other ] || return 3
  case "$1" in ram-full|ram-map|cpu|gpu|storage|safe|acceptance) return 0;;*) return 3;;esac
}
p_choose(){
  local model os env reply
  printf 'RU/EN: Модель / Model: 0 AUTO; 1 A2141; 2 Intel; 3 Limited\n> '
  IFS= read -r reply </dev/tty || return 3
  case "$reply" in ''|0) model=auto;;1) model=a2141;;2) model=intel;;3) model=limited;;*) return 3;;esac
  printf 'RU/EN: Загруженная ОС / Running OS: 0 AUTO; 1 Catalina; 2 Big Sur; 3 Monterey; 4 Ventura; 5 Sonoma; 6 Sequoia; 7 Tahoe; 8 Other\n> '
  IFS= read -r reply </dev/tty || return 3
  case "$reply" in ''|0) os=auto;;1) os=catalina;;2) os=big_sur;;3) os=monterey;;4) os=ventura;;5) os=sonoma;;6) os=sequoia;;7) os=tahoe;;8) os=other;;*) return 3;;esac
  printf 'RU/EN: Среда / Environment: 0 AUTO; 1 Recovery; 2 Full macOS; 3 Limited\n> '
  IFS= read -r reply </dev/tty || return 3
  case "$reply" in ''|0) env=auto;;1) env=recovery;;2) env=full;;3) env=limited;;*) return 3;;esac
  p_apply "$model" "$os" "$env"
}
