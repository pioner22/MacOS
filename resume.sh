#!/bin/bash
# Yagodka partial-audit rescue 2.1.0. Bash 3.2 / macOS Recovery.
# Uses an existing v1/v2 manifest; never repairs or writes the source.
# User must confirm COPY. Only RESCUE receives reports/staged copies.
# Matching size/mtime is NOT proof of content integrity. No checksum pass.
# Do not run concurrently with other copy, audit, repair, or destination writers.
DATA_ROOT=/Volumes/RescueData
SAVE_ROOT=/Volumes/RESCUE
SRC=$DATA_ROOT/Users/admin/yagodka
DST=$SAVE_ROOT/yagodka-rescue
SESSION=; REPORT=; STAGE=; CHILD=; CAFFEINE_PID=; LOCK_OWNED=0
SOURCE_DEV=; SAVE_DEV=; THERM_LAST=-30; DRAW_LAST=-5
POWER=UNKNOWN; THERMAL=UNKNOWN; WORK_TOTAL=0; ALL_TOTAL=0
DONE=0; COPIED=0; SAME=0; UNRESOLVED=0; SPECIAL=0; BYTES=0
GN=(); GT=(); GQ=(); GD=(); GB=(); GS=(); GC=0; GI=-1; G_LAST=
PHASE=LOAD; PHASE_START=0; CURRENT=; PREVIOUS_SPECIAL=0
say() { printf '%s\n' "$*"; }
stop() { printf '\nSTOP: %s\n' "$*" >&2; exit 1; }
uint() { case "$1" in ''|*[!0-9]*) return 1;; esac; [ "${#1}" -le 16 ]; }
relative_ok() {
  case "$1" in ''|/*|..|../*|*/../*|*/..|./*|*/./*|*/.|*//*) return 1;; esac
}
field() { printf '%s\n' "$1" | awk -v k="$2" '{sub(/^[ \t]+/, "");if(index($0,k ":")==1){sub(/^[^:]*:[ \t]*/, "");print;exit}}'; }
meta() { stat -f '%HT|%z|%m|%d' "$1"; }
link_text() {
  local t
  t=$(stat -f '%Y' "$1" && printf '.') || return 1
  [ "$t" != $'\n.' ] && [ "$t" != . ] || return 1
  printf '%s' "$t"
}
check_mounts() {
  local a b
  [ -d "$DATA_ROOT" ] && [ ! -L "$DATA_ROOT" ] && [ -d "$SAVE_ROOT" ] && [ ! -L "$SAVE_ROOT" ] || stop 'Required mount missing or symlink.'
  a=$(diskutil info "$DATA_ROOT") && b=$(diskutil info "$SAVE_ROOT") || stop 'Cannot inspect mounts.'
  [ "$(field "$a" 'Mount Point')" = "$DATA_ROOT" ] && [ "$(field "$b" 'Mount Point')" = "$SAVE_ROOT" ] || stop 'Wrong mount points.'
  case "$(field "$a" 'Volume Read-Only')" in Yes*) ;; *) stop 'Source must be read-only.';; esac
  [ "$(field "$a" 'Device Location')" = Internal ] || stop 'Source is not internal.'
  [ "$(field "$b" 'Device Location')" = External ] && [ "$(field "$b" 'Volume Read-Only')" = No ] && [ "$(field "$b" 'Volume Name')" = RESCUE ] || stop 'Destination is not writable external RESCUE.'
  SOURCE_DEV=$(stat -f '%d' "$DATA_ROOT") && SAVE_DEV=$(stat -f '%d' "$SAVE_ROOT") || stop 'Cannot inspect devices.'
  [ "$SOURCE_DEV" != "$SAVE_DEV" ] || stop 'Source and copy share a filesystem.'
}
guard() {
  [ "$(stat -f '%d' "$DATA_ROOT")" = "$SOURCE_DEV" ] && [ "$(stat -f '%d' "$SAVE_ROOT")" = "$SAVE_DEV" ] || stop 'Mount lost or changed.'
}
cleanup() {
  local r=$?
  trap - EXIT
  if [ -n "$CHILD" ]; then kill -TERM "$CHILD" 2>/dev/null || :; wait "$CHILD" 2>/dev/null || :; fi
  [ -z "$CAFFEINE_PID" ] || kill "$CAFFEINE_PID" 2>/dev/null || :
  if [ -n "$SESSION" ]; then
    printf '\nSESSION=%s\n' "$SESSION"
    [ "$r" = 0 ] || say 'NOT COMPLETE. Existing reports and staging are preserved.'
  fi
  [ -z "$STAGE" ] || printf 'STAGING=%s\n' "$STAGE"
  [ "$LOCK_OWNED" = 0 ] || rmdir /tmp/mac-rescue-v2.lock 2>/dev/null || :
  exit "$r"
}
power_setup() {
  local out
  if command -v pmset >/dev/null; then
    pmset -g custom > "$SESSION/power-before.txt" 2>&1 || :
    if pmset -a lowpowermode 1 > "$SESSION/power.log" 2>&1; then
      out=$(pmset -g 2>> "$SESSION/power.log") || out=
      POWER=$(printf '%s\n' "$out" | awk '$1=="lowpowermode" {print $2;exit}')
      [ "$POWER" = 1 ] && POWER=ON || POWER=UNCONFIRMED
    else POWER=UNAVAILABLE; fi
  fi
  if command -v caffeinate >/dev/null; then caffeinate -dis -w $$ >/dev/null 2>&1 & CAFFEINE_PID=$!; fi
  printf 'LOW_POWER=%s. No guarantee against emergency shutdown.\n' "$POWER"
}
thermal_poll() {
  local out level
  [ $((SECONDS-THERM_LAST)) -ge 15 ] || return 0
  THERM_LAST=$SECONDS; guard
  THERMAL=UNKNOWN
  if command -v pmset >/dev/null; then
    out=$(pmset -g sysload 2>&1) || out=
    level=$(printf '%s\n' "$out" | awk '/- thermal level[[:space:]]*=/ {sub(/^.*=[[:space:]]*/, "");sub(/[[:space:]]*$/, "");print;exit}')
    case "$level" in
      Bad) printf '%s\n' "$out" >> "$SESSION/power.log"; stop 'OS thermal advisory Bad.';;
      Great|Good|OK|Okay) THERMAL=$level;;
    esac
  fi
}
progress() {
  local e p cells bar= i eta rate
  [ "${1:-0}" = 1 ] || [ $((SECONDS-DRAW_LAST)) -ge 3 ] || return 0
  DRAW_LAST=$SECONDS; thermal_poll
  e=$((SECONDS-PHASE_START)); [ "$e" -gt 0 ] || e=1
  if [ "$PHASE" = LOAD ]; then printf '\r\033[KREADING SAVED LIST: %s objects; queued=%s (external disk only)' "$ALL_TOTAL" "$WORK_TOTAL"; return; fi
  p=0; [ "$WORK_TOTAL" -eq 0 ] || p=$((DONE*100/WORK_TOTAL)); cells=$((p/5))
  for ((i=0;i<20;i++)); do [ "$i" -lt "$cells" ] && bar="${bar}#" || bar="${bar}-"; done
  eta=unknown; [ "$DONE" -eq 0 ] || eta="$(((WORK_TOTAL-DONE)*e/DONE))s"
  rate=$(awk -v b="$BYTES" -v t="$e" 'BEGIN{printf "%.2f", b/1048576/t}')
  printf '\r\033[KRESUME [%s] %d%% %s/%s | avg %s MiB/s | %ss | ETA~%s | gaps=%s | LPM:%s TH:%s' "$bar" "$p" "$DONE" "$WORK_TOTAL" "$rate" "$e" "$eta" "$UNRESOLVED" "$POWER" "$THERMAL"
}
group() {
  local name=${1%%/*} i
  [ "$1" != . ] || name='[root directory]'
  [ "$G_LAST" != "$name" ] || return 0
  G_LAST=$name
  for ((i=0;i<GC;i++)); do if [ "${GN[$i]}" = "$name" ]; then GI=$i; return; fi; done
  GI=$GC; GN[$GI]=$name; GT[$GI]=0; GQ[$GI]=0; GD[$GI]=0; GB[$GI]=0; GS[$GI]=0; GC=$((GC+1))
}
show_groups() {
  local i pending label status
  printf '\n%-28s %10s %10s %10s %s\n' TOP_LEVEL TOTAL UNPROCESSED UNRESOLVED STATUS
  for ((i=0;i<GC;i++)); do
    pending=$((${GQ[$i]}-${GD[$i]})); status=METADATA_ONLY
    [ "$pending" -eq 0 ] || status=PENDING
    [ "${GB[$i]}" -eq 0 ] || status=WITH_GAPS
    [ "${GS[$i]}" -eq 0 ] || status=REVIEW_SPECIAL
    printf -v label '%q' "${GN[$i]}"
    printf '%-28s %10s %10s %10s %s\n' "$label" "${GT[$i]}" "$pending" "${GB[$i]}" "$status"
  done
  say 'Statuses concern this saved manifest only. No checksums; inherited old audit results are not revalidated.'
}
# Return 1 for a missing source path, but STOP for I/O/other errors.
source_meta() {
  local err
  M=$(meta "$1" 2> "$SESSION/last-stat.log") && return 0
  err=$(cat "$SESSION/last-stat.log") || stop 'Cannot read stat error.'
  cat "$SESSION/last-stat.log" >> "$SESSION/errors.log" || stop 'Cannot save stat error.'
  guard
  case "$err" in *'No such file or directory') return 1;; *) stop 'Source stat error other than missing path. See errors.log.';; esac
}
unresolved() {
  printf '%s\0' "$CURRENT" >> "$SESSION/unresolved.nul" || stop 'Cannot save unresolved list.'
  printf '%s %q\n' "$1" "$CURRENT" >> "$SESSION/unresolved.txt" || stop 'Cannot save unresolved report.'
  printf '\nUNRESOLVED %s %q\n' "$1" "$CURRENT"
  UNRESOLVED=$((UNRESOLVED+1)); GB[$GI]=$((${GB[$GI]}+1))
}
read_paths() {
  local s d extra=
  exec 3< "$1/paths.nul" || return 1
  IFS= read -r -d '' s <&3 && IFS= read -r -d '' d <&3 || { exec 3<&-; return 1; }
  if IFS= read -r -d '' extra <&3 || [ -n "$extra" ]; then exec 3<&-; return 1; fi
  exec 3<&-
  [ "$s" = "$SRC" ] && [ "$d" = "$DST" ]
}
choose_report() {
  local p f n=0 answer; local options=()
  say 'Select the interrupted yagodka audit (old files are not modified):'
  for p in "$SAVE_ROOT"/.rescue-check.*; do
    [ -d "$p" ] && [ ! -L "$p" ] || continue
    [ ! -s "$p/summary.txt" ] || continue
    [ "$(stat -f '%d' "$p")" = "$SAVE_DEV" ] || continue
    for f in paths.nul all.nul todo.nul errors.log; do [ -f "$p/$f" ] && [ ! -L "$p/$f" ] || continue 2; done
    [ -s "$p/all.nul" ] && [ -s "$p/errors.log" ] || continue
    read_paths "$p" || continue
    options[$n]=$p; n=$((n+1)); printf '  %d) %s\n' "$n" "${p##*/}"
  done
  [ "$n" -gt 0 ] || stop 'No matching interrupted audit. Do not overwrite the old reports.'
  printf 'Report number (q = stop): '; IFS= read -r answer || exit 0
  [ "$answer" != q ] || exit 0
  uint "$answer" && [ "${#answer}" -le 6 ] || stop 'Invalid number.'
  answer=$((10#$answer)); [ "$answer" -ge 1 ] && [ "$answer" -le "$n" ] || stop 'Invalid report number.'
  REPORT=${options[$((answer-1))]}
}
# A single source ENOENT diagnostic identifies exactly where the old v1 audit
# stopped. Anything less conclusive is rejected, not guessed from counters.
make_queue() {
  local err anchor p rel next= have=0 passed=0 old=0 q=0 found=0
  err=$(cat "$REPORT/errors.log") || stop 'Cannot read old error log.'
  case "$err" in *$'\n'*) stop 'Multiple old errors: automatic continuation is ambiguous.';; esac
  case "$err" in
    'stat: '*': stat: No such file or directory') anchor=${err#stat: }; anchor=${anchor%: stat: No such file or directory};;
    'stat: '*': No such file or directory') anchor=${err#stat: }; anchor=${anchor%: No such file or directory};;
    *) stop 'Old failure is not a single source ENOENT. Do not infer a resume point.';;
  esac
  case "$anchor" in "$SRC"/*) ;; *) stop 'Error anchor is not inside the selected source.';; esac
  printf 'OLD_FAILURE=%q\n' "$anchor"
  : > "$SESSION/queue.nul" || stop 'Cannot create queue.'
  exec 4< "$REPORT/todo.nul" || stop 'Cannot read old candidates.'
  if IFS= read -r -d '' next <&4; then have=1; else [ -z "$next" ] || stop 'Truncated candidates.'; fi
  while :; do
    p=; if ! IFS= read -r -d '' p; then [ -z "$p" ] || stop 'Truncated saved manifest.'; break; fi
    if [ "$p" = "$SRC" ]; then rel=.; else
      case "$p" in "$SRC"/*) rel=${p#"$SRC"/};; *) stop 'Manifest path outside source.';; esac
    fi
    relative_ok "$rel" || stop 'Unsafe saved path.'
    if [ "$ALL_TOTAL" -eq 0 ] && [ "$rel" != . ]; then stop 'Manifest does not start at source root.'; fi
    ALL_TOTAL=$((ALL_TOTAL+1)); group "$rel"; GT[$GI]=$((${GT[$GI]}+1))
    if [ "$p" = "$anchor" ]; then
      [ "$found" = 0 ] || stop 'Duplicate failure anchor.'
      [ "$have" = 0 ] || stop 'Candidate list does not end before the failed source stat.'
      found=1; passed=1
    fi
    q=0
    if [ "$passed" = 1 ]; then q=1
    elif [ "$have" = 1 ] && [ "$rel" = "$next" ]; then
      q=1; old=$((old+1)); next=
      if IFS= read -r -d '' next <&4; then have=1; else have=0; [ -z "$next" ] || stop 'Truncated candidate list.'; fi
    fi
    if [ "$q" = 1 ]; then
      printf '%s\0' "$rel" >> "$SESSION/queue.nul" || stop 'Cannot save work queue.'
      WORK_TOTAL=$((WORK_TOTAL+1)); GQ[$GI]=$((${GQ[$GI]}+1))
    fi
    progress
  done < "$REPORT/all.nul"
  exec 4<&-
  [ "$found" = 1 ] && [ "$have" = 0 ] || stop 'Cannot match old failure to a complete saved manifest.'
  PREVIOUS_SPECIAL=0
  if [ -f "$REPORT/report.txt" ] && [ ! -L "$REPORT/report.txt" ]; then
    PREVIOUS_SPECIAL=$(awk '/^SPECIAL /{n++} END{print n+0}' "$REPORT/report.txt") || stop 'Cannot inspect old special-object report.'
  fi
  printf '\nSAVED_OBJECTS=%s OLD_CANDIDATES=%s QUEUED=%s INHERITED_METADATA_RESULTS=%s\n' "$ALL_TOTAL" "$old" "$WORK_TOTAL" "$((ALL_TOTAL-WORK_TOTAL))"
  printf 'PREVIOUS_SPECIAL=%s\n' "$PREVIOUS_SPECIAL"
  show_groups
}
# Never follow source/destination symlink ancestors. Missing parent directories
# are created only from real directories on the read-only source filesystem.
parents() {
  local remain=$1 s=$SRC d=$DST part owner bits mode
  while :; do
    source_meta "$s" || return 1
    [ "${M%%|*}" = Directory ] && [ "${M##*|}" = "$SOURCE_DEV" ] || stop 'Unsafe source parent.'
    if [ -e "$d" ] || [ -L "$d" ]; then
      M=$(meta "$d") || stop 'Cannot inspect copy parent.'
      [ "${M%%|*}" = Directory ] && [ "${M##*|}" = "$SAVE_DEV" ] || stop 'Copy parent is a link, conflict, or other filesystem.'
    else
      owner=$(stat -f '%u:%g' "$s") && bits=$(stat -f '%p' "$s") || stop 'Cannot inspect directory mode.'
      case "$owner" in *[!0-9:]*|''|:*) stop 'Invalid directory owner.';; esac
      case "$bits" in *[!0-7]*|'') stop 'Invalid directory mode.';; esac
      printf -v mode '%o' "$((8#$bits & 07777))"
      mkdir "$d" && chown "$owner" "$d" && chmod "$mode" "$d" || stop 'Cannot create copy parent.'
    fi
    case "$remain" in */*) part=${remain%%/*}; remain=${remain#*/}; s="$s/$part"; d="$d/$part";; *) break;; esac
  done
}
copy_one() {
  local rel=$1 s d a b kind size rest oldlink newlink payload result free checked olddest
  CURRENT=$rel; group "$rel"; guard
  if [ "$rel" = . ]; then s=$SRC; d=$DST; else s="$SRC/$rel"; d="$DST/$rel"; fi
  parents "$rel" || { unresolved MISSING_SOURCE_PARENT; return; }
  source_meta "$s" || { unresolved MISSING_SOURCE; return; }
  a=$M; kind=${a%%|*}; rest=${a#*|}; size=${rest%%|*}
  [ "${a##*|}" = "$SOURCE_DEV" ] && uint "$size" || stop 'Invalid source type/device/size.'
  case "$kind" in Directory|'Regular File'|'Symbolic Link') ;;
    *) SPECIAL=$((SPECIAL+1)); GS[$GI]=$((${GS[$GI]}+1)); unresolved SPECIAL_OBJECT; return;; esac
  b=MISSING
  if [ -e "$d" ] || [ -L "$d" ]; then
    b=$(meta "$d") || stop 'Cannot read copy metadata.'
    [ "${b%%|*}" = "$kind" ] && [ "${b##*|}" = "$SAVE_DEV" ] || stop 'Copy type/device conflict; no replacement.'
  fi
  if [ "$b" != MISSING ]; then
    if [ "$kind" = Directory ]; then SAME=$((SAME+1)); return; fi
    if [ "$kind" = 'Regular File' ] && [ "${a%|*}" = "${b%|*}" ]; then SAME=$((SAME+1)); return; fi
    if [ "$kind" = 'Symbolic Link' ]; then
      oldlink=$(link_text "$s") && newlink=$(link_text "$d") || stop 'Cannot read link target.'
      if [ "$oldlink" = "$newlink" ]; then SAME=$((SAME+1)); return; fi
    fi
  fi
  if [ "$kind" = Directory ]; then
    parents "$rel/_" || { unresolved MISSING_SOURCE_PARENT; return; }
    COPIED=$((COPIED+1))
    printf '%s\0' "$rel" >> "$SESSION/copied.nul" || stop 'Cannot save copied-directory list.'
    return
  fi
  [ -n "$STAGE" ] || STAGE=$(mktemp -d "$SAVE_ROOT/.resume-stage.XXXXXX") || stop 'Cannot create staging directory.'
  payload="$STAGE/item"
  [ ! -e "$payload" ] && [ ! -L "$payload" ] || stop 'Staging item already exists; preserved.'
  free=$(df -Pk "$SAVE_ROOT" | awk 'END{print $4}') || stop 'Cannot read free space.'
  uint "$free" && [ $((free*1024)) -gt $((size+16777216)) ] || stop 'Insufficient space for staged file.'
  printf '\nCOPYING %q (%s bytes)\n' "$rel" "$size"
  if [ "$kind" = 'Regular File' ]; then
    if [ "$size" -ge 8388608 ]; then
      ditto --rsrc --extattr --acl "$s" "$payload" >> "$SESSION/copy.log" 2>&1 & CHILD=$!
      while kill -0 "$CHILD" 2>/dev/null; do progress; sleep 1; done
      wait "$CHILD"; result=$?; CHILD=
    else ditto --rsrc --extattr --acl "$s" "$payload" >> "$SESSION/copy.log" 2>&1; result=$?; fi
  else cp -pPR "$s" "$payload" >> "$SESSION/copy.log" 2>&1; result=$?; fi
  [ "$result" = 0 ] || stop 'Copy error: staged file and old destination retained. See copy.log.'
  guard; parents "$rel" || stop 'Source parent disappeared during copy.'
  checked=$(meta "$s") || stop 'Source disappeared during copy.'
  [ "$checked" = "$a" ] || stop 'Source metadata changed during copy.'
  checked=$(meta "$payload") || stop 'Cannot inspect staged file.'
  [ "${checked##*|}" = "$SAVE_DEV" ] && [ "${checked%%|*}" = "$kind" ] || stop 'Bad staging type/device.'
  if [ "$kind" = 'Regular File' ]; then
    [ "${checked%|*}" = "${a%|*}" ] || stop 'Staged file size/time mismatch.'
  else
    oldlink=$(link_text "$s") && newlink=$(link_text "$payload") || stop 'Cannot validate staged link.'
    [ "$oldlink" = "$newlink" ] || stop 'Staged link mismatch.'
  fi
  olddest=MISSING
  if [ -e "$d" ] || [ -L "$d" ]; then olddest=$(meta "$d") || stop 'Cannot recheck destination.'; fi
  [ "$olddest" = "$b" ] || stop 'Destination changed during staging.'
  mv -fh "$payload" "$d" || stop 'Cannot commit staged file.'
  COPIED=$((COPIED+1)); [ "$kind" != 'Regular File' ] || BYTES=$((BYTES+size))
  printf '%s\0' "$rel" >> "$SESSION/copied.nul" || stop 'Cannot save copied-file list.'
}
run_queue() {
  local rel prevgroup= i
  PHASE=RESUME; PHASE_START=$SECONDS; DRAW_LAST=-5
  while IFS= read -r -d '' rel; do
    relative_ok "$rel" || stop 'Unsafe queue entry.'
    copy_one "$rel"
    DONE=$((DONE+1)); GD[$GI]=$((${GD[$GI]}+1))
    printf '%s\0' "$rel" >> "$SESSION/processed.nul" || stop 'Cannot record processed item.'
    progress
    if [ $((DONE%200)) -eq 0 ]; then command -v sync >/dev/null && sync; sleep 1; fi
  done < "$SESSION/queue.nul"
  [ "$DONE" = "$WORK_TOTAL" ] || stop 'Queue traversal incomplete.'
  progress 1; guard
  if [ -n "$STAGE" ]; then rmdir "$STAGE" || stop 'Staging not empty; retained.'; STAGE=; fi
  command -v sync >/dev/null && sync
  show_groups; show_groups > "$SESSION/folders-after.txt" || stop 'Cannot save folder summary.'
  printf 'PROCESSED=%s\nCOPIED_OBJECTS=%s\nSAME_METADATA=%s\nUNRESOLVED=%s\nSPECIAL=%s\nPREVIOUS_SPECIAL=%s\nREGULAR_BYTES_COPIED=%s\n' "$DONE" "$COPIED" "$SAME" "$UNRESOLVED" "$SPECIAL" "$PREVIOUS_SPECIAL" "$BYTES" > "$SESSION/summary.txt" || stop 'Cannot save result.'
  printf '\n'; cat "$SESSION/summary.txt"
  if [ "$UNRESOLVED" -gt 0 ] || [ "$PREVIOUS_SPECIAL" -gt 0 ]; then say 'RESUME_DONE_WITH_GAPS: unresolved paths need separate review.'; return 2; fi
  say 'RESUME_DONE_METADATA_ONLY: processed the saved list; not a full integrity guarantee.'
}
main() {
  local t answer p
  export PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C
  umask 077; set -o pipefail; shopt -s nullglob dotglob
  [ "$(uname -s)" = Darwin ] || stop 'macOS Recovery required.'
  for t in diskutil stat awk mktemp tail cat df cp ditto mkdir mv rmdir sleep chmod chown; do command -v "$t" >/dev/null || stop "Missing tool: $t"; done
  say 'YAGODKA RESUME v2.1.0'
  say 'Run only after all other checks/copies have stopped. No disk repair or source writes.'
  check_mounts
  [ -d "$SRC" ] && [ ! -L "$SRC" ] && [ -d "$DST" ] && [ ! -L "$DST" ] || stop 'Expected yagodka source/copy is missing.'
  for p in "$SRC" "$DST"; do [ "$(cd -P "$p" && pwd -P)" = "$p" ] || stop 'Path has a symlink ancestor.'; done
  [ "$(stat -f '%d' "$SRC")" = "$SOURCE_DEV" ] && [ "$(stat -f '%d' "$DST")" = "$SAVE_DEV" ] || stop 'Wrong source/copy filesystem.'
  mkdir /tmp/mac-rescue-v2.lock 2>/dev/null || stop 'Another rescue session or stale lock exists. Do not run concurrently.'
  LOCK_OWNED=1; trap cleanup EXIT; trap 'exit 130' INT; trap 'exit 143' TERM HUP
  SESSION=$(mktemp -d "$SAVE_ROOT/.resume-session.XXXXXX") || stop 'Cannot create session.'
  for t in errors.log last-stat.log copy.log unresolved.nul unresolved.txt copied.nul processed.nul; do : > "$SESSION/$t" || stop 'Cannot initialize log.'; done
  power_setup
  choose_report
  printf 'SOURCE=%s\nCOPY=%s\nOLD_REPORT=%s\nSESSION=%s\n' "$SRC" "$DST" "$REPORT" "$SESSION"
  make_queue
  say 'The queue includes old candidates plus the not-yet-checked suffix.'
  say 'Existing files with equal size/mtime are skipped. Missing source paths are logged as gaps.'
  say 'I/O errors, conflicts, lost mounts, low space or copy errors STOP the run.'
  say 'No checksum verification or directory metadata / hard-link-layout reconstruction.'
  say 'Progress counts queued objects; speed counts completed regular files; ETA is approximate.'
  say 'This does NOT update or overwrite backup-rescue. Keep the internal SSD read-only.'
  printf 'Type COPY to start actual selective copying (anything else exits): '
  IFS= read -r answer || exit 0
  [ "$answer" = COPY ] || exit 0
  guard; run_queue
}
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
