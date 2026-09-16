#!/bin/bash
# Interactive diagnostic menu for macOS Internet Recovery / full macOS.
# Permanent entry: curl -L https://raw.githubusercontent.com/pioner22/MacOS/main/st.sh|bash
set +u
BASE='https://raw.githubusercontent.com/pioner22/MacOS/main'
TMP="/tmp/diag-menu-run-$$.sh"
rm -f "$TMP"

printf '\n'
printf '================================================================\n'
printf ' MacBook Hardware Diagnostic Menu\n'
printf '================================================================\n'
printf ' 1) SSD/HDD TEST      - full-LBA MHDD-like storage diagnostic\n'
printf '                        WARNING: destructive writes may occur\n'
printf '\n'
printf ' 2) RAM TEST          - maximum RAM torture / corruption test\n'
printf '                        optional 40GiB RAM -> RESCUE round-trip\n'
printf '\n'
printf ' 3) RAM MAP           - map RAM byte/bit errors, do not stop early\n'
printf '\n'
printf ' 4) CPU/CACHE TEST    - parallel deterministic CPU/hash stress\n'
printf '\n'
printf ' 5) GPU/VRAM TEST     - GPU probe in Recovery; real Metal VRAM\n'
printf '                        verifier on full macOS + clang/CLT\n'
printf '\n'
printf ' 6) NETWORK TEST      - Apple CDN + GitHub TLS/integrity stress\n'
printf '\n'
printf ' 7) POWER/THERMAL     - battery, power and thermal observations\n'
printf '\n'
printf ' 8) HARDWARE SNAPSHOT - CPU/RAM/T2/GPU/storage/power inventory\n'
printf '\n'
printf ' 9) SAFE FULL SUITE   - 4+5+6+7+8, no destructive SSD writes\n'
printf '\n'
printf ' 0) EXIT\n'
printf '================================================================\n'
printf 'Select [0-9]: '

CHOICE=''
if [ -r /dev/tty ]; then IFS= read CHOICE </dev/tty; else IFS= read CHOICE; fi

case "$CHOICE" in
  1|ssd|SSD|hdd|HDD) SCRIPT='ssd_test.sh'; LABEL='SSD/HDD TEST';;
  2|ram|RAM) SCRIPT='ram_test.sh'; LABEL='RAM TEST';;
  3|map|MAP) SCRIPT='ram_map.sh'; LABEL='RAM MAP';;
  4|cpu|CPU) SCRIPT='cpu_test.sh'; LABEL='CPU/CACHE TEST';;
  5|gpu|GPU|vram|VRAM) SCRIPT='gpu_test.sh'; LABEL='GPU/VRAM TEST';;
  6|net|NET|network|NETWORK) SCRIPT='network_test.sh'; LABEL='NETWORK TEST';;
  7|power|POWER|thermal|THERMAL) SCRIPT='power_thermal_test.sh'; LABEL='POWER/THERMAL';;
  8|hw|HW|hardware|HARDWARE) SCRIPT='hardware_probe.sh'; LABEL='HARDWARE SNAPSHOT';;
  9|suite|SUITE|full|FULL) SCRIPT='full_safe_suite.sh'; LABEL='SAFE FULL SUITE';;
  0|q|Q|quit|exit|'') echo 'EXIT=USER_REQUEST'; exit 0;;
  *) echo "STOP: unknown selection: $CHOICE" >&2; exit 1;;
esac

echo "SELECTED=$LABEL"
URL="$BASE/$SCRIPT?t=$(date +%s 2>/dev/null || echo 0)"
curl -fL --retry 2 --connect-timeout 20 -H 'Cache-Control: no-cache' "$URL" -o "$TMP" || {
  echo "STOP: failed to fetch $SCRIPT" >&2; rm -f "$TMP"; exit 1;
}
/bin/bash -n "$TMP" || {
  echo "STOP: $SCRIPT failed syntax validation" >&2; rm -f "$TMP"; exit 1;
}
/bin/bash "$TMP"
RC=$?
rm -f "$TMP"
exit "$RC"
