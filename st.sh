#!/bin/bash
# SPDX-License-Identifier: GPL-3.0-or-later
# Validated snapshot loader. HTTPS + pinned commit + per-file digest; NOT a signature scheme.
set +u
export LC_ALL=C
umask 077
REPO=pioner22/MacOS
# This review branch is deliberate. main is not silently switched during the audit.
REF=${MACDIAG_REF:-diag-audit-20260919}
case "$REF" in ''|*[!A-Za-z0-9_./-]*|*..*) echo 'INVALID_REF'; exit 3;; esac
for c in curl mktemp awk grep wc cat mv mkdir; do command -v "$c" >/dev/null 2>&1 || exit 3; done
hash_file() {
    if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1"
    elif command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1"
    else return 3; fi
}
WORK=$(mktemp -d /tmp/macdiag-package.XXXXXXXX) || exit 3
CAFF=''
trap '[ -z "$CAFF" ] || kill "$CAFF" 2>/dev/null || :' EXIT
trap 'exit 130' INT TERM HUP
fetch() {
    curl -q -fsSL --proto '=https' --proto-redir '=https' --retry 0 \
      --connect-timeout 20 --max-time 90 "$1" -o "$2"
}
if [[ "$REF" =~ ^[0-9a-f]{40}$ ]]; then REV=$REF
else
    fetch "https://api.github.com/repos/$REPO/commits/$REF" "$WORK/commit.json" || exit 3
    REV=$(awk 'match($0,/"sha"[[:space:]]*:[[:space:]]*"[0-9a-f]+"/) {s=substr($0,RSTART,RLENGTH);sub(/^[^:]*:[[:space:]]*"/,"",s);sub(/"$/,"",s);print s;exit}' "$WORK/commit.json")
fi
[[ "$REV" =~ ^[0-9a-f]{40}$ ]] || { echo 'INVALID_COMMIT'; exit 3; }
BASE="https://raw.githubusercontent.com/$REPO/$REV"
fetch "$BASE/diagnostics/package.tsv" "$WORK/package.tsv" || exit 3
[ -s "$WORK/package.tsv" ] || exit 3
count=0
while read -r expected bytes path extra; do
    [ -z "$extra" ] && [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || exit 3
    case "$bytes" in ''|*[!0-9]*) exit 3;; esac
    [ ${#bytes} -le 7 ] && [ "$bytes" -gt 0 ] && [ "$bytes" -le 1048576 ] || exit 3
    case "$path" in ''|/*|*..*|*[!A-Za-z0-9_./-]*) exit 3;; esac
    count=$((count+1)); [ "$count" -le 80 ] || exit 3
    [ ! -e "$WORK/$path" ] || exit 3
    case "$path" in */*) mkdir -p "$WORK/${path%/*}" || exit 3;; esac
    fetch "$BASE/$path" "$WORK/payload.part" || exit 3
    size=$(wc -c < "$WORK/payload.part"); size=$((size+0))
    [ "$size" = "$bytes" ] || { echo "PACKAGE_SIZE_ERROR=$path"; exit 3; }
    hash_file "$WORK/payload.part" > "$WORK/digest" || exit 3
    read -r actual _ < "$WORK/digest"
    [ "$actual" = "$expected" ] || { echo "PACKAGE_HASH_ERROR=$path"; exit 3; }
    mv "$WORK/payload.part" "$WORK/$path" || exit 3
    case "$path" in *.sh) /bin/bash -n "$WORK/$path" || exit 3;; esac
 done < "$WORK/package.tsv"
[ "$count" -ge 5 ] && [ -s "$WORK/current.sh" ] && [ -s "$WORK/diagnostics/run.sh" ] || exit 3
mv "$WORK/package.tsv" "$WORK/diagnostics/package.tsv" || exit 3
export MACDIAG_ROOT=$WORK MACDIAG_REVISION=$REV
if command -v caffeinate >/dev/null 2>&1; then caffeinate -di -w $$ >/dev/null 2>&1 & CAFF=$!; fi
printf 'REVISION=%s\nPACKAGE_DIR=%s\n' "$REV" "$WORK"
/bin/bash "$WORK/current.sh"
rc=$?
printf 'DIAGNOSTIC_EXIT=%s (0=PASS 2=FAIL 3=INCONCLUSIVE 5=BLOCKED 6=OBSERVATION 130=CANCELLED)\n' "$rc"
# Leave this small verified package available for offline inspection; no user files are removed.
exit "$rc"
