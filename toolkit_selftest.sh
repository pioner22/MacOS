#!/bin/bash
# Self-test for the diagnostic toolkit itself. Does not test Mac hardware.
set +u
export LC_ALL=C
BASE='https://raw.githubusercontent.com/pioner22/MacOS/main'
TMPDIR_SELF="/tmp/macos-diag-selftest-$$"
mkdir -p "$TMPDIR_SELF" || exit 3
trap 'rm -rf "$TMPDIR_SELF"' EXIT INT TERM HUP
say(){ printf '%s\n' "$*"; }
CHECKS=0; LOGIC_FAILS=0; ENV_ERRORS=0

say 'MODE=TOOLKIT_SELFTEST_V3'
say 'RU: Проверяются доступность файлов, bash-синтаксис, сборка SSD-движка и контрольные константы. Сетевой fetch failure = INCONCLUSIVE, а не toolkit FAIL.'
say 'EN: Validates file access, bash syntax, SSD-engine assembly, and constants. Network fetch failure is INCONCLUSIVE, not toolkit FAIL.'

for C in curl grep dd awk date cat mkdir rm tr; do
  CHECKS=$((CHECKS+1))
  if command -v "$C" >/dev/null 2>&1; then say "SELFTEST_ENV_PASS tool=$C"; else say "SELFTEST_ENV_MISSING tool=$C"; ENV_ERRORS=$((ENV_ERRORS+1)); fi
done

SCRIPTS='st.sh current.sh ssd_test.sh ram_quick_test.sh ram_full_test.sh ram_triage.sh ram_map.sh cpu_test.sh gpu_test.sh display_video_test.sh network_test.sh download_test.sh power_thermal_test.sh hardware_probe.sh full_safe_suite.sh full_all_suite.sh publish_network_fixtures.sh toolkit_selftest.sh'
for F in $SCRIPTS; do
  O="$TMPDIR_SELF/$F"
  CHECKS=$((CHECKS+1))
  if curl -fsSL --connect-timeout 20 -H 'Cache-Control: no-cache' "$BASE/$F?t=$(date +%s 2>/dev/null || echo 0)" -o "$O"; then
    if /bin/bash -n "$O"; then say "SELFTEST_SCRIPT_PASS file=$F"; else say "SELFTEST_SCRIPT_LOGIC_FAIL file=$F reason=syntax"; LOGIC_FAILS=$((LOGIC_FAILS+1)); fi
  else
    say "SELFTEST_SCRIPT_INCONCLUSIVE file=$F reason=fetch"; ENV_ERRORS=$((ENV_ERRORS+1))
  fi
done

for F in metal_vram_test.m tools/generate_network_fixtures.py network-fixtures.sha256 network-fixtures.tsv; do
  O="$TMPDIR_SELF/aux-$(printf '%s' "$F" | tr '/' '_')"
  CHECKS=$((CHECKS+1))
  if curl -fsSL --connect-timeout 20 "$BASE/$F?t=$(date +%s 2>/dev/null || echo 0)" -o "$O" && [ -s "$O" ]; then
    say "SELFTEST_AUX_PASS file=$F"
  else
    say "SELFTEST_AUX_INCONCLUSIVE file=$F reason=fetch_or_empty"; ENV_ERRORS=$((ENV_ERRORS+1))
  fi
done

# Assemble the exact pure-storage engine but never execute it.
SSD="$TMPDIR_SELF/ssd-assembled.sh"; : > "$SSD"; SSD_FETCH_BAD=0
for F in mhdd_v2.part01 mhdd_v2.part02 mhdd_v2.part03 mhdd_v2.part04 mhdd_v2.part05_storage mhdd_v2.part06_storage; do
  O="$TMPDIR_SELF/$F"; CHECKS=$((CHECKS+1))
  if curl -fsSL --connect-timeout 20 -H 'Cache-Control: no-cache' "$BASE/$F?t=$(date +%s 2>/dev/null || echo 0)" -o "$O"; then
    cat "$O" >> "$SSD"
  else
    say "SELFTEST_SSD_PART_INCONCLUSIVE file=$F reason=fetch"; ENV_ERRORS=$((ENV_ERRORS+1)); SSD_FETCH_BAD=1
  fi
done
CHECKS=$((CHECKS+1))
if [ "$SSD_FETCH_BAD" -eq 0 ]; then
  if /bin/bash -n "$SSD"; then say 'SELFTEST_SSD_ASSEMBLY=PASS'; else say 'SELFTEST_SSD_ASSEMBLY=LOGIC_FAIL'; LOGIC_FAILS=$((LOGIC_FAILS+1)); fi
else
  say 'SELFTEST_SSD_ASSEMBLY=INCONCLUSIVE missing_parts'
fi

# Verify exact fixture hashes hard-coded by download_test.sh.
MAN="$TMPDIR_SELF/network-fixtures.sha256"
if curl -fsSL --connect-timeout 20 "$BASE/network-fixtures.sha256" -o "$MAN"; then
  for ROW in \
    '85c3ea1f26f1a18ba9c7b1adb12ca91a157ad1330c5d1fe3d542cfee13b4e7a8  nettest-001MiB.bin' \
    '9bedc7cb90624f439e2baffd0ce25d69682da41aa2b521e26c879059cfc85949  nettest-008MiB.bin' \
    '5aa0f6b39ed47a7a648b17d92daa61bc7ec25a1c46ecabd2f2c757f820cd7a38  nettest-032MiB.bin' \
    'a18494ea78d4e7a610cc165ff66b4d7caf8db32aebb6b7b289e89d9207409e7c  nettest-128MiB.bin' \
    '924d46bc2b284f264d08ac11ed2385723c1b094df2ea8652583b807711083110  nettest-512MiB.bin'; do
      CHECKS=$((CHECKS+1))
      if grep -Fqx "$ROW" "$MAN"; then say "SELFTEST_FIXTURE_MANIFEST_PASS row=$ROW"; else say "SELFTEST_FIXTURE_MANIFEST_LOGIC_FAIL row=$ROW"; LOGIC_FAILS=$((LOGIC_FAILS+1)); fi
  done
else
  say 'SELFTEST_FIXTURE_MANIFEST=INCONCLUSIVE reason=fetch'; ENV_ERRORS=$((ENV_ERRORS+1)); CHECKS=$((CHECKS+1))
fi

# Verify the Range-test hash versioned in the TSV manifest.
TSV="$TMPDIR_SELF/network-fixtures.tsv"
CHECKS=$((CHECKS+1))
if curl -fsSL --connect-timeout 20 "$BASE/network-fixtures.tsv" -o "$TSV"; then
  if awk -F '\t' '$1=="range512_offset256_len16" && $2=="16777216" && $3=="6b2bd172178b6e8a4d992581273e7962efe0ec8066e6204537fe27a34b7d940c" {ok=1} END{exit ok?0:1}' "$TSV"; then
    say 'SELFTEST_RANGE_MANIFEST=PASS'
  else
    say 'SELFTEST_RANGE_MANIFEST=LOGIC_FAIL'; LOGIC_FAILS=$((LOGIC_FAILS+1))
  fi
else
  say 'SELFTEST_RANGE_MANIFEST=INCONCLUSIVE reason=fetch'; ENV_ERRORS=$((ENV_ERRORS+1))
fi

# Independent local SHA-256 path sanity check.
EXPECTED_ZERO_1M='30e14955ebf1352266dc2ff8067e68104607e750abb9d3b36582b8af909fcb58'
GOT=''; HASH_AVAILABLE=1
if command -v sha256sum >/dev/null 2>&1; then GOT=$(dd if=/dev/zero bs=1048576 count=1 2>/dev/null | sha256sum | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then GOT=$(dd if=/dev/zero bs=1048576 count=1 2>/dev/null | shasum -a 256 | awk '{print $1}')
else HASH_AVAILABLE=0; fi
CHECKS=$((CHECKS+1))
if [ "$HASH_AVAILABLE" -eq 0 ]; then
  say 'SELFTEST_SHA256_PATH=INCONCLUSIVE no_sha_tool'; ENV_ERRORS=$((ENV_ERRORS+1))
elif [ "$GOT" = "$EXPECTED_ZERO_1M" ]; then
  say 'SELFTEST_SHA256_PATH=PASS'
else
  say "SELFTEST_SHA256_PATH=LOGIC_OR_EXECUTION_FAIL got=$GOT expected=$EXPECTED_ZERO_1M"; LOGIC_FAILS=$((LOGIC_FAILS+1))
fi

say "SELFTEST_SUMMARY checks=$CHECKS logic_failures=$LOGIC_FAILS environment_or_fetch_errors=$ENV_ERRORS"
if [ "$LOGIC_FAILS" -gt 0 ]; then
  say 'RESULT=FAIL_TOOLKIT'
  say 'RU: Найдено внутреннее несоответствие диагностического комплекта. Аппаратные тесты до исправления не считать надёжными.'
  say 'EN: An internal toolkit inconsistency was found. Do not trust hardware-test results until it is fixed.'
  exit 2
fi
if [ "$ENV_ERRORS" -gt 0 ]; then
  say 'RESULT=INCONCLUSIVE'
  say 'RU: Внутренних противоречий не найдено, но сеть/среда не позволила проверить все файлы. Это НЕ toolkit FAIL и НЕ hardware FAIL.'
  say 'EN: No internal inconsistency was found, but network/environment prevented complete validation. This is neither toolkit FAIL nor hardware FAIL.'
  exit 3
fi
say 'RESULT=PASS'
say 'RU: Сам диагностический комплект прошёл внутреннюю проверку. Это НЕ означает, что железо Mac исправно.'
say 'EN: The diagnostic toolkit passed its internal self-test. This does NOT mean the Mac hardware is healthy.'
exit 0
