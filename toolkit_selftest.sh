#!/bin/bash
# Self-test for the diagnostic toolkit itself. Does not test Mac hardware.
set +u
export LC_ALL=C
BASE='https://raw.githubusercontent.com/pioner22/MacOS/main'
TMPDIR_SELF="/tmp/macos-diag-selftest-$$"
mkdir -p "$TMPDIR_SELF" || exit 3
trap 'rm -rf "$TMPDIR_SELF"' EXIT INT TERM HUP
say(){ printf '%s\n' "$*"; }
FAILS=0; CHECKS=0
check(){ CHECKS=$((CHECKS+1)); "$@" || FAILS=$((FAILS+1)); }

say 'MODE=TOOLKIT_SELFTEST_V1'
say 'RU: Проверяется логика комплекта: доступность файлов, bash-синтаксис, сборка SSD-движка и контрольные константы.'
say 'EN: Validates toolkit wiring: file availability, bash syntax, SSD-engine assembly, and known constants.'

SCRIPTS='st.sh current.sh ssd_test.sh ram_quick_test.sh ram_full_test.sh ram_triage.sh ram_map.sh cpu_test.sh gpu_test.sh display_video_test.sh network_test.sh download_test.sh power_thermal_test.sh hardware_probe.sh full_safe_suite.sh full_all_suite.sh publish_network_fixtures.sh'
for F in $SCRIPTS; do
  O="$TMPDIR_SELF/$F"
  if curl -fsSL --connect-timeout 20 -H 'Cache-Control: no-cache' "$BASE/$F?t=$(date +%s 2>/dev/null || echo 0)" -o "$O"; then
    if /bin/bash -n "$O"; then say "SELFTEST_SCRIPT_PASS file=$F"; else say "SELFTEST_SCRIPT_FAIL file=$F reason=syntax"; FAILS=$((FAILS+1)); fi
  else
    say "SELFTEST_SCRIPT_FAIL file=$F reason=fetch"; FAILS=$((FAILS+1))
  fi
  CHECKS=$((CHECKS+1))
done

# Assemble exactly the same pure-storage engine used by ssd_test.sh, but never execute it.
SSD="$TMPDIR_SELF/ssd-assembled.sh"; : > "$SSD"
for F in mhdd_v2.part01 mhdd_v2.part02 mhdd_v2.part03 mhdd_v2.part04 mhdd_v2.part05_storage mhdd_v2.part06; do
  O="$TMPDIR_SELF/$F"
  if curl -fsSL --connect-timeout 20 -H 'Cache-Control: no-cache' "$BASE/$F?t=$(date +%s 2>/dev/null || echo 0)" -o "$O"; then
    cat "$O" >> "$SSD"
  else
    say "SELFTEST_SSD_PART_FAIL file=$F"; FAILS=$((FAILS+1))
  fi
  CHECKS=$((CHECKS+1))
done
if /bin/bash -n "$SSD"; then say 'SELFTEST_SSD_ASSEMBLY=PASS'; else say 'SELFTEST_SSD_ASSEMBLY=FAIL'; FAILS=$((FAILS+1)); fi
CHECKS=$((CHECKS+1))

# Verify versioned fixture manifest contains the exact hashes expected by download_test.sh.
MAN="$TMPDIR_SELF/network-fixtures.sha256"
if curl -fsSL --connect-timeout 20 "$BASE/network-fixtures.sha256" -o "$MAN"; then
  for ROW in \
    '85c3ea1f26f1a18ba9c7b1adb12ca91a157ad1330c5d1fe3d542cfee13b4e7a8  nettest-001MiB.bin' \
    '9bedc7cb90624f439e2baffd0ce25d69682da41aa2b521e26c879059cfc85949  nettest-008MiB.bin' \
    '5aa0f6b39ed47a7a648b17d92daa61bc7ec25a1c46ecabd2f2c757f820cd7a38  nettest-032MiB.bin' \
    'a18494ea78d4e7a610cc165ff66b4d7caf8db32aebb6b7b289e89d9207409e7c  nettest-128MiB.bin' \
    '924d46bc2b284f264d08ac11ed2385723c1b094df2ea8652583b807711083110  nettest-512MiB.bin'; do
      CHECKS=$((CHECKS+1)); grep -Fqx "$ROW" "$MAN" && say "SELFTEST_FIXTURE_MANIFEST_PASS file=${ROW##*  }" || { say "SELFTEST_FIXTURE_MANIFEST_FAIL row=$ROW"; FAILS=$((FAILS+1)); }
  done
else
  say 'SELFTEST_FIXTURE_MANIFEST_FAIL reason=fetch'; FAILS=$((FAILS+1)); CHECKS=$((CHECKS+1))
fi

# Independent local sanity check for the hashing path: SHA-256(1 MiB zeroes).
EXPECTED_ZERO_1M='30e14955ebf1352266dc2ff8067e68104607e750abb9d3b36582b8af909fcb58'
GOT=''
if command -v sha256sum >/dev/null 2>&1; then GOT=$(dd if=/dev/zero bs=1048576 count=1 2>/dev/null | sha256sum | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then GOT=$(dd if=/dev/zero bs=1048576 count=1 2>/dev/null | shasum -a 256 | awk '{print $1}')
fi
CHECKS=$((CHECKS+1))
if [ "$GOT" = "$EXPECTED_ZERO_1M" ]; then say 'SELFTEST_SHA256_PATH=PASS'; else say "SELFTEST_SHA256_PATH=FAIL got=$GOT expected=$EXPECTED_ZERO_1M"; FAILS=$((FAILS+1)); fi

say "SELFTEST_SUMMARY checks=$CHECKS failures=$FAILS"
if [ "$FAILS" -eq 0 ]; then
  say 'RESULT=PASS'
  say 'RU: Сам диагностический комплект прошёл внутреннюю проверку. Это НЕ означает, что железо Mac исправно.'
  say 'EN: The diagnostic toolkit passed its internal self-test. This does NOT mean the Mac hardware is healthy.'
  exit 0
fi
say 'RESULT=FAIL_TOOLKIT'
say 'RU: Найдена ошибка в файлах/связях самого диагностического комплекта. Аппаратные тесты до исправления не считать надёжными.'
say 'EN: The toolkit itself has a file/wiring failure. Do not trust hardware-test results until it is fixed.'
exit 2
