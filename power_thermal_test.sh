#!/bin/bash
# Non-destructive power/thermal observation test.
set +u
export LC_ALL=C
LOG='/tmp/power-thermal.log'
: > "$LOG"
say(){ printf '%s\n' "$*" | tee -a "$LOG"; }
say '============================================================'
say 'MODE=POWER_THERMAL_DIAGNOSTIC_V1'
say '============================================================'
command -v pmset >/dev/null 2>&1 && { say 'PMSET_BATTERY'; pmset -g batt 2>&1 | tee -a "$LOG"; say 'PMSET_SETTINGS'; pmset -g 2>&1 | tee -a "$LOG"; }
if command -v system_profiler >/dev/null 2>&1; then
  say 'POWER_PROFILE'; system_profiler SPPowerDataType 2>&1 | tee -a "$LOG"
fi
if command -v ioreg >/dev/null 2>&1; then
  say 'SMART_BATTERY_IOREG'; ioreg -r -c AppleSmartBattery -l 2>&1 | head -n 300 | tee -a "$LOG"
fi
if command -v powermetrics >/dev/null 2>&1; then
  say 'POWERMETRICS_START samples=5 interval_ms=1000'
  powermetrics -n 5 -i 1000 2>&1 | tee -a "$LOG"
  PRC=${PIPESTATUS[0]:-99}
  say "POWERMETRICS_EXIT=$PRC"
else
  say 'POWERMETRICS=UNAVAILABLE_IN_THIS_ENVIRONMENT'
fi
if [ -d /Volumes/RESCUE ] && [ -w /Volumes/RESCUE ]; then
  TS=$(date +%Y%m%d-%H%M%S 2>/dev/null || echo unknown)
  cp "$LOG" "/Volumes/RESCUE/POWER-THERMAL-$TS.log" 2>/dev/null || true
  say "LOG_SAVED=/Volumes/RESCUE/POWER-THERMAL-$TS.log"
fi
say 'FINAL=POWER_THERMAL_OBSERVATION_COMPLETE'
