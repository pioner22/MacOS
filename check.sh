#!/bin/bash
# Recovery copy audit v1.0.0 -- Bash 3.2 / macOS BSD tools.
# AUDIT ONLY: no copying, removal, repair, mount changes, or network requests.
# Reports are written only into a new directory on the external destination.
# Size + mtime are NOT a content-integrity check. ACLs, xattrs, resource forks,
# sparse layout and hard-link relationships are not compared.

DATA_ROOT=/Volumes/RescueData
SAVE_ROOT=/Volumes/RESCUE
WORK=
CAFFEINE_PID=

say() { printf '%s\n' "$*"; }
stop() { printf 'STOP: %s\n' "$*" >&2; exit 1; }
field() {
  printf '%s\n' "$1" | awk -v key="$2" '
    { sub(/^[ \t]+/, ""); if (index($0,key ":")==1) {
        sub(/^[^:]*:[ \t]*/, ""); print; exit
    }}'
}
check_mounts() {
  local a b sa sb
  [ -d "$DATA_ROOT" ] && [ ! -L "$DATA_ROOT" ] || stop 'Source mount missing.'
  [ -d "$SAVE_ROOT" ] && [ ! -L "$SAVE_ROOT" ] || stop 'External mount missing.'
  a=$(diskutil info "$DATA_ROOT") || stop 'Cannot inspect source mount.'
  b=$(diskutil info "$SAVE_ROOT") || stop 'Cannot inspect external mount.'
  [ "$(field "$a" 'Mount Point')" = "$DATA_ROOT" ] || stop 'Wrong source mount point.'
  [ "$(field "$b" 'Mount Point')" = "$SAVE_ROOT" ] || stop 'Wrong external mount point.'
  case "$(field "$a" 'Volume Read-Only')" in Yes*) ;; *) stop 'Source is not read-only.' ;; esac
  [ "$(field "$b" 'Volume Read-Only')" = No ] || stop 'External volume is not writable.'
  [ "$(field "$a" 'Device Location')" = Internal ] || stop 'Source is not internal.'
  [ "$(field "$b" 'Device Location')" = External ] || stop 'Destination is not external.'
  [ "$(field "$b" 'Volume Name')" = RESCUE ] || stop 'External volume is not RESCUE.'
  sa=$(stat -f '%d' "$DATA_ROOT") || stop 'Cannot stat source.'
  sb=$(stat -f '%d' "$SAVE_ROOT") || stop 'Cannot stat external volume.'
  [ "$sa" != "$sb" ] || stop 'Source and destination are on the same filesystem.'
}
cleanup() {
  local status=$?
  [ -z "$CAFFEINE_PID" ] || kill "$CAFFEINE_PID" 2>/dev/null || :
  if [ -n "$WORK" ]; then
    if [ "$status" -ne 0 ]; then
      say 'CHECK INCOMPLETE. Existing copied files were not changed.'
      [ ! -f "$WORK/errors.log" ] || tail -n 8 "$WORK/errors.log"
    fi
    printf 'REPORT=%s\n' "$WORK"
  fi
}
# Menus use numbers and shell arrays, not parsed ls output.
choose_dir() {
  local title=$1 root=$2 kind=$3 p name n=0 answer index
  local options=()
  say ""; say "$title"
  for p in "$root"/*; do
    [ -d "$p" ] && [ ! -L "$p" ] || continue
    name=${p##*/}
    case "$kind:$name" in
      user:Shared|user:Guest|dest:check.*|dest:.rescue-check.*|dest:.Trashes|dest:.Spotlight-V100|dest:.fseventsd) continue ;;
    esac
    options[$n]=$p
    n=$((n+1))
    printf '  %d) %q\n' "$n" "$name"
  done
  if [ "$kind" = dest ]; then
    say '  0) Compare with a new <source-name>-rescue folder (not created now)'
  elif [ "$n" -eq 0 ]; then
    stop 'No directories found for this menu.'
  fi
  while :; do
    printf 'Number (q = stop): '
    IFS= read -r answer || stop 'Input closed.'
    [ "$answer" != q ] || exit 0
    case "$answer" in ''|*[!0-9]*) say 'Enter a number.'; continue ;; esac
    [ "${#answer}" -le 6 ] || continue
    index=$((10#$answer))
    if [ "$kind" = dest ] && [ "$index" -eq 0 ]; then
      CHOICE="$SAVE_ROOT/${SRC##*/}-rescue"; return
    fi
    if [ "$index" -ge 1 ] && [ "$index" -le "$n" ]; then
      CHOICE=${options[$((index-1))]}; return
    fi
    say 'Number is outside the menu.'
  done
}
meta() { stat -f '%HT|%z|%m|%d' "$1"; }
# Append a sentinel so command substitution preserves trailing newlines in targets.
link_text() { readlink "$1" && printf '.'; }
need_entry() {
  local reason=$1 kind=$2 relative=$3 size=$4
  printf '%s\0' "$relative" >> "$WORK/todo.nul" || stop 'Cannot write candidate list.'
  printf '%s %s %q\n' "$reason" "$kind" "$relative" >> "$WORK/report.txt" || stop 'Cannot write report.'
  NEED=$((NEED+1))
  [ "$reason" != MISSING ] || MISSING=$((MISSING+1))
  [ "$reason" != DIFFERENT ] || DIFFERENT=$((DIFFERENT+1))
  [ "$kind" != 'Regular File' ] || BYTES=$((BYTES+size))
}
audit() {
  local path relative dest a b kind size rest dev srcdev sl dl dstkind
  CHECKED=0; SAME=0; NEED=0; MISSING=0; DIFFERENT=0; SPECIAL=0; BYTES=0
  srcdev=$(stat -f '%d' "$SRC") || stop 'Cannot inspect source filesystem.'
  : > "$WORK/errors.log" || stop 'Cannot create error log.'
  : > "$WORK/report.txt" || stop 'Cannot create report.'
  : > "$WORK/todo.nul" || stop 'Cannot create candidate list.'
  printf '%s\0%s\0' "$SRC" "$DST" > "$WORK/paths.nul" || stop 'Cannot save selected paths.'
  say 'Building file list. No file contents are being copied.'
  find -P "$SRC" -xdev -print0 > "$WORK/all.nul" 2>> "$WORK/errors.log" || stop 'Source traversal failed; check incomplete.'
  say 'Comparing metadata...'
  while IFS= read -r -d '' path; do
    if [ "$path" = "$SRC" ]; then relative=.; dest=$DST
    else relative=${path#"$SRC"/}; dest="$DST/$relative"; fi
    a=$(meta "$path" 2>> "$WORK/errors.log") || stop 'Source metadata read failed.'
    kind=${a%%|*}; rest=${a#*|}; size=${rest%%|*}; dev=${a##*|}
    CHECKED=$((CHECKED+1))
    if [ "$dev" != "$srcdev" ]; then
      printf 'OTHER_FILESYSTEM %q\n' "$relative" >> "$WORK/errors.log"
      stop 'Nested filesystem detected; not a complete audit.'
    fi
    case "$kind" in
      Directory|'Regular File'|'Symbolic Link') ;;
      *) printf 'SPECIAL %s %q\n' "$kind" "$relative" >> "$WORK/report.txt" || stop 'Cannot write report.'
         SPECIAL=$((SPECIAL+1)); continue ;;
    esac
    b=MISSING
    if [ -e "$dest" ] || [ -L "$dest" ]; then
      b=$(meta "$dest" 2>> "$WORK/errors.log") || stop 'Destination metadata read failed.'
      dstkind=${b%%|*}
      if [ "$kind" != "$dstkind" ]; then
        printf 'TYPE_CONFLICT %q source=%s destination=%s\n' "$relative" "$kind" "$dstkind" >> "$WORK/errors.log"
        stop 'Object type conflict. No automatic replacement.'
      fi
      # Source listing is preorder: every destination ancestor is checked
      # before its children. A destination symlink in place of a directory stops here.
    fi
    if [ "$b" = MISSING ]; then
      need_entry MISSING "$kind" "$relative" "$size"
    elif [ "$kind" = Directory ]; then
      SAME=$((SAME+1))
    elif [ "$kind" = 'Symbolic Link' ]; then
      sl=$(link_text "$path" 2>> "$WORK/errors.log") || stop 'Cannot read source link.'
      dl=$(link_text "$dest" 2>> "$WORK/errors.log") || stop 'Cannot read destination link.'
      if [ "$sl" = "$dl" ]; then SAME=$((SAME+1))
      else need_entry DIFFERENT "$kind" "$relative" "$size"; fi
    elif [ "${a%|*}" = "${b%|*}" ]; then
      SAME=$((SAME+1))
    else
      need_entry DIFFERENT "$kind" "$relative" "$size"
    fi
    if [ $((CHECKED%1000)) -eq 0 ]; then
      printf 'CHECKED=%s NEED=%s\n' "$CHECKED" "$NEED"
    fi
  done < "$WORK/all.nul"
  printf 'CHECKED=%s\nSAME_METADATA=%s\nMISSING=%s\nDIFFERENT=%s\nNEED=%s\nSPECIAL=%s\nNEED_FILE_BYTES=%s\n' \
    "$CHECKED" "$SAME" "$MISSING" "$DIFFERENT" "$NEED" "$SPECIAL" "$BYTES" > "$WORK/summary.txt" || stop 'Cannot write summary.'
}
main() {
  local tool srcphysical dstphysical answer
  export PATH=/usr/bin:/bin:/usr/sbin:/sbin
  export LC_ALL=C
  umask 077
  set -o pipefail
  shopt -s nullglob dotglob
  [ "$(uname -s)" = Darwin ] || stop 'This script requires macOS; no disk operations performed.'
  for tool in diskutil stat find awk mktemp readlink tail cat df; do
    command -v "$tool" >/dev/null || stop "Required tool is missing: $tool"
  done
  say 'RECOVERY COPY AUDIT v1.0.0'
  say 'Audit only. No repair, formatting, copying, deletion or network access.'
  say 'Run only one disk operation at a time. Keep AC power connected.'
  check_mounts
  [ "$(stat -f '%HT' "$DATA_ROOT")" = Directory ] || stop 'Unsupported stat implementation.'
  choose_dir 'Select the home directory:' "$DATA_ROOT/Users" user
  choose_dir 'Select the ORIGINAL folder to compare:' "$CHOICE" source
  SRC=$CHOICE
  srcphysical=$(cd -P "$SRC" && pwd -P) || stop 'Cannot resolve source directory.'
  [ "$srcphysical" = "$SRC" ] || stop 'Source path contains a symbolic-link ancestor.'
  case "$SRC" in "$DATA_ROOT"/Users/*) ;; *) stop 'Source path outside data volume.' ;; esac
  choose_dir 'Select the EXISTING COPY on the external disk:' "$SAVE_ROOT" dest
  DST=$CHOICE
  [ ! -L "$DST" ] || stop 'Destination must not be a symbolic link.'
  if [ -e "$DST" ]; then
    [ -d "$DST" ] || stop 'Destination is not a directory.'
    dstphysical=$(cd -P "$DST" && pwd -P) || stop 'Cannot resolve destination.'
    [ "$dstphysical" = "$DST" ] || stop 'Destination contains a symbolic-link ancestor.'
  fi
  case "$DST" in "$SAVE_ROOT"/*) ;; *) stop 'Destination outside external volume.' ;; esac
  printf '\nSOURCE: %q\nCOPY:   %q\n' "$SRC" "$DST"
  say 'Compare size + mtime; not a byte-by-byte integrity check.'
  say 'Only a NEW audit-report directory will be written on RESCUE.'
  printf 'Enter 1 to start the audit, anything else to stop: '
  IFS= read -r answer || exit 0
  [ "$answer" = 1 ] || exit 0
  check_mounts
  WORK=$(mktemp -d "$SAVE_ROOT/.rescue-check.XXXXXX") || stop 'Cannot create report directory.'
  trap cleanup EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM HUP
  if command -v caffeinate >/dev/null; then
    caffeinate -dis -w $$ >/dev/null 2>&1 & CAFFEINE_PID=$!
  fi
  printf 'REPORT=%s\n' "$WORK"
  audit
  check_mounts
  cat "$WORK/summary.txt" || stop 'Cannot read summary.'
  say 'CHECK_DONE: audit finished; this is NOT proof of file integrity.'
  say 'ACLs, xattrs, resource forks and hard-link layout were not compared.'
  [ "$SPECIAL" -eq 0 ] || say 'Special objects require separate review.'
  say 'No original files or existing copied files were changed.'
}
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
