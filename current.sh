#!/bin/bash
# Interactive diagnostic menu for macOS Internet Recovery.
# Permanent entry remains: curl -L https://raw.githubusercontent.com/pioner22/MacOS/main/st.sh|bash
set +u
BASE='https://raw.githubusercontent.com/pioner22/MacOS/main'
TMP="/tmp/diag-menu-run-$$.sh"
rm -f "$TMP"

printf '\n'
printf '============================================================\n'
printf ' MacBook Diagnostic Menu\n'
printf '============================================================\n'
printf ' 1) SSD/HDD TEST  - MHDD-like full-LBA storage diagnostic\n'
printf '                    NOTE: destructive writes may occur\n'
printf '                    depending on saved diagnostic stage.\n'
printf '\n'
printf ' 2) RAM TEST      - maximum RAM torture / corruption test\n'
printf '                    Internal SSD is not intentionally written.\n'
printf '                    Optional 40GiB RAM->RESCUE bridge may run.\n'
printf '\n'
printf ' 0) EXIT\n'
printf '============================================================\n'
printf 'Select [1/2/0]: '

CHOICE=''
if [ -r /dev/tty ]; then
  IFS= read CHOICE </dev/tty
else
  IFS= read CHOICE
fi

case "$CHOICE" in
  1|ssd|SSD|hdd|HDD)
    SCRIPT='ssd_test.sh'
    LABEL='SSD/HDD TEST'
    ;;
  2|ram|RAM)
    SCRIPT='ram_test.sh'
    LABEL='RAM TEST'
    ;;
  0|q|Q|quit|exit|'')
    echo 'EXIT=USER_REQUEST'
    exit 0
    ;;
  *)
    echo "STOP: unknown selection: $CHOICE" >&2
    exit 1
    ;;
esac

echo "SELECTED=$LABEL"
URL="$BASE/$SCRIPT?t=$(date +%s 2>/dev/null || echo 0)"
curl -fL --retry 2 --connect-timeout 20 -H 'Cache-Control: no-cache' "$URL" -o "$TMP" || {
  echo "STOP: failed to fetch $SCRIPT" >&2
  rm -f "$TMP"
  exit 1
}
/bin/bash -n "$TMP" || {
  echo "STOP: $SCRIPT failed syntax validation" >&2
  rm -f "$TMP"
  exit 1
}
/bin/bash "$TMP"
RC=$?
rm -f "$TMP"
exit "$RC"
