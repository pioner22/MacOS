#!/bin/bash
# GPU/VRAM diagnostic. Probe works in Recovery; real Metal VRAM verification requires full macOS + clang/CLT.
set +u
export LC_ALL=C
BASE='https://raw.githubusercontent.com/pioner22/MacOS/main'
LOG='/tmp/gpu-test.log'
SRC='/tmp/metal_vram_test.m'
BIN='/tmp/metal_vram_test'
: > "$LOG"
say(){ printf '%s\n' "$*" | tee -a "$LOG"; }

say '============================================================'
say 'MODE=GPU_VRAM_DIAGNOSTIC_V1'
say 'Stage 1: enumerate GPU/display path. Stage 2: Metal private-VRAM write/compute/readback when compiler is available.'
say '============================================================'

if command -v system_profiler >/dev/null 2>&1; then
  say 'SYSTEM_PROFILER_DISPLAYS_BEGIN'
  system_profiler SPDisplaysDataType 2>&1 | tee -a "$LOG"
  say 'SYSTEM_PROFILER_DISPLAYS_END'
fi
if command -v ioreg >/dev/null 2>&1; then
  say 'IOREG_GPU_BEGIN'
  ioreg -l 2>/dev/null | grep -Ei 'AMD|Radeon|Intel.*Graphics|AppleIntel|display|framebuffer|VRAM|Metal' | head -n 250 | tee -a "$LOG"
  say 'IOREG_GPU_END'
fi

CLANG=''
if command -v xcrun >/dev/null 2>&1; then CLANG=$(xcrun -f clang 2>/dev/null); fi
[ -z "$CLANG" ] && command -v clang >/dev/null 2>&1 && CLANG=$(command -v clang)

if [ -z "$CLANG" ] || [ ! -d /System/Library/Frameworks/Metal.framework ]; then
  say 'GPU_VRAM_TEST=INCONCLUSIVE_FULL_TEST_REQUIRES_FULL_MACOS_AND_CLANG'
  say 'Recovery can enumerate devices but cannot perform the native Metal VRAM verifier here.'
  exit 3
fi

curl -fL --retry 2 --connect-timeout 20 -H 'Cache-Control: no-cache' "$BASE/metal_vram_test.m?t=$(date +%s 2>/dev/null || echo 0)" -o "$SRC" || {
  say 'STOP: cannot fetch metal_vram_test.m'; exit 1;
}
"$CLANG" -fobjc-arc -framework Foundation -framework Metal "$SRC" -o "$BIN" 2>&1 | tee -a "$LOG"
[ -x "$BIN" ] || { say 'GPU_VRAM_TEST=INCONCLUSIVE_COMPILE_FAILED'; exit 3; }

MIB=${VRAM_TEST_MIB:-2048}
say "METAL_VRAM_TEST_START requested_mib=$MIB"
"$BIN" "$MIB" 2>&1 | tee -a "$LOG"
RC=${PIPESTATUS[0]:-99}
case "$RC" in
  0) say 'FINAL=PASS_GPU_VRAM_METAL_READBACK'; exit 0;;
  2|5) say "FINAL=FAIL_GPU_VRAM_OR_GPU_EXECUTION_PATH rc=$RC"; exit 2;;
  4) say 'FINAL=INCONCLUSIVE_VRAM_ALLOCATION_LIMIT'; exit 3;;
  *) say "FINAL=INCONCLUSIVE_GPU_TEST rc=$RC"; exit 3;;
esac
