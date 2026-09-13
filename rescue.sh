#!/bin/bash
# Recovery rescue v2.0.0 -- Bash 3.2 / macOS BSD tools.
# No source writes, repairs, formatting, mount changes or network requests.
# COPY mode changes only selected candidates on the external destination after confirmation.
# Reports and staging are on the external destination; COPY changes selected destination files only.
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
      user:Shared|user:Guest|dest:check.*|dest:.rescue-check.*|dest:.rescue-session.*|dest:.rescue-stage.*|dest:.Trashes|dest:.Spotlight-V100|dest:.fseventsd) continue ;;
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
# macOS Recovery may omit the standalone readlink executable.
# BSD stat %Y reads the link target without following the link.
# A sentinel preserves trailing newlines; reject an empty/error target.
link_text() {
  local text
  text=$(stat -f '%Y' "$1" && printf '.') || return 1
  [ "$text" != $'\n.' ] && [ "$text" != . ] || return 1
  printf '%s' "$text"
}
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
  local entry count=0
  while IFS= read -r -d '' entry; do count=$((count+1)); done < "$WORK/all.nul"
  phase_start AUDIT "$count"
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
         SPECIAL=$((SPECIAL+1)); DONE=$CHECKED; draw_progress; continue ;;
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
    DONE=$CHECKED; CURRENT=${relative%%/*}; draw_progress
  done < "$WORK/all.nul"
  draw_progress 1; printf '\n'
  printf 'CHECKED=%s\nSAME_METADATA=%s\nMISSING=%s\nDIFFERENT=%s\nNEED=%s\nSPECIAL=%s\nNEED_FILE_BYTES=%s\n' \
    "$CHECKED" "$SAME" "$MISSING" "$DIFFERENT" "$NEED" "$SPECIAL" "$BYTES" > "$WORK/summary.txt" || stop 'Cannot write summary.'
}
# Recovery workflow v2.0.0. All UI uses ASCII for Recovery compatibility.
# Compatible with completed v1.0.1 audit reports. No eval, no rsync/readlink.
# Copies are explicit opt-in; regular files are staged on the destination.
# File contents, ACL equivalence and hard-link layout are NOT verified.
SESSION=; CHILD=; LOCK=; LOCK_OWNED=0
THERMAL=UNKNOWN; POWER=UNKNOWN; THERM_LAST=-30
SOURCE_DEV=; SAVE_DEV=; START=0; LAST_DRAW=-5
DONE=0; TOTAL=0; WRITTEN=0; RESOLVED_BYTES=0; PLAN_BYTES=0
PHASE=; CURRENT=; GROUP_NAMES=(); GROUP_TOTAL=(); GROUP_NEED=()
GROUP_LAST=; GROUP_INDEX=0; GROUP_COUNT=0; SPECIAL=0; REPORT=

# Do not set errexit: all operations that can change a copy are checked explicitly.
ui_time() { printf '%02d:%02d:%02d' "$(($1/3600))" "$(($1/60%60))" "$(($1%60))"; }
is_uint() { case "$1" in ''|*[!0-9]*) return 1;; esac; [ "${#1}" -le 16 ]; }
valid_relative() {
  case "$1" in ''|/*|..|../*|*/../*|*/..|./*|*/./*|*/.|*//*) return 1;; esac
  return 0
}
new_cleanup() {
  local status=$?
  trap - EXIT
  if [ -n "$CHILD" ]; then kill -TERM "$CHILD" 2>/dev/null || :; wait "$CHILD" 2>/dev/null || :; fi
  [ -z "$CAFFEINE_PID" ] || kill "$CAFFEINE_PID" 2>/dev/null || :
  if [ "$LOCK_OWNED" = 1 ]; then rmdir "$LOCK" 2>/dev/null || :; fi
  printf '\n'
  [ "$status" = 0 ] || say 'STOPPED: result is incomplete. Do not erase the source.'
  [ -z "$SESSION" ] || printf 'SESSION=%s\n' "$SESSION"
  [ -z "$REPORT" ] || printf 'AUDIT_REPORT=%s\n' "$REPORT"
  say 'Low Power Mode is left as configured; it is NOT a hardware safety guarantee.'
  exit "$status"
}
guard_devices() {
  local a b
  a=$(stat -f '%d' "$DATA_ROOT") || stop 'Source mount lost.'
  b=$(stat -f '%d' "$SAVE_ROOT") || stop 'Destination mount lost.'
  [ "$a" = "$SOURCE_DEV" ] && [ "$b" = "$SAVE_DEV" ] || stop 'Mount identity changed.'
}
power_setup() {
  local after
  if command -v pmset >/dev/null; then
    pmset -g custom > "$SESSION/power-before.txt" 2>&1 || :
    if pmset -a lowpowermode 1 > "$SESSION/power-set.log" 2>&1; then
      after=$(pmset -g 2>> "$SESSION/power-set.log") || after=
      POWER=$(printf '%s\n' "$after" | awk '$1=="lowpowermode" {print $2; exit}')
      [ "$POWER" = 1 ] && POWER=ON || POWER=UNCONFIRMED
    else POWER=UNAVAILABLE; fi
  else POWER=UNAVAILABLE; fi
  printf 'LOW_POWER=%s (setting only, not a measured wattage)\n' "$POWER"
  if command -v caffeinate >/dev/null; then
    caffeinate -dis -w $$ >/dev/null 2>&1 & CAFFEINE_PID=$!
    say 'IDLE_SLEEP=INHIBITED (not protection from emergency shutdown)'
  else say 'IDLE_SLEEP=NOT_INHIBITED'; fi
  say 'THERMAL: OS advisory only; no direct temperature sensor or fan control.'
}
thermal_poll() {
  local result level
  [ $((SECONDS-THERM_LAST)) -ge 15 ] || return 0
  THERM_LAST=$SECONDS
  guard_devices
  THERMAL=UNKNOWN
  if command -v pmset >/dev/null; then
    result=$(pmset -g sysload 2>&1) || result=
    level=$(printf '%s\n' "$result" | awk '/- thermal level[[:space:]]*=/ {sub(/^.*=[[:space:]]*/, ""); sub(/[[:space:]]*$/, ""); print; exit}')
    case "$level" in
      Bad) THERMAL=BAD; printf '%s\n' "$result" >> "$SESSION/thermal.log"; stop 'OS reports thermal advisory Bad. No automatic restart.';;
      Great|Good|OK|Okay) THERMAL=$level;;
      *) THERMAL=UNKNOWN;;
    esac
  fi
}
draw_progress() {
  local force=${1:-0} elapsed percent cells bar i rate eta remain
  [ "$force" = 1 ] || [ $((SECONDS-LAST_DRAW)) -ge 2 ] || return 0
  LAST_DRAW=$SECONDS; thermal_poll
  elapsed=$((SECONDS-START)); [ "$elapsed" -ge 1 ] || elapsed=1
  percent=0; [ "$TOTAL" -eq 0 ] || percent=$((DONE*100/TOTAL))
  [ "$percent" -le 100 ] || percent=100
  cells=$((percent/5)); bar=
  for ((i=0;i<20;i++)); do [ "$i" -lt "$cells" ] && bar="${bar}#" || bar="${bar}-"; done
  rate=$((DONE/elapsed)); eta=--
  if [ "$PHASE" = COPY ]; then
    rate=$(awk -v b="$WRITTEN" -v t="$elapsed" 'BEGIN {printf "%.2f", b/1048576/t}')
    remain=$((PLAN_BYTES-RESOLVED_BYTES)); [ "$remain" -ge 0 ] || remain=0
    if [ "$WRITTEN" -gt 0 ] && [ "$elapsed" -ge 5 ]; then eta=$(ui_time $((remain*elapsed/WRITTEN))); fi
    printf '\r\033[K%s [%s] %3d%% %s/%s | avg %s MiB/s | elapsed %s | ETA~%s | LPM:%s TH:%s' "$PHASE" "$bar" "$percent" "$DONE" "$TOTAL" "$rate" "$(ui_time "$elapsed")" "$eta" "$POWER" "$THERMAL"
  else
    if [ "$DONE" -gt 0 ] && [ "$elapsed" -ge 5 ]; then eta=$(ui_time $(((TOTAL-DONE)*elapsed/DONE))); fi
    printf '\r\033[K%s [%s] %3d%% %s/%s | %s objects/s | elapsed %s | ETA~%s | LPM:%s TH:%s' "$PHASE" "$bar" "$percent" "$DONE" "$TOTAL" "$rate" "$(ui_time "$elapsed")" "$eta" "$POWER" "$THERMAL"
  fi
  if [ -n "$CURRENT" ]; then printf '\nCURRENT: %q\n' "$CURRENT"; fi
}
phase_start() { PHASE=$1; TOTAL=$2; DONE=0; START=$SECONDS; LAST_DRAW=-5; CURRENT=; }
group_for() {
  local name rel=$1 i
  [ "$rel" != . ] || { GROUP_INDEX=-1; GROUP_LAST=; return; }
  name=${rel%%/*}
  if [ "$GROUP_LAST" = "$name" ]; then return; fi
  for ((i=0;i<GROUP_COUNT;i++)); do
    if [ "${GROUP_NAMES[$i]}" = "$name" ]; then GROUP_INDEX=$i; GROUP_LAST=$name; return; fi
  done
  GROUP_INDEX=$GROUP_COUNT; GROUP_NAMES[$GROUP_COUNT]=$name
  GROUP_TOTAL[$GROUP_COUNT]=0; GROUP_NEED[$GROUP_COUNT]=0
  GROUP_COUNT=$((GROUP_COUNT+1)); GROUP_LAST=$name
}
show_groups() {
  local i n t s pct label
  printf '\n%-30s %10s %10s %8s %s\n' 'TOP-LEVEL ENTRY' 'OBJECTS' 'PENDING' 'MATCH%' 'STATUS'
  for ((i=0;i<GROUP_COUNT;i++)); do
    n=${GROUP_NEED[$i]}; t=${GROUP_TOTAL[$i]}; pct=0
    [ "$t" -eq 0 ] || pct=$(((t-n)*100/t))
    if [ "$n" -gt 0 ]; then s=NEED_COPY
    elif [ "$SPECIAL" -gt 0 ]; then s=REVIEW_SPECIAL
    else s=MATCH_METADATA; fi
    printf -v label '%q' "${GROUP_NAMES[$i]}"
    printf '%-30s %10s %10s %7s%% %s\n' "$label" "$t" "$n" "$pct" "$s"
  done
  say 'MATCH% counts objects, not bytes. MATCH_METADATA is NOT proof of content integrity.'
  say 'Root files and hidden entries are listed too. Existing directory metadata is not audited.'
}
load_summary() {
  local line k v
  C_CHECKED=; C_SAME=; C_NEED=; C_MISSING=; C_DIFFERENT=; C_SPECIAL=; C_BYTES=
  while IFS= read -r line; do
    k=${line%%=*}; v=${line#*=}; is_uint "$v" || stop 'Invalid summary value.'
    case "$k" in
      CHECKED) C_CHECKED=$((10#$v));; SAME_METADATA) C_SAME=$((10#$v));;
      NEED) C_NEED=$((10#$v));; MISSING) C_MISSING=$((10#$v));;
      DIFFERENT) C_DIFFERENT=$((10#$v));; SPECIAL) C_SPECIAL=$((10#$v));;
      NEED_FILE_BYTES) C_BYTES=$((10#$v));; *) stop 'Unknown summary field.';;
    esac
  done < "$REPORT/summary.txt"
  for v in "$C_CHECKED" "$C_SAME" "$C_NEED" "$C_MISSING" "$C_DIFFERENT" "$C_SPECIAL" "$C_BYTES"; do is_uint "$v" || stop 'Summary is incomplete.'; done
  [ "$C_CHECKED" -eq $((C_SAME+C_NEED+C_SPECIAL)) ] && [ "$C_NEED" -eq $((C_MISSING+C_DIFFERENT)) ] || stop 'Summary counters disagree.'
  SPECIAL=$C_SPECIAL
}
choose_report() {
  local p n=0 answer; local choices=()
  say 'Completed v1/v2 audit reports on RESCUE:'
  for p in "$SAVE_ROOT"/.rescue-check.*; do
    [ -d "$p" ] && [ ! -L "$p" ] && [ -s "$p/summary.txt" ] || continue
    choices[$n]=$p; n=$((n+1)); printf '%d) %s\n' "$n" "${p##*/}"
  done
  [ "$n" -gt 0 ] || stop 'No completed reports. Let the running check finish; do not interrupt it.'
  printf 'Report number (q = stop): '; IFS= read -r answer || exit 0
  [ "$answer" != q ] || exit 0
  is_uint "$answer" && [ "${#answer}" -le 6 ] || stop 'Invalid menu choice.'
  answer=$((10#$answer)); [ "$answer" -ge 1 ] && [ "$answer" -le "$n" ] || stop 'Choice outside menu.'
  REPORT=${choices[$((answer-1))]}
}
read_report() {
  local f extra path rel n=0 pending=0
  [ -d "$REPORT" ] && [ ! -L "$REPORT" ] || stop 'Invalid report directory.'
  [ "$(stat -f '%d' "$REPORT")" = "$SAVE_DEV" ] || stop 'Report is on another filesystem.'
  for f in paths.nul all.nul todo.nul summary.txt errors.log; do
    [ -f "$REPORT/$f" ] && [ ! -L "$REPORT/$f" ] || stop "Missing/unsafe report file: $f"
  done
  [ ! -s "$REPORT/errors.log" ] || stop 'Audit has errors. Do not treat it as complete.'
  load_summary
  exec 3< "$REPORT/paths.nul" || stop 'Cannot read saved paths.'
  IFS= read -r -d '' SRC <&3 && IFS= read -r -d '' DST <&3 || stop 'Saved paths truncated.'
  extra=; if IFS= read -r -d '' extra <&3 || [ -n "$extra" ]; then stop 'Too many saved paths.'; fi
  exec 3<&-
  case "$SRC" in "$DATA_ROOT"/Users/*/*) ;; *) stop 'Source outside allowed home tree.';; esac
  case "$DST" in "$SAVE_ROOT"/*) ;; *) stop 'Destination outside RESCUE.';; esac
  valid_relative "${SRC#"$DATA_ROOT"/}" && valid_relative "${DST#"$SAVE_ROOT"/}" || stop 'Non-canonical saved paths.'
  printf '\nSOURCE: %q\nCOPY:   %q\n' "$SRC" "$DST"
  GROUP_NAMES=(); GROUP_TOTAL=(); GROUP_NEED=(); GROUP_LAST=; GROUP_COUNT=0
  phase_start REPORT "$C_CHECKED"
  while :; do
    path=; if ! IFS= read -r -d '' path; then [ -z "$path" ] || stop 'Truncated all.nul.'; break; fi
    if [ "$path" = "$SRC" ]; then rel=.
    else case "$path" in "$SRC"/*) rel=${path#"$SRC"/};; *) stop 'Manifest path outside source.';; esac; fi
    valid_relative "$rel" || stop 'Unsafe manifest path.'
    group_for "$rel"; [ "$GROUP_INDEX" -lt 0 ] || GROUP_TOTAL[$GROUP_INDEX]=$((${GROUP_TOTAL[$GROUP_INDEX]}+1))
    n=$((n+1)); DONE=$n; draw_progress
  done < "$REPORT/all.nul"
  [ "$n" -eq "$C_CHECKED" ] || stop 'Manifest count differs from finished audit.'
  GROUP_LAST=
  while :; do
    rel=; if ! IFS= read -r -d '' rel; then [ -z "$rel" ] || stop 'Truncated todo.nul.'; break; fi
    valid_relative "$rel" || stop 'Unsafe candidate path.'
    group_for "$rel"; [ "$GROUP_INDEX" -lt 0 ] || GROUP_NEED[$GROUP_INDEX]=$((${GROUP_NEED[$GROUP_INDEX]}+1))
    pending=$((pending+1))
  done < "$REPORT/todo.nul"
  [ "$pending" -eq "$C_NEED" ] || stop 'Candidate count differs from finished audit.'
  for ((n=0;n<GROUP_COUNT;n++)); do
    [ "${GROUP_NEED[$n]}" -le "${GROUP_TOTAL[$n]}" ] || stop 'Invalid group counts.'
  done
  draw_progress 1; show_groups
  show_groups > "$SESSION/folders-before.txt" || stop 'Cannot save folder report.'
}
# For new audits reuse the old audited traversal and add a monitor afterwards.
# The original per-object audit is enhanced below before this module is appended.
new_audit() {
  local answer
  choose_dir 'Select home:' "$DATA_ROOT/Users" user
  choose_dir 'Select original folder:' "$CHOICE" source; SRC=$CHOICE
  choose_dir 'Select existing copy (or 0 for new):' "$SAVE_ROOT" dest; DST=$CHOICE
  printf 'SOURCE: %q\nCOPY: %q\n' "$SRC" "$DST"
  printf 'Enter 1 for NEW audit, otherwise stop: '; IFS= read -r answer || exit 0
  [ "$answer" = 1 ] || exit 0
  validate_roots
  WORK=$(mktemp -d "$SAVE_ROOT/.rescue-check.XXXXXX") || stop 'Cannot create audit directory.'
  REPORT=$WORK
  audit
  check_mounts
  cat "$WORK/summary.txt" || stop 'Cannot display summary.'
  say 'CHECK_DONE (metadata only)'
}
validate_roots() {
  local actual
  [ -d "$SRC" ] && [ ! -L "$SRC" ] || stop 'Source root missing or a link.'
  actual=$(cd -P "$SRC" && pwd -P) || stop 'Cannot resolve source root.'
  [ "$actual" = "$SRC" ] || stop 'Source has a link ancestor.'
  [ "$(stat -f '%d' "$SRC")" = "$SOURCE_DEV" ] || stop 'Source filesystem changed.'
  [ ! -L "$DST" ] || stop 'Copy root must not be a link.'
  if [ -e "$DST" ]; then
    [ -d "$DST" ] || stop 'Copy root is not a directory.'
    actual=$(cd -P "$DST" && pwd -P) || stop 'Cannot resolve copy root.'
    [ "$actual" = "$DST" ] && [ "$(stat -f '%d' "$DST")" = "$SAVE_DEV" ] || stop 'Copy root is unsafe.'
  fi
}
safe_parent() {
  local relative=$1 base part remaining
  valid_relative "$relative" || stop 'Unsafe relative path.'
  base=$DST
  [ ! -L "$base" ] && [ -d "$base" ] && [ "$(stat -f '%d' "$base")" = "$SAVE_DEV" ] || stop 'Copy root not safe.'
  [ "$relative" != . ] || return 0
  remaining=$relative
  while case "$remaining" in */*) true;; *) false;; esac; do
    part=${remaining%%/*}; remaining=${remaining#*/}; base="$base/$part"
    [ ! -L "$base" ] && [ -d "$base" ] && [ "$(stat -f '%d' "$base")" = "$SAVE_DEV" ] || stop 'Destination parent missing, a link, or a different filesystem.'
  done
}
read_pair() {
  local rest
  S_META=$(meta "$S_PATH" 2>> "$SESSION/errors.log") || stop 'Cannot read source metadata.'
  KIND=${S_META%%|*}; rest=${S_META#*|}; SIZE=${rest%%|*}
  [ "${S_META##*|}" = "$SOURCE_DEV" ] || stop 'Candidate source is on another filesystem.'
  case "$KIND" in Directory|'Regular File'|'Symbolic Link') ;; *) stop 'Special candidate needs manual review.';; esac
  D_META=MISSING
  if [ -e "$D_PATH" ] || [ -L "$D_PATH" ]; then
    D_META=$(meta "$D_PATH" 2>> "$SESSION/errors.log") || stop 'Cannot read copy metadata.'
    [ "${D_META##*|}" = "$SAVE_DEV" ] && [ "${D_META%%|*}" = "$KIND" ] || stop 'Destination type/device conflict.'
  fi
  IS_SAME=0
  if [ "$D_META" != MISSING ]; then
    if [ "$KIND" = Directory ]; then IS_SAME=1
    elif [ "$KIND" = 'Symbolic Link' ]; then
      S_LINK=$(link_text "$S_PATH") || stop 'Cannot read source link.'
      D_LINK=$(link_text "$D_PATH") || stop 'Cannot read copy link.'
      [ "$S_LINK" != "$D_LINK" ] || IS_SAME=1
    elif [ "${S_META%|*}" = "${D_META%|*}" ]; then IS_SAME=1; fi
  fi
}
create_copy_directory() {
  local owner bits mode
  owner=$(stat -f '%u:%g' "$S_PATH") || stop 'Cannot read directory ownership.'
  bits=$(stat -f '%p' "$S_PATH") || stop 'Cannot read directory permissions.'
  case "$owner" in *[!0-9:]*|''|:*) stop 'Invalid ownership data.';; esac
  case "$bits" in *[!0-7]*|'') stop 'Invalid directory permission data.';; esac
  printf -v mode '%o' "$((8#$bits & 07777))"
  mkdir "$D_PATH" || stop 'Cannot create directory on destination.'
  chown "$owner" "$D_PATH" && chmod "$mode" "$D_PATH" || stop 'Cannot preserve basic directory permissions.'
}
resolve_group() {
  group_for "$1"
  [ "$GROUP_INDEX" -lt 0 ] || GROUP_NEED[$GROUP_INDEX]=$((${GROUP_NEED[$GROUP_INDEX]}-1))
}
copy_candidates() {
  local answer rel stage payload kind_before size_before meta_before result elapsed free
  local plan_count=0 bytes=0
  validate_roots; check_mounts
  say 'Building copy plan: reads metadata ONLY for candidates, not a full SSD rescan.'
  : > "$SESSION/plan.nul" || stop 'Cannot create copy plan.'
  phase_start PLAN "$C_NEED"
  while IFS= read -r -d '' rel; do
    if [ "$rel" = . ]; then S_PATH=$SRC; D_PATH=$DST; else S_PATH="$SRC/$rel"; D_PATH="$DST/$rel"; fi
    # No writes yet. Every source path is checked before copy as well.
    read_pair
    if [ "$IS_SAME" = 1 ]; then resolve_group "$rel"
    else
      printf '%s\0' "$rel" >> "$SESSION/plan.nul" || stop 'Cannot write plan.'
      plan_count=$((plan_count+1)); [ "$KIND" != 'Regular File' ] || bytes=$((bytes+SIZE))
    fi
    DONE=$((DONE+1)); draw_progress
  done < "$REPORT/todo.nul"
  draw_progress 1; show_groups
  printf '\nPLAN_OBJECTS=%s PLAN_REGULAR_BYTES=%s\n' "$plan_count" "$bytes"
  [ "$plan_count" -gt 0 ] || { say 'No remaining candidates in this audit plan. No new copy needed.'; return; }
  say 'COPY replaces only candidates, stages files first, and never deletes unrelated copy files.'
  say 'Directory ACLs, xattrs, times / hard-link layout are not reconstructed. Contents are NOT checksummed.'
  say 'Average MiB/s counts completed regular files only; current large file may not advance the bar.'
  say 'Keep all other copy/audit processes stopped. Type COPY to authorize changes on RESCUE:'
  IFS= read -r answer || exit 0; [ "$answer" = COPY ] || return 0
  guard_devices; validate_roots
  if [ ! -d "$DST" ]; then S_PATH=$SRC; D_PATH=$DST; create_copy_directory; fi
  stage=$(mktemp -d "$SAVE_ROOT/.rescue-stage.XXXXXX") || stop 'Cannot create staging directory.'
  printf 'STAGING=%s\n' "$stage"
  payload="$stage/item"
  phase_start COPY "$plan_count"; PLAN_BYTES=$bytes; RESOLVED_BYTES=0; WRITTEN=0
  while IFS= read -r -d '' rel; do
    guard_devices; safe_parent "$rel"
    if [ "$rel" = . ]; then S_PATH=$SRC; D_PATH=$DST; else S_PATH="$SRC/$rel"; D_PATH="$DST/$rel"; fi
    CURRENT=$rel; read_pair
    kind_before=$KIND; size_before=$SIZE; meta_before=$S_META
    if [ "$IS_SAME" = 0 ]; then
      if [ "$KIND" = Directory ]; then
        create_copy_directory
      else
        [ ! -e "$payload" ] && [ ! -L "$payload" ] || stop 'Staging item already exists; preserved for review.'
        free=$(df -Pk "$SAVE_ROOT" | awk 'END {print $4}') || stop 'Cannot read free space.'
        is_uint "$free" || stop 'Invalid free-space result.'
        [ $((free*1024)) -gt $((SIZE+16777216)) ] || stop 'Insufficient free space for staged file.'
        printf '\nCOPYING %q (%s bytes)\n' "$rel" "$SIZE"
        if [ "$KIND" = 'Regular File' ] && [ "$SIZE" -ge 8388608 ]; then
          ditto --rsrc --extattr --acl "$S_PATH" "$payload" >> "$SESSION/copy.log" 2>&1 & CHILD=$!
          while kill -0 "$CHILD" 2>/dev/null; do draw_progress; sleep 1; done
          wait "$CHILD"; result=$?; CHILD=
        elif [ "$KIND" = 'Regular File' ]; then
          ditto --rsrc --extattr --acl "$S_PATH" "$payload" >> "$SESSION/copy.log" 2>&1
          result=$?
        else
          cp -pPR "$S_PATH" "$payload" >> "$SESSION/copy.log" 2>&1
          result=$?
        fi
        [ "$result" = 0 ] || stop 'Copy failed. Staged partial file and old destination are preserved.'
        guard_devices; safe_parent "$rel"
        [ "$(meta "$S_PATH")" = "$meta_before" ] || stop 'Source metadata changed; stage preserved.'
        S_META=$meta_before; D_META=$(meta "$payload") || stop 'Cannot inspect staged file.'
        [ "${D_META##*|}" = "$SAVE_DEV" ] && [ "${D_META%%|*}" = "$kind_before" ] || stop 'Staged type/device mismatch.'
        if [ "$kind_before" = 'Regular File' ]; then
          [ "${S_META%|*}" = "${D_META%|*}" ] || stop 'Staged file size/time mismatch.'
        else
          S_LINK=$(link_text "$S_PATH") || stop 'Cannot read source link during verification.'
          D_LINK=$(link_text "$payload") || stop 'Cannot read staged link.'
          [ "$S_LINK" = "$D_LINK" ] || stop 'Staged link mismatch.'
        fi
        # Recheck old destination before atomic rename; never replace a directory or follow a link.
        if [ -e "$D_PATH" ] || [ -L "$D_PATH" ]; then
          D_META=$(meta "$D_PATH") || stop 'Destination disappeared.'
          [ "${D_META%%|*}" = "$kind_before" ] && [ "${D_META##*|}" = "$SAVE_DEV" ] || stop 'Destination changed before rename.'
        fi
        mv -fh "$payload" "$D_PATH" || stop 'Cannot commit staged file; stage preserved.'
        [ "$kind_before" != 'Regular File' ] || WRITTEN=$((WRITTEN+size_before))
      fi
    fi
    [ "$kind_before" != 'Regular File' ] || RESOLVED_BYTES=$((RESOLVED_BYTES+size_before))
    printf '%s\0' "$rel" >> "$SESSION/completed.nul" || stop 'Cannot record completed candidate.'
    resolve_group "$rel"; DONE=$((DONE+1)); draw_progress
    # Deliberate short idle interval, not a claimed CPU power limit.
    [ $((DONE%200)) -ne 0 ] || sleep 1
  done < "$SESSION/plan.nul"
  CURRENT=; draw_progress 1
  rmdir "$stage" || stop 'Staging directory not empty; inspect it.'
  check_mounts
  show_groups; show_groups > "$SESSION/folders-after.txt" || stop 'Cannot save final summary.'
  printf '\nCOPY_PLAN_DONE objects=%s regular_bytes_written=%s\n' "$DONE" "$WRITTEN"
  say 'This is not a byte-for-byte verification. Open critical files from RESCUE before any source repair.'
}
main() {
  local t answer
  export PATH=/usr/bin:/bin:/usr/sbin:/sbin LC_ALL=C
  umask 077; set -o pipefail; shopt -s nullglob dotglob
  [ "$(uname -s)" = Darwin ] || stop 'Requires macOS Recovery.'
  for t in diskutil stat find awk mktemp tail cat df cp ditto mkdir mv rmdir sleep chmod chown; do command -v "$t" >/dev/null || stop "Missing tool: $t"; done
  say 'RECOVERY RESCUE v2.0.0'
  say 'Do NOT interrupt a running check. Start this only after it finishes.'
  say '1) Read completed audit, show folders, optionally copy candidates'
  say '2) New audit with percentage/time, then optionally copy'
  printf 'Mode (q = stop): '; IFS= read -r answer || exit 0
  case "$answer" in 1|2) ;; *) exit 0;; esac
  check_mounts
  SOURCE_DEV=$(stat -f '%d' "$DATA_ROOT") || stop 'Cannot stat source root.'
  SAVE_DEV=$(stat -f '%d' "$SAVE_ROOT") || stop 'Cannot stat destination root.'
  LOCK=/tmp/mac-rescue-v2.lock
  mkdir "$LOCK" 2>/dev/null || stop 'Another v2 session or stale lock exists. Do not run concurrent copies.'
  LOCK_OWNED=1; trap new_cleanup EXIT; trap 'exit 130' INT; trap 'exit 143' TERM HUP
  SESSION=$(mktemp -d "$SAVE_ROOT/.rescue-session.XXXXXX") || stop 'Cannot create session log.'
  : > "$SESSION/errors.log" || stop 'Cannot create error log.'
  power_setup; thermal_poll
  if [ "$answer" = 1 ]; then choose_report; else new_audit; fi
  read_report
  say 'Enter 1 to prepare selective copy; anything else exits with report only:'
  IFS= read -r answer || exit 0
  [ "$answer" != 1 ] || copy_candidates
}
if [ "${BASH_SOURCE[0]}" = "$0" ]; then main "$@"; fi
