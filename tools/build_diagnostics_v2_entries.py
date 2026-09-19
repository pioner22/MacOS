#!/usr/bin/env python3
"""Regenerate compatibility entries pinned to the verified v2 bootstrap."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
REF = '64f8c220bbf6d88a0c0dd1d000127d96e31d494b'
SHA = '087654eae1cb42e5fb7deb12ddce8102902f0b0f175fb123845fd6d29e3e9f92'
MODES = {
    'current.sh': 'menu', 'ram_quick_test.sh': 'ramquick',
    'ram_full_test.sh': 'ramfull', 'ram_test.sh': 'ramfull',
    'ram_triage.sh': 'ramfull', 'ram_map.sh': 'rammap',
    'cpu_test.sh': 'cpu', 'gpu_test.sh': 'gpu',
    'display_video_test.sh': 'display', 'network_test.sh': 'network',
    'download_test.sh': 'download', 'power_thermal_test.sh': 'power',
    'hardware_probe.sh': 'snapshot', 'full_safe_suite.sh': 'safe',
    'toolkit_selftest.sh': 'selftest', 'post_repair_test.sh': 'acceptance',
    'storage_file_test.sh': 'storage', 'ram_bridge_test.sh': 'bridge',
}
TEMPLATE = '''#!/bin/bash
# Compatibility entry; never execute a partial/unverified download.
diag_entry(){
  local tmp got
  umask 077
  tmp=$(mktemp /tmp/macdiag-entry.XXXXXX) || return 3
  MACDIAG_ENTRY_TMP=$tmp
  trap 'rm -f "$MACDIAG_ENTRY_TMP"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM HUP
  curl -q -fsSL --retry 0 --proto '=https' --proto-redir '=https' --max-redirs 5 --connect-timeout 15 --max-time 120 --max-filesize 1048576 \\
    'https://raw.githubusercontent.com/pioner22/MacOS/REF/st.sh' -o "$tmp" || return 3
  if command -v sha256sum >/dev/null 2>&1;then got=$(sha256sum "$tmp") || return 3
  elif command -v shasum >/dev/null 2>&1;then got=$(shasum -a 256 "$tmp") || return 3
  else return 3;fi
  [ "${got%% *}" = SHA ] || { echo 'RESULT=INCONCLUSIVE BOOTSTRAP_HASH_FAILED';return 3; }
  /bin/bash -n "$tmp" || return 3
  /bin/bash "$tmp" "$1"
}
diag_entry MODE
exit $?
'''
RAW = '''#!/bin/bash
# Legacy raw engine is NOT an acceptance test. Kept disabled pending a separate audit.
echo 'RESULT=BLOCKED'
echo 'REASON=LEGACY_RAW_QUARANTINED'
echo 'RU: Разрушительный SSD-тест отключён до отдельного аудита. Используйте пункт 16 или 17 в st.sh.'
echo 'EN: Destructive SSD testing is quarantined. Use option 16 or 17 in st.sh instead.'
exit 7
'''
if __name__ == '__main__':
    for path, mode in MODES.items():
        (ROOT/path).write_text(TEMPLATE.replace('REF', REF).replace('SHA', SHA).replace('MODE', mode), encoding='utf-8')
    for path in ('ssd_test.sh','full_all_suite.sh'):
        (ROOT/path).write_text(RAW, encoding='utf-8')
