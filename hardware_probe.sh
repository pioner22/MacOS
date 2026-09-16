#!/bin/bash
# Non-destructive hardware/firmware snapshot for macOS and Internet Recovery.
set +u
export LC_ALL=C
LOG='/tmp/hardware-probe.log'
: > "$LOG"
run(){ echo "===== $* =====" | tee -a "$LOG"; "$@" 2>&1 | tee -a "$LOG"; }
echo 'MODE=HARDWARE_FIRMWARE_SNAPSHOT_V1' | tee -a "$LOG"
run uname -a
command -v sw_vers >/dev/null 2>&1 && run sw_vers
command -v sysctl >/dev/null 2>&1 && {
  run sysctl hw.model
  run sysctl hw.memsize
  run sysctl hw.ncpu
  run sysctl hw.logicalcpu
}
if command -v system_profiler >/dev/null 2>&1; then
  run system_profiler SPHardwareDataType
  system_profiler SPiBridgeDataType >/dev/null 2>&1 && run system_profiler SPiBridgeDataType
  system_profiler SPDisplaysDataType >/dev/null 2>&1 && run system_profiler SPDisplaysDataType
  system_profiler SPPowerDataType >/dev/null 2>&1 && run system_profiler SPPowerDataType
fi
command -v diskutil >/dev/null 2>&1 && {
  run diskutil list
  [ -e /dev/disk0 ] && run diskutil info /dev/disk0
}
command -v pmset >/dev/null 2>&1 && run pmset -g batt
if command -v ioreg >/dev/null 2>&1; then
  echo '===== IOREG GPU / T2 / POWER HINTS =====' | tee -a "$LOG"
  ioreg -l 2>/dev/null | grep -Ei 'APPLE SSD|AMD|Radeon|AppleIntel|framebuffer|display|bridge|T2|AppleSmartBattery|panic' | head -n 400 | tee -a "$LOG"
fi
if [ -d /Volumes/RESCUE ] && [ -w /Volumes/RESCUE ]; then
  TS=$(date +%Y%m%d-%H%M%S 2>/dev/null || echo unknown)
  cp "$LOG" "/Volumes/RESCUE/HARDWARE-PROBE-$TS.log" 2>/dev/null || true
  echo "LOG_SAVED=/Volumes/RESCUE/HARDWARE-PROBE-$TS.log"
fi
echo 'FINAL=SNAPSHOT_COMPLETE'
