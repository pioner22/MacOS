#!/bin/bash
# Recovery-compatible CPU/cache execution stress.
# Non-destructive. Uses a known SHA-256 of 256 MiB of zero bytes as ground truth.
set +u
export LC_ALL=C
LOG='/tmp/cpu-test.log'
: > "$LOG"
say(){ printf '%s\n' "$*" | tee -a "$LOG"; }
fail(){ say "STOP: $*"; exit 3; }
for c in sysctl dd awk tee cat rm; do command -v "$c" >/dev/null 2>&1 || fail "missing command: $c"; done
if command -v sha256sum >/dev/null 2>&1; then HASH='sha256sum'
elif command -v shasum >/dev/null 2>&1; then HASH='shasum -a 256'
else fail 'no SHA-256 tool'; fi

EXPECTED='a6d72ac7690f53be6ae46ba88506bd97302a093f7108472bd9efc3cefda06484'
CPU=$(sysctl -n hw.logicalcpu 2>/dev/null); case "$CPU" in ''|*[!0-9]*) CPU=4;; esac
WORKERS=$CPU
# A2141 tops out at 16 logical CPUs; cap pathological environments but use the whole CPU here.
[ "$WORKERS" -gt 16 ] && WORKERS=16
[ "$WORKERS" -lt 1 ] && WORKERS=1
ROUNDS=4
say '============================================================'
say 'MODE=CPU_CACHE_STRESS_V2'
say "LOGICAL_CPU=$CPU PARALLEL_WORKERS=$WORKERS ROUNDS=$ROUNDS"
say "GROUND_TRUTH_SHA256=$EXPECTED for 256MiB zero stream"
say 'RU: Все доступные логические CPU (до 16) одновременно считают детерминированный SHA-256.'
say 'EN: All available logical CPUs (up to 16) concurrently compute a deterministic SHA-256 workload.'
say '============================================================'

FAILS=0
R=1
while [ "$R" -le "$ROUNDS" ]; do
  say "CPU_ROUND_START=$R"
  PIDS=''
  W=1
  while [ "$W" -le "$WORKERS" ]; do
    OUT="/tmp/cpu-hash-$R-$W.out"
    (
      if [ "$HASH" = sha256sum ]; then
        dd if=/dev/zero bs=1048576 count=256 2>/dev/null | sha256sum | awk '{print $1}' > "$OUT"
      else
        dd if=/dev/zero bs=1048576 count=256 2>/dev/null | shasum -a 256 | awk '{print $1}' > "$OUT"
      fi
    ) &
    PIDS="$PIDS $!"
    W=$((W+1))
  done
  for P in $PIDS; do wait "$P" || FAILS=$((FAILS+1)); done
  W=1
  while [ "$W" -le "$WORKERS" ]; do
    OUT="/tmp/cpu-hash-$R-$W.out"
    GOT=$(cat "$OUT" 2>/dev/null)
    if [ "$GOT" = "$EXPECTED" ]; then
      say "CPU_HASH_PASS round=$R worker=$W sha256=$GOT"
    else
      say "CPU_HASH_FAIL round=$R worker=$W got=$GOT expected=$EXPECTED"
      FAILS=$((FAILS+1))
    fi
    rm -f "$OUT"
    W=$((W+1))
  done
  say "CPU_ROUND_END=$R cumulative_errors=$FAILS"
  R=$((R+1))
done

if [ "$FAILS" -eq 0 ]; then
  say 'RESULT=PASS'
  say 'FINAL=PASS_CPU_HASH_STRESS'
  say 'RU: Детерминированный CPU/cache execution stress завершён без вычислительного расхождения.'
  say 'EN: Deterministic CPU/cache execution stress completed without a computation mismatch.'
  exit 0
else
  say 'RESULT=FAIL'
  say "FINAL=FAIL_CPU_OR_MEMORY_EXECUTION_PATH errors=$FAILS"
  say 'RU: Получено вычислительное расхождение или worker завершился ошибкой. При нестабильной RAM этот результат не локализует CPU.'
  say 'EN: A computation mismatch or worker failure occurred. With unstable RAM this does not isolate the CPU.'
  exit 2
fi
